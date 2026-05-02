package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/containerd/containerd"
	"github.com/containerd/containerd/namespaces"
	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

var logger *zap.Logger
var adminUser string
var adminPass string
var appConfig *Config
var kataExecTimeout time.Duration
var compileLimiter *concurrencyLimiter

// ContainerHistory armazena o histórico completo de todos os containers
type ContainerHistory struct {
	Containers []ContainerRecord `json:"containers"`
	LastUpdate time.Time         `json:"last_update"`
	TotalCount int               `json:"total_count"`
}

// ContainerRecord representa um registro completo de um container
type ContainerRecord struct {
	ContainerID   string        `json:"container_id"`
	CreatedAt     time.Time     `json:"created_at"`
	FinishedAt    time.Time     `json:"finished_at"`
	ExecutionTime time.Duration `json:"execution_time"`
	IP            string        `json:"ip,omitempty"`
	CodeExecuted  string        `json:"code_executed"`
	Output        string        `json:"output"`
	ErrorMessage  string        `json:"error_message"`
}

// ContainerStats simples (sem métricas de recursos)
type ContainerStats struct {
	ContainerID string    `json:"container_id"`
	Timestamp   time.Time `json:"timestamp"`
	Status      string    `json:"status"`
	Runtime     string    `json:"runtime,omitempty"`
}

func compileHandler(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		logger.Warn("code not provided")
		http.Error(w, "code not provided", http.StatusBadRequest)
		return
	}
	clientIP := extractClientIP(r)
	if compileLimiter != nil {
		release, ok, msg, total, perIP := compileLimiter.tryAcquire(clientIP)
		if !ok {
			if logger != nil {
				fields := []zap.Field{
					zap.String("ip", clientIP),
					zap.String("reason", msg),
					zap.Int("concurrent_total", total),
					zap.Int("concurrent_ip", perIP),
				}
				if appConfig != nil {
					fields = append(fields, zap.Int("limit_total", appConfig.MaxConcurrentCompilations), zap.Int("limit_ip", appConfig.MaxConcurrentCompilationsPerIP))
				}
				logger.Warn(fmt.Sprintf("compile concurrency limit hit (ip=%s)", clientIP), fields...)
			}
			http.Error(w, msg, http.StatusTooManyRequests)
			return
		}
		if logger != nil {
			ipLimit := 0
			totalLimit := 0
			if appConfig != nil {
				ipLimit = appConfig.MaxConcurrentCompilationsPerIP
				totalLimit = appConfig.MaxConcurrentCompilations
			}
			logger.Info(fmt.Sprintf("this IP has %d active compilations out of max %d", perIP, ipLimit),
				zap.String("ip", clientIP),
				zap.Int("concurrent_ip", perIP),
				zap.Int("limit_ip", ipLimit),
			)
			logger.Info(fmt.Sprintf("the program has %d active compilations out of max %d", total, totalLimit),
				zap.Int("concurrent_total", total),
				zap.Int("limit_total", totalLimit),
			)
		}
		defer release()
	}

	result, containerRecord, err := execInKataWithHistory(code)
	if err != nil {
		logger.Error("code execution failed", zap.Error(err))
		if containerRecord != nil {
			containerRecord.IP = clientIP
			containerRecord.ErrorMessage = err.Error()
			if dbErr := saveContainerRecordDB(containerRecord); dbErr != nil {
				logger.Error("failed to persist error record", zap.Error(dbErr))
			}
		}
		if err == ErrLimitChar5k {
			http.Error(w, "Error: code exceeds 5000 character limit\n"+result, http.StatusBadRequest)
		} else {
			to := int(kataExecTimeout.Seconds())
			if to <= 0 {
				to = 10
			}
			http.Error(w, fmt.Sprintf("Error during code execution (maybe timeout %d sec or 5k char limit)\n%s", to, result), http.StatusInternalServerError)
		}
		return
	}
	if containerRecord != nil {
		containerRecord.IP = clientIP
		if dbErr := saveContainerRecordDB(containerRecord); dbErr != nil {
			logger.Error("failed to persist record", zap.Error(dbErr))
		}
	}
	logger.Info("code executed successfully")
	w.Write([]byte(result))
}

