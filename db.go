package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"go.uber.org/zap"
)

const (
	defaultDBPath   = "data/containers.db"
	retentionPeriod = 90 * 24 * time.Hour
)

var db *sql.DB

func initDB() error {
	if err := os.MkdirAll(filepath.Dir(defaultDBPath), 0o755); err != nil {
		return fmt.Errorf("create db dir: %w", err)
	}
	d, err := sql.Open("sqlite3", defaultDBPath)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	if err = d.Ping(); err != nil {
		return fmt.Errorf("ping db: %w", err)
	}
	db = d
	if err := migrate(); err != nil {
		return err
	}
	if err := pruneOld(); err != nil {
		logger.Warn("prune at startup failed", zap.Error(err))
	}
	go periodicPrune()
	return nil
}

// migrate ensures a minimal, current schema (without unused metric columns).
func migrate() error {
	// Minimal desired schema (status/runtime removed; only persisted execution metadata).
	baseSchema := `CREATE TABLE IF NOT EXISTS containers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		container_id TEXT NOT NULL,
		created_at TIMESTAMP NOT NULL,
		finished_at TIMESTAMP NOT NULL,
		execution_time_ms INTEGER NOT NULL,
		ip TEXT,
		code_executed TEXT,
		output TEXT,
		error_message TEXT
	);`
	if _, err := db.Exec(baseSchema); err != nil {
		return fmt.Errorf("apply base schema: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_containers_created_at ON containers(created_at)`); err != nil {
		return fmt.Errorf("create index: %w", err)
	}
	// Check existing columns; migrate if legacy columns (old metrics / status / runtime) still present.
	if err := ensureMinimalSchema(); err != nil {
		return fmt.Errorf("ensure minimal schema: %w", err)
	}
	// Ensure the ip column exists (added after initial minimal schema).
	if err := ensureIPColumn(); err != nil {
		return fmt.Errorf("ensure ip column: %w", err)
	}
	return nil
}

// ensureMinimalSchema migrates from legacy wide schema (with metrics columns) to minimal one.
func ensureMinimalSchema() error {
	rows, err := db.Query(`PRAGMA table_info(containers)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		cols = append(cols, name)
	}
	if len(cols) == 0 {
		return nil
	}
	// ip column intentionally NOT part of strict minimal set so we can add it later with simple ALTER (avoid full copy if it's the only missing col)
	required := []string{"id", "container_id", "created_at", "finished_at", "execution_time_ms", "code_executed", "output", "error_message"}
	requiredSet := map[string]struct{}{}
	for _, c := range required {
		requiredSet[c] = struct{}{}
	}
	extraneous := false
	for _, c := range cols {
		if _, ok := requiredSet[c]; !ok {
			extraneous = true
			break
		}
	}
	missing := false
	existingSet := map[string]struct{}{}
	for _, c := range cols {
		existingSet[c] = struct{}{}
	}
	for _, c := range required {
		if _, ok := existingSet[c]; !ok {
			missing = true
			break
		}
	}
	if !extraneous && !missing {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if _, err = tx.Exec(`CREATE TABLE containers_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		container_id TEXT NOT NULL,
		created_at TIMESTAMP NOT NULL,
		finished_at TIMESTAMP NOT NULL,
		execution_time_ms INTEGER NOT NULL,
		ip TEXT,
		code_executed TEXT,
		output TEXT,
		error_message TEXT
	);`); err != nil {
		return err
	}
	if _, err = tx.Exec(`CREATE INDEX IF NOT EXISTS idx_containers_created_at_new ON containers_new(created_at)`); err != nil {
		return err
	}
	// Determine if old table had ip column; copy it if present.
	existingHasIP := false
	for _, c := range cols {
		if c == "ip" {
			existingHasIP = true
		}
	}
	copyCols := []string{"container_id", "created_at", "finished_at", "execution_time_ms"}
	if existingHasIP {
		copyCols = append(copyCols, "ip")
	}
	// timings_json dropped
	copyCols = append(copyCols, "code_executed", "output", "error_message")
	selCols := strings.Join(copyCols, ",")
	if _, err = tx.Exec(`INSERT INTO containers_new (` + selCols + `) SELECT ` + selCols + ` FROM containers`); err != nil {
		return err
	}
	if _, err = tx.Exec(`DROP TABLE containers`); err != nil {
		return err
	}
	if _, err = tx.Exec(`ALTER TABLE containers_new RENAME TO containers`); err != nil {
		return err
	}
	if _, err = tx.Exec(`CREATE INDEX IF NOT EXISTS idx_containers_created_at ON containers(created_at)`); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	_, _ = db.Exec(`VACUUM`)
	return nil
}

// ensureIPColumn adds the ip column (nullable) if it does not yet exist.
func ensureIPColumn() error {
	rows, err := db.Query(`PRAGMA table_info(containers)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	hasIP := false
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt interface{}
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		if name == "ip" {
			hasIP = true
		}
	}
	if hasIP {
		return nil
	}
	if _, err := db.Exec(`ALTER TABLE containers ADD COLUMN ip TEXT`); err != nil {
		return fmt.Errorf("add ip column: %w", err)
	}
	return nil
}

// ensureTimingsColumn adds the timings_json column if missing.
// timings_json column removal: no longer ensured

func pruneOld() error {
	cutoff := time.Now().Add(-retentionPeriod)
	_, err := db.Exec(`DELETE FROM containers WHERE created_at < ?`, cutoff.UTC())
	return err
}

func periodicPrune() {
	ticker := time.NewTicker(24 * time.Hour)
	for range ticker.C {
		if err := pruneOld(); err != nil {
			logger.Warn("periodic prune failed", zap.Error(err))
		}
	}
}

func saveContainerRecordDB(r *ContainerRecord) error {
	if db == nil {
		return errors.New("db not initialized")
	}
	stmt := `INSERT INTO containers (container_id, created_at, finished_at, execution_time_ms, ip, code_executed, output, error_message)
			 VALUES (?,?,?,?,?,?,?,?)`
	_, err := db.Exec(stmt,
		r.ContainerID,
		r.CreatedAt.UTC(),
		r.FinishedAt.UTC(),
		r.ExecutionTime.Milliseconds(),
		r.IP,
		r.CodeExecuted,
		r.Output,
		r.ErrorMessage,
	)
	return err
}

func listContainerRecords(limit int) ([]ContainerRecord, error) {
	if db == nil {
		return nil, errors.New("db not initialized")
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := db.Query(`SELECT container_id, created_at, finished_at, execution_time_ms, COALESCE(ip,'') as ip, code_executed, output, error_message
			FROM containers ORDER BY created_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ContainerRecord
	for rows.Next() {
		var r ContainerRecord
		var execMs int64
		if err := rows.Scan(&r.ContainerID, &r.CreatedAt, &r.FinishedAt, &execMs, &r.IP, &r.CodeExecuted, &r.Output, &r.ErrorMessage); err != nil {
			return nil, err
		}
		r.ExecutionTime = time.Duration(execMs) * time.Millisecond
		out = append(out, r)
	}
	return out, rows.Err()
}

// old nullable helpers removed (metrics dropped)
