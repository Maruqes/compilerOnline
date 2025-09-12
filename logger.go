package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// logsDB é a conexão dedicada para a tabela de logs.
var logsDB *sql.DB

// sqliteCore implementa zapcore.Core gravando cada entry em uma tabela SQLite.
// Mantém também o encoding JSON bruto da linha do log para uso posterior.
type sqliteCore struct {
	level zapcore.Level
	enc   zapcore.Encoder
	db    *sql.DB
	stmt  *sql.Stmt
	mu    sync.Mutex // serializa writes para reduzir 'database is locked'
}

// Enabled verifica se o nível está habilitado.
func (c *sqliteCore) Enabled(lvl zapcore.Level) bool { return lvl >= c.level }

// With cria um novo core com campos adicionais anexados via encoder clone.
func (c *sqliteCore) With(fields []zapcore.Field) zapcore.Core {
	// Construir novo core compartilhando stmt/db mas com encoder clonado
	enc := c.enc.Clone()
	for _, f := range fields {
		f.AddTo(enc)
	}
	return &sqliteCore{level: c.level, enc: enc, db: c.db, stmt: c.stmt}
}

// Check prepara a Entry.
func (c *sqliteCore) Check(ent zapcore.Entry, ce *zapcore.CheckedEntry) *zapcore.CheckedEntry {
	if c.Enabled(ent.Level) {
		return ce.AddCore(ent, c)
	}
	return ce
}

// Write codifica e insere log no SQLite.
func (c *sqliteCore) Write(ent zapcore.Entry, fields []zapcore.Field) error {
	// Garante stack trace para níveis >= Error, no formato solicitado.
	entToEncode := ent
	if ent.Level >= zapcore.ErrorLevel {
		stackStr := ent.Stack
		if stackStr == "" {
			stackStr = buildStackTrace()
		} else {
			stackStr = normalizeStack(stackStr)
		}
		entToEncode.Stack = stackStr
	}

	enc := c.enc.Clone()
	for _, f := range fields {
		f.AddTo(enc)
	}
	buf, err := enc.EncodeEntry(entToEncode, fields)
	if err != nil {
		return err
	}
	line := buf.String()
	buf.Free()

	c.mu.Lock()
	defer c.mu.Unlock()
	_, err = c.stmt.Exec(entToEncode.Time.UTC(), entToEncode.Level.String(), entToEncode.Message, nullable(entToEncode.LoggerName), nullable(entToEncode.Caller.TrimmedPath()), nullable(entToEncode.Stack), line)
	return err
}

// Sync faz flush (nenhuma operação especial aqui) retornando erro potencial do banco.
func (c *sqliteCore) Sync() error { return nil }

func nullable(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

// buildStackTrace cria stack similar ao exemplo, omitindo cabeçalho de goroutine.
func buildStackTrace() string {
	b := debug.Stack()
	return normalizeStack(string(b))
}

// normalizeStack remove a primeira linha 'goroutine ..' e trims espaços extras.
func normalizeStack(s string) string {
	lines := strings.Split(s, "\n")
	if len(lines) > 0 && strings.HasPrefix(lines[0], "goroutine ") {
		lines = lines[1:]
	}
	// Remove linhas vazias no começo/fim
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n")
}

// InitAppLogger inicializa o logger global gravando em arquivo SQLite indicado.
// dbPath: caminho do arquivo .sql/.db
// levelStr: nível mínimo (debug, info, warn, error, dpanic, panic, fatal)
func InitAppLogger(dbPath, levelStr string) (*zap.Logger, error) {
	if dbPath == "" {
		return nil, errors.New("dbPath vazio")
	}
	lvl := zapcore.InfoLevel
	if levelStr != "" {
		if parsed, err := zapcore.ParseLevel(levelStr); err == nil {
			lvl = parsed
		}
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("mkdir logs dir: %w", err)
	}
	dsn := dbPath
	db, err := sql.Open("sqlite3", dsn+"?_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		return nil, fmt.Errorf("open log db: %w", err)
	}
	if err = db.Ping(); err != nil {
		return nil, fmt.Errorf("ping log db: %w", err)
	}
	if err := createLogsSchema(db); err != nil {
		return nil, err
	}
	logsDB = db
	// Prune inicial (ignora erro)
	_ = pruneOldLogs()
	go periodicLogsPrune()
	stmt, err := db.Prepare(`INSERT INTO logs (ts, level, message, logger_name, caller, stack, raw) VALUES (?,?,?,?,?,?,?)`)
	if err != nil {
		return nil, fmt.Errorf("prepare insert: %w", err)
	}
	// Core que grava no SQLite
	sqliteC := &sqliteCore{level: lvl, enc: zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()), db: db, stmt: stmt}

	// Core que escreve no stdout (console) usando encoder de console
	consoleEncCfg := zap.NewDevelopmentEncoderConfig()
	consoleEncCfg.EncodeTime = zapcore.ISO8601TimeEncoder
	consoleEnc := zapcore.NewConsoleEncoder(consoleEncCfg)
	consoleCore := zapcore.NewCore(consoleEnc, zapcore.AddSync(os.Stdout), lvl)

	tee := zapcore.NewTee(sqliteC, consoleCore)
	logger := zap.New(tee, zap.AddCaller(), zap.AddStacktrace(zapcore.ErrorLevel))
	return logger, nil
}

func createLogsSchema(db *sql.DB) error {
	ddl := `CREATE TABLE IF NOT EXISTS logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ts TIMESTAMP NOT NULL,
		level TEXT NOT NULL,
		message TEXT NOT NULL,
		logger_name TEXT NULL,
		caller TEXT NULL,
		stack TEXT NULL,
		raw TEXT NOT NULL
	);`
	if _, err := db.Exec(ddl); err != nil {
		return fmt.Errorf("create logs table: %w", err)
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts)`); err != nil {
		return fmt.Errorf("create logs index: %w", err)
	}
	return nil
}

// Optional: função utilitária para listar últimos N logs (pode ser usada em endpoints futuros)
func listRecentLogs(limit int) ([]map[string]interface{}, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if logsDB == nil {
		return nil, errors.New("logs db not initialized")
	}
	rows, err := logsDB.Query(`SELECT ts, level, message, logger_name, caller, stack FROM logs ORDER BY ts DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var ts time.Time
		var level, msg, lname, caller, stack sql.NullString
		if err := rows.Scan(&ts, &level, &msg, &lname, &caller, &stack); err != nil {
			return nil, err
		}
		out = append(out, map[string]interface{}{
			"ts":          ts,
			"level":       level.String,
			"message":     msg.String,
			"logger_name": lname.String,
			"caller":      caller.String,
			"stack":       stack.String,
		})
	}
	return out, rows.Err()
}

// pruneOldLogs remove logs com mais de retentionPeriod.
func pruneOldLogs() error {
	if logsDB == nil {
		return nil
	}
	cutoff := time.Now().Add(-retentionPeriod)
	_, err := logsDB.Exec(`DELETE FROM logs WHERE ts < ?`, cutoff.UTC())
	return err
}

func periodicLogsPrune() {
	t := time.NewTicker(24 * time.Hour)
	for range t.C {
		if err := pruneOldLogs(); err != nil && logger != nil {
			logger.Warn("periodic logs prune failed", zap.Error(err))
		}
	}
}
