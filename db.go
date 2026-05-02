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
	if err := ensureAdminLoginFailuresSchema(); err != nil {
		return fmt.Errorf("ensure admin login failures schema: %w", err)
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
	allowedSet := map[string]struct{}{"ip": {}}
	for _, c := range required {
		allowedSet[c] = struct{}{}
	}
	extraneous := false
	for _, c := range cols {
		if _, ok := allowedSet[c]; !ok {
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

func ensureAdminLoginFailuresSchema() error {
	ddl := `CREATE TABLE IF NOT EXISTS admin_login_failures (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		occurred_at TIMESTAMP NOT NULL,
		ip TEXT NOT NULL,
		username TEXT,
		user_agent TEXT,
		reason TEXT
	);`
	if _, err := db.Exec(ddl); err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_admin_login_failures_occurred_at ON admin_login_failures(occurred_at)`); err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_admin_login_failures_ip ON admin_login_failures(ip)`); err != nil {
		return err
	}
	return nil
}

// ensureTimingsColumn adds the timings_json column if missing.
// timings_json column removal: no longer ensured

func pruneOld() error {
	cutoff := time.Now().Add(-retentionPeriod)
	if _, err := db.Exec(`DELETE FROM containers WHERE created_at < ?`, cutoff.UTC()); err != nil {
		return err
	}
	_, err := db.Exec(`DELETE FROM admin_login_failures WHERE occurred_at < ?`, cutoff.UTC())
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

type TimePoint struct {
	Time  time.Time `json:"time"`
	Count int       `json:"count"`
}

type IPStat struct {
	IP        string    `json:"ip"`
	Count     int       `json:"count"`
	FirstSeen time.Time `json:"first_seen"`
	LastSeen  time.Time `json:"last_seen"`
}

type AdminLoginFailure struct {
	OccurredAt time.Time `json:"occurred_at"`
	IP         string    `json:"ip"`
	Username   string    `json:"username,omitempty"`
	UserAgent  string    `json:"user_agent,omitempty"`
	Reason     string    `json:"reason,omitempty"`
}

type AdminLoginFailureStats struct {
	Total  int                 `json:"total"`
	IPs    []IPStat            `json:"ips"`
	Recent []AdminLoginFailure `json:"recent"`
}

type ObservabilityStats struct {
	From                 time.Time              `json:"from"`
	To                   time.Time              `json:"to"`
	UniqueIPCount        int                    `json:"unique_ip_count"`
	UniqueIPs            []IPStat               `json:"unique_ips"`
	TotalCompilations    int                    `json:"total_compilations"`
	HourlyCompilations   []TimePoint            `json:"hourly_compilations"`
	SuccessCount         int                    `json:"success_count"`
	ErrorCount           int                    `json:"error_count"`
	AverageCompileTimeMS float64                `json:"average_compile_time_ms"`
	FailedAdminLogins    AdminLoginFailureStats `json:"failed_admin_logins"`
}

func saveAdminLoginFailure(ip, username, userAgent, reason string) error {
	if db == nil {
		return errors.New("db not initialized")
	}
	if ip == "" {
		ip = "unknown"
	}
	_, err := db.Exec(`INSERT INTO admin_login_failures (occurred_at, ip, username, user_agent, reason) VALUES (?,?,?,?,?)`,
		time.Now().UTC(), ip, username, userAgent, reason)
	return err
}

func getObservabilityStats(from, to time.Time) (ObservabilityStats, error) {
	if db == nil {
		return ObservabilityStats{}, errors.New("db not initialized")
	}
	from = from.UTC()
	to = to.UTC()
	stats := ObservabilityStats{From: from, To: to}
	if err := db.QueryRow(`SELECT COUNT(*) FROM containers WHERE created_at >= ? AND created_at < ?`, from, to).Scan(&stats.TotalCompilations); err != nil {
		return stats, err
	}
	if err := db.QueryRow(`SELECT COUNT(DISTINCT ip) FROM containers WHERE created_at >= ? AND created_at < ? AND COALESCE(ip,'') <> ''`, from, to).Scan(&stats.UniqueIPCount); err != nil {
		return stats, err
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM containers WHERE created_at >= ? AND created_at < ? AND COALESCE(error_message,'') = ''`, from, to).Scan(&stats.SuccessCount); err != nil {
		return stats, err
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM containers WHERE created_at >= ? AND created_at < ? AND COALESCE(error_message,'') <> ''`, from, to).Scan(&stats.ErrorCount); err != nil {
		return stats, err
	}
	var avg sql.NullFloat64
	if err := db.QueryRow(`SELECT AVG(execution_time_ms) FROM containers WHERE created_at >= ? AND created_at < ?`, from, to).Scan(&avg); err != nil {
		return stats, err
	}
	if avg.Valid {
		stats.AverageCompileTimeMS = avg.Float64
	}
	ips, err := listIPStats(`created_at`, `containers`, from, to)
	if err != nil {
		return stats, err
	}
	stats.UniqueIPs = ips
	hourly, err := listHourlyCompilations(from, to)
	if err != nil {
		return stats, err
	}
	stats.HourlyCompilations = hourly
	failed, err := listAdminLoginFailures(from, to)
	if err != nil {
		return stats, err
	}
	stats.FailedAdminLogins = failed
	return stats, nil
}

func listIPStats(timeColumn, table string, from, to time.Time) ([]IPStat, error) {
	query := fmt.Sprintf(`SELECT ip, COUNT(*) AS total_count, strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ', MIN(%s)) AS first_seen, strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ', MAX(%s)) AS last_seen
		FROM %s
		WHERE %s >= ? AND %s < ? AND COALESCE(ip,'') <> ''
		GROUP BY ip
		ORDER BY total_count DESC, last_seen DESC`, timeColumn, timeColumn, table, timeColumn, timeColumn)
	rows, err := db.Query(query, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IPStat
	for rows.Next() {
		var s IPStat
		var firstSeen, lastSeen string
		if err := rows.Scan(&s.IP, &s.Count, &firstSeen, &lastSeen); err != nil {
			return nil, err
		}
		s.FirstSeen, _ = time.Parse(time.RFC3339Nano, firstSeen)
		s.LastSeen, _ = time.Parse(time.RFC3339Nano, lastSeen)
		out = append(out, s)
	}
	return out, rows.Err()
}

func listHourlyCompilations(from, to time.Time) ([]TimePoint, error) {
	rows, err := db.Query(`SELECT strftime('%Y-%m-%dT%H:00:00Z', created_at) AS hour, COUNT(*)
		FROM containers
		WHERE created_at >= ? AND created_at < ?
		GROUP BY hour
		ORDER BY hour ASC`, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[time.Time]int{}
	for rows.Next() {
		var hourStr string
		var count int
		if err := rows.Scan(&hourStr, &count); err != nil {
			return nil, err
		}
		t, err := time.Parse(time.RFC3339, hourStr)
		if err != nil {
			continue
		}
		counts[t.UTC()] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	start := from.Truncate(time.Hour)
	capacity := int(to.Sub(start).Hours()) + 1
	if capacity < 1 {
		capacity = 1
	}
	points := make([]TimePoint, 0, capacity)
	for t := start; t.Before(to); t = t.Add(time.Hour) {
		points = append(points, TimePoint{Time: t, Count: counts[t]})
	}
	return points, nil
}

func listAdminLoginFailures(from, to time.Time) (AdminLoginFailureStats, error) {
	var stats AdminLoginFailureStats
	if err := db.QueryRow(`SELECT COUNT(*) FROM admin_login_failures WHERE occurred_at >= ? AND occurred_at < ?`, from, to).Scan(&stats.Total); err != nil {
		return stats, err
	}
	ips, err := listIPStats(`occurred_at`, `admin_login_failures`, from, to)
	if err != nil {
		return stats, err
	}
	stats.IPs = ips
	rows, err := db.Query(`SELECT occurred_at, ip, COALESCE(username,''), COALESCE(user_agent,''), COALESCE(reason,'')
		FROM admin_login_failures
		WHERE occurred_at >= ? AND occurred_at < ?
		ORDER BY occurred_at DESC
		LIMIT 100`, from, to)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	for rows.Next() {
		var f AdminLoginFailure
		if err := rows.Scan(&f.OccurredAt, &f.IP, &f.Username, &f.UserAgent, &f.Reason); err != nil {
			return stats, err
		}
		stats.Recent = append(stats.Recent, f)
	}
	return stats, rows.Err()
}

// old nullable helpers removed (metrics dropped)