// extractClientIP returns the best-effort client IP considering common proxy headers.
func extractClientIP(r *http.Request) string {
	// Check X-Forwarded-For (may contain multiple comma-separated IPs: client, proxy1, proxy2)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if len(parts) > 0 {
			ip := strings.TrimSpace(parts[0])
			if ip != "" {
				return ip
			}
		}
	}
	// Check X-Real-IP
	if rip := r.Header.Get("X-Real-IP"); rip != "" {
		return rip
	}
	// Fallback RemoteAddr
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

// execInKataWithHistory executa código e retorna dados completos para o histórico
func execInKataWithHistory(code string) (string, *ContainerRecord, error) {
	startTime := time.Now()

	// Criar o registro base
	record := &ContainerRecord{
		CreatedAt:    startTime,
		CodeExecuted: code,
		// resource usage removido
	}

	// Executar o código original
	result, containerID, err := execInKata(code)
	endTime := time.Now()

	// Preencher dados finais
	record.FinishedAt = endTime
	record.ExecutionTime = endTime.Sub(startTime)
	record.Output = result

	record.ContainerID = containerID

	// Set containerID from exec result if stats didn't provide
	if record.ContainerID == "" {
		record.ContainerID = containerID
	}
	// Fallback if still empty
	if record.ContainerID == "" {
		record.ContainerID = fmt.Sprintf("kata-exec-%d", startTime.UnixNano())
	}

	return result, record, err
}

// timing aggregation removed

func statsHandler(w http.ResponseWriter, r *http.Request) {
	stats, err := getContainerStats()
	if err != nil {
		logger.Error("failed to get container stats", zap.Error(err))
		http.Error(w, fmt.Sprintf("Error getting container stats: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Timestamp      time.Time        `json:"timestamp"`
		ContainerCount int              `json:"container_count"`
		Containers     []ContainerStats `json:"containers"`
	}{Timestamp: time.Now(), ContainerCount: len(stats), Containers: stats})
	logger.Info("container stats retrieved", zap.Int("count", len(stats)))
}

// admin auth handlers & middleware moved to jwt.go

func historyHandler(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if ls := r.URL.Query().Get("limit"); ls != "" {
		if v, err := strconv.Atoi(ls); err == nil {
			limit = v
		}
	}
	recs, err := listContainerRecords(limit)
	if err != nil {
		logger.Error("history list", zap.Error(err))
		http.Error(w, "error listing history", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	_ = json.NewEncoder(w).Encode(struct {
		Containers []ContainerRecord `json:"containers"`
		Count      int               `json:"count"`
		Limit      int               `json:"limit"`
	}{Containers: recs, Count: len(recs), Limit: limit})
}

func logsHandler(w http.ResponseWriter, r *http.Request) {
	limit := 100
	if ls := r.URL.Query().Get("limit"); ls != "" {
		if v, err := strconv.Atoi(ls); err == nil {
			limit = v
		}
	}
	level := r.URL.Query().Get("level")
	if level != "" {
		// normalize and validate expected values: info,warn,error,debug
		lvl := level
		switch lvl {
		case "info", "warn", "warning", "error", "debug":
			if lvl == "warning" { // map 'warning' -> 'warn'
				lvl = "warn"
			}
			level = lvl
		default:
			level = "" // invalid -> ignore filter
		}
	}
	logs, err := listRecentLogs(limit, level)
	if err != nil {
		logger.Error("logs list", zap.Error(err))
		http.Error(w, "error listing logs", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Logs  []map[string]interface{} `json:"logs"`
		Count int                      `json:"count"`
		Limit int                      `json:"limit"`
		Level string                   `json:"level,omitempty"`
	}{Logs: logs, Count: len(logs), Limit: limit, Level: level})
}

func observabilityHandler(w http.ResponseWriter, r *http.Request) {
	from, to, err := parseObservabilityRange(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	stats, err := getObservabilityStats(from, to)
	if err != nil {
		logger.Error("observability stats", zap.Error(err))
		http.Error(w, "error loading observability stats", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(stats)
}

func parseObservabilityRange(r *http.Request) (time.Time, time.Time, error) {
	now := time.Now().UTC()
	preset := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("range")))
	if preset == "" {
		preset = "1d"
	}
	switch preset {
	case "1d", "day", "24h":
		return now.Add(-24 * time.Hour), now, nil
	case "7d", "week":
		return now.Add(-7 * 24 * time.Hour), now, nil
	case "1m", "month", "30d":
		return now.Add(-30 * 24 * time.Hour), now, nil
	case "3m", "3months", "90d":
		return now.Add(-90 * 24 * time.Hour), now, nil
	case "custom":
		from, err := parseQueryTime(r.URL.Query().Get("from"))
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid from")
		}
		to, err := parseQueryTime(r.URL.Query().Get("to"))
		if err != nil {
			return time.Time{}, time.Time{}, fmt.Errorf("invalid to")
		}
		if !from.Before(to) {
			return time.Time{}, time.Time{}, fmt.Errorf("from must be before to")
		}
		return from.UTC(), to.UTC(), nil
	default:
		return time.Time{}, time.Time{}, fmt.Errorf("invalid range")
	}
}

func parseQueryTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, fmt.Errorf("empty time")
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04",
		"2006-01-02 15:04",
		"2006-01-02",
	}
	var lastErr error
	for _, layout := range layouts {
		t, err := time.Parse(layout, value)
		if err == nil {
			return t, nil
		}
		lastErr = err
	}
	return time.Time{}, lastErr
}

func getContainerStats() ([]ContainerStats, error) {
	// Conectar ao containerd
	client, err := containerd.New("/run/containerd/containerd.sock")
	if err != nil {
		return nil, fmt.Errorf("containerd client: %w", err)
	}
	defer client.Close()

	ctx := namespaces.WithNamespace(context.Background(), "compiler")

	// Listar todos os containers
	containers, err := client.Containers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list containers: %w", err)
	}

	var stats []ContainerStats
	for _, container := range containers {
		containerStat, err := getIndividualContainerStats(ctx, container)
		if err != nil {
			// Log o erro mas continue com outros containers
			logger.Warn("failed to get stats for container",
				zap.String("container_id", container.ID()),
				zap.Error(err))
			continue
		}
		stats = append(stats, containerStat)
	}

	return stats, nil
}

