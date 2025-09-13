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
var kataExecTimeout time.Duration

// (history JSON removed; using SQLite DB)

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

	// Inicializa logger custom que grava em SQLite (data/logs.sql)
	logDBPath := "data/logs.sql" // extensão .sql como solicitado
	l, err := InitAppLogger(logDBPath, os.Getenv("LOG_LEVEL"))
	if err != nil {
		panic(fmt.Sprintf("cannot init sqlite logger: %v", err))
	}
	defer l.Sync()
	logger = l

	const envFile = ".env"

	if _, err := os.Stat(envFile); os.IsNotExist(err) {
		logger.Fatal("environment file does not exist", zap.String("file", envFile))
	}

	if err := godotenv.Load(envFile); err != nil {
		logger.Fatal("error loading env file", zap.String("file", envFile), zap.Error(err))
	}

	port := os.Getenv("PORT")
	if port == "" {
		logger.Fatal("missing PORT env variable", zap.String("file", envFile))
	}

	adminUser = os.Getenv("ADMIN_USER")
	if adminUser == "" {
		logger.Fatal("missing ADMIN_USER env variable (username for protected endpoints)")
	}
	adminPass = os.Getenv("ADMIN_PASS")
	if adminPass == "" {
		logger.Fatal("missing ADMIN_PASS env variable (password for protected endpoints)")
	}

	// Kata exec timeout (seconds); default 10 if unset/invalid/<=0
	kataExecTimeout = 10 * time.Second
	if v := os.Getenv("KATA_EXEC_TIMEOUT_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			kataExecTimeout = time.Duration(n) * time.Second
		}
	}
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
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		if path == "/compiler" {
			path = "/compiler.html"
		}
		full := filepath.Join("web", filepath.Clean(path))
		if _, err := os.Stat(full); err == nil {
			http.ServeFile(w, r, full)
			return
		}
		http.NotFound(w, r)
	})
	// Rate limiter configuration
	ratePerMin := 30
	if v := os.Getenv("RATE_LIMIT_PER_MIN"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			ratePerMin = n
		}
	}
	burst := ratePerMin
	if v := os.Getenv("RATE_LIMIT_BURST"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			burst = n
		}
	}
	ipLimiter := newIPLimiter(ratePerMin, burst)
	go ipLimiter.cleanupLoop()
	http.Handle("/compile", rateLimitMiddleware(http.HandlerFunc(compileHandler), ipLimiter))

	//protected endpoints
	http.HandleFunc("/stats", requireAdmin(statsHandler))
	http.HandleFunc("/history", requireAdmin(historyHandler))
	http.HandleFunc("/logs", requireAdmin(logsHandler))
	http.HandleFunc("/admin", requireAdmin(adminHandler))
	http.HandleFunc("/adminLogin", adminHandlerLogin)

	addr := ":" + port
	logger.Info("server starting", zap.String("addr", addr))
	if err := http.ListenAndServe(addr, nil); err != nil {
		logger.Fatal("server exited", zap.Error(err))
	}
}

// métricas removidas
