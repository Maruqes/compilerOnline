package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

	"github.com/containerd/containerd"
	"github.com/containerd/containerd/namespaces"
	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

var logger *zap.Logger
var adminUser string
var adminPass string

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

	// Executar e capturar dados para histórico
	result, containerRecord, err := execInKataWithHistory(code)
	if err != nil {
		logger.Error("code execution failed", zap.Error(err))
		// Persist even on error
		if containerRecord != nil {
			containerRecord.ErrorMessage = err.Error()
			if dbErr := saveContainerRecordDB(containerRecord); dbErr != nil {
				logger.Error("failed to persist error record", zap.Error(dbErr))
			}
		}
		http.Error(w, "Error during code execution (probably 5 sec timeout)\n"+result, http.StatusInternalServerError)
		return
	}

	// Persist success
	if containerRecord != nil {
		if dbErr := saveContainerRecordDB(containerRecord); dbErr != nil {
			logger.Error("failed to persist record", zap.Error(dbErr))
		}
	}

	logger.Info("code executed successfully")
	w.Write([]byte(result))
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
	logs, err := listRecentLogs(limit)
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
	}{Logs: logs, Count: len(logs), Limit: limit})
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
	http.HandleFunc("/compile", compileHandler)

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
