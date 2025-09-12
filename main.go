package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

var logger *zap.Logger

func compileHandler(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		logger.Warn("code not provided")
		http.Error(w, "code not provided", http.StatusBadRequest)
		return
	}

	result, err := execInKata(code)
	if err != nil {
		logger.Error("code execution failed", zap.Error(err))
		http.Error(w, "Error during code execution (probably 5 sec timeout)\n"+result, http.StatusInternalServerError)
		return
	}

	logger.Info("code executed successfully")
	w.Write([]byte(result))
}

func main() {
	// initialize zap logger (production config; swap for zap.NewDevelopment() if needed)
	l, err := zap.NewProduction()
	if err != nil {
		panic(fmt.Sprintf("cannot init logger: %v", err))
	}
	defer l.Sync() // flushes buffer, if any
	logger = l

	//ask for sudo if not root
	if os.Geteuid() != 0 {
		sudoPath, lookErr := exec.LookPath("sudo")
		if lookErr != nil {
			logger.Fatal("need root or sudo not found", zap.Error(lookErr))
		}
		args := append([]string{"-E", os.Args[0]}, os.Args[1:]...)
		cmd := exec.Command(sudoPath, args...)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		if runErr := cmd.Run(); runErr != nil {
			logger.Fatal("sudo elevation failed", zap.Error(runErr))
		}
		return
	}

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

	addr := ":" + port
	logger.Info("server starting", zap.String("addr", addr))
	if err := http.ListenAndServe(addr, nil); err != nil {
		logger.Fatal("server exited", zap.Error(err))
	}
}