func getIndividualContainerStats(ctx context.Context, container containerd.Container) (ContainerStats, error) {
	// Obter task do container
	task, err := container.Task(ctx, nil)
	if err != nil {
		// Container pode não ter task ativa
		return ContainerStats{
			ContainerID: container.ID(),
			Timestamp:   time.Now(),
			Status:      "no_task",
			Runtime:     "io.containerd.kata.v2",
		}, nil
	}

	// Obter status da task
	status, err := task.Status(ctx)
	if err != nil {
		logger.Warn("failed to get task status", zap.String("container_id", container.ID()), zap.Error(err))
	}

	// Converter métricas para nossa estrutura
	containerStats := ContainerStats{
		ContainerID: container.ID(),
		Timestamp:   time.Now(),
		Status:      string(status.Status),
		Runtime:     "io.containerd.kata.v2",
	}

	// métricas detalhadas removidas

	return containerStats, nil
}

// parseMetrics coleta métricas reais lendo arquivos de cgroup (tenta v2 depois v1)
// (deprecated) parseMetrics removed; metrics now decoded directly from containerd task.Metrics

func main() {
	//ask for sudo if not root
	if os.Geteuid() != 0 {
		sudoPath, lookErr := exec.LookPath("sudo")
		if lookErr != nil {
			panic("need root or sudo not found" + lookErr.Error())
		}
		args := append([]string{"-E", os.Args[0]}, os.Args[1:]...)
		cmd := exec.Command(sudoPath, args...)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		if runErr := cmd.Run(); runErr != nil {
			panic("sudo elevation failed" + runErr.Error())
		}
		return
	}

	// Load .env first so LoadConfig sees variables
	const envFile = ".env"
	if _, err := os.Stat(envFile); os.IsNotExist(err) {
		panic("environment file does not exist: .env")
	}
	if err := godotenv.Load(envFile); err != nil {
		panic("error loading env file: " + err.Error())
	}

	cfg, err := LoadConfig()
	if err != nil {
		panic("config load failed: " + err.Error())
	}
	appConfig = cfg
	adminUser = cfg.AdminUser
	adminPass = cfg.AdminPass
	compileLimiter = newConcurrencyLimiter(cfg.MaxConcurrentCompilations, cfg.MaxConcurrentCompilationsPerIP)

	// Inicializa logger custom que grava em SQLite (data/logs.sql)
	logDBPath := "data/logs.sql" // extensão .sql como solicitado
	l, err := InitAppLogger(logDBPath, cfg.LogLevel)
	if err != nil {
		panic(fmt.Sprintf("cannot init sqlite logger: %v", err))
	}
	defer l.Sync()
	logger = l

	// Print sanitized config
	logger.Info("config loaded", zap.String("port", cfg.Port), zap.String("log_level", cfg.LogLevel), zap.String("sandbox_base_image", cfg.SandboxBaseImage), zap.String("sandbox_runtime", cfg.SandboxRuntime), zap.Int("sandbox_cpu_quota_percent", cfg.SandboxCPUQuotaPercent), zap.Duration("kata_exec_timeout", cfg.KataExecTimeout), zap.Int("rate_limit_per_min", cfg.RateLimitPerMin), zap.Int("rate_limit_burst", cfg.RateLimitBurst), zap.Int("admin_login_rate_per_min", cfg.AdminLoginRateLimitPerMin), zap.Int("admin_login_rate_burst", cfg.AdminLoginRateLimitBurst), zap.Int("max_concurrent_compilations", cfg.MaxConcurrentCompilations), zap.Int("max_concurrent_compilations_per_ip", cfg.MaxConcurrentCompilationsPerIP))

	// Base image preload (pull once at startup so first user request is fast)
	baseRef := cfg.SandboxBaseImage
	ctx := namespaces.WithNamespace(context.Background(), "compiler")
	if _, cached, err := ensureBaseImage(ctx, baseRef); err != nil {
		logger.Fatal("preload base image", zap.String("image", baseRef), zap.Error(err))
	} else {
		logger.Info("base image ready", zap.String("image", baseRef), zap.Bool("cached", cached))
	}

	// Kata exec timeout from config
	kataExecTimeout = cfg.KataExecTimeout
	logger.Info("kata exec timeout configured", zap.Duration("timeout", kataExecTimeout))

	// Initialize SQLite DB for history
	if err := initDB(); err != nil {
		logger.Fatal("init db", zap.Error(err))
	}
	logger.Info("sqlite history ready")

	// Prepare JWT secret (in jwt.go). Falls back to ADMIN_PASS if JWT secret env not set.
	if err := initJWT(); err != nil {
		logger.Fatal("init jwt", zap.Error(err))
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch p {
		case "/":
			p = "index.html"
		case "/compiler":
			p = "compiler.html"
		default:
			// trim leading slash for consistent relative handling
			p = strings.TrimPrefix(p, "/")
		}
		// clean path and reject traversal attempts
		clean := filepath.Clean(p)
		if clean == "." {
			clean = "index.html"
		}
		// reject any attempt to escape web root
		if strings.Contains(clean, "..") || strings.HasPrefix(clean, string(os.PathSeparator)) {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}
		full := filepath.Join("web", clean)
		if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
			http.ServeFile(w, r, full)
			return
		}
		http.NotFound(w, r)
	})
	// Rate limiter configuration for public compile endpoint
	ratePerMin := cfg.RateLimitPerMin
	burst := cfg.RateLimitBurst
	ipLimiter := newIPLimiter(ratePerMin, burst)

	// Separate limiter for admin login
	adminRatePerMin := cfg.AdminLoginRateLimitPerMin
	adminBurst := cfg.AdminLoginRateLimitBurst
	adminLimiter := newIPLimiter(adminRatePerMin, adminBurst)
	go adminLimiter.cleanupLoop()

	logger.Info("rate limiters configured", zap.Int("compile_per_min", ratePerMin), zap.Int("compile_burst", burst), zap.Int("admin_login_per_min", adminRatePerMin), zap.Int("admin_login_burst", adminBurst))
	go ipLimiter.cleanupLoop()
	http.Handle("/compile", rateLimitMiddleware(http.HandlerFunc(compileHandler), ipLimiter))

	//protected endpoints
	http.HandleFunc("/stats", requireAdmin(statsHandler))
	http.HandleFunc("/history", requireAdmin(historyHandler))
	http.HandleFunc("/logs", requireAdmin(logsHandler))
	http.HandleFunc("/observability", requireAdmin(observabilityHandler))
	http.HandleFunc("/admin", requireAdmin(adminHandler))
	http.HandleFunc("/admin/observability", requireAdmin(adminObservabilityHandler))
	http.Handle("/adminLogin", rateLimitMiddleware(http.HandlerFunc(adminHandlerLogin), adminLimiter))

	addr := ":" + cfg.Port
	logger.Info("server starting", zap.String("addr", addr))
	if err := http.ListenAndServe(addr, nil); err != nil {
		logger.Fatal("server exited", zap.Error(err))
	}
}

// métricas removidas
