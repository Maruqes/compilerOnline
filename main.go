package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/joho/godotenv"
)

func createFile(code string) (string, error) {
	tmpFile, err := os.CreateTemp("./compilerFile", "code-*.code")
	if err != nil {
		return "", err
	}

	if _, err := tmpFile.Write([]byte(code)); err != nil {
		tmpFile.Close()
		return "", err
	}

	if err := tmpFile.Close(); err != nil {
		return "", err
	}

	// Returns only the base filename
	return filepath.Base(tmpFile.Name()), nil
}

func compile(code string) (string, error) {
	originalDir, err := os.Getwd()
	if err != nil {
		return "", err
	}

	fileName, err := createFile(code)
	if err != nil {
		return "", err
	}
	absCodePath := filepath.Join(originalDir, "compilerFile", fileName)
	defer os.Remove(absCodePath)

	if err := os.Chdir("./compilerFile"); err != nil {
		return "", err
	}
	defer func() {
		os.Chdir(originalDir)
	}()

	outputName := fmt.Sprintf("output-%d", time.Now().UnixNano())
	absOutputPath := filepath.Join(originalDir, "compilerFile", outputName)
	defer os.Remove(absOutputPath)

	// compile the code
	cmd := exec.Command("./compiler", fileName, outputName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("error compiling: %v, output: %s", err, output)
	}

	// mark the binary as executable on the host
	if err := os.Chmod(filepath.Join(originalDir, "compilerFile", outputName), 0755); err != nil {
		return "", fmt.Errorf("could not make binary executable: %v", err)
	}

	// Prepare a less restrictive seccomp
	seccompProfile := filepath.Join(originalDir, "compilerFile", "seccomp.json")
	workDir := filepath.Join(originalDir, "compilerFile")

	// Timeout of 30 seconds to avoid infinite loops
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Attempt execution with SYS_PTRACE privileges that may be necessary
	// for some memory operations
	dockerCmd := exec.CommandContext(
		ctx,
		"docker", "run", "--rm", "--user", "root",
		// More generous resource settings
		"--memory=256m",
		"--cpus=1",
		// Add capabilities that may help with memory operations
		"--cap-add=SYS_PTRACE",
		// Still use seccomp, but with additional flags
		"--security-opt", "seccomp="+seccompProfile,
		// Add time limit for the container directly in Docker
		"--stop-timeout=30",
		// Mount with read-write to allow operations
		"-v", fmt.Sprintf("%s:/app:rw,Z", workDir),
		"-w", "/app",
		// Use a more complete image
		"ubuntu:22.04",
		"/bin/bash", "-c", fmt.Sprintf("chmod +x %s || true; timeout 30s ./%s || echo \"Program terminated: exit code $?\"", outputName, outputName),
	)

	output, err = dockerCmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return "Execution exceeded the time limit (30s) and was terminated", nil
		}

		// Check if we have any useful output despite the error
		if len(output) > 0 {
			// If the program was terminated by timeout, return a more user-friendly message
			if string(output) == "Program terminated: exit code 124" {
				return "The program exceeded the execution time limit (30s) and was terminated", nil
			}
			return string(output), nil
		}

		return "", fmt.Errorf("error executing in docker: %v", err)
	}

	return string(output), nil
}

func compileHandler(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		http.Error(w, "code not provided", http.StatusBadRequest)
		return
	}

	output, err := compile(code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(output))
}

func serveFile(filename string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := os.ReadFile(filepath.Join("compilerFile", filename))
		if err != nil {
			http.Error(w, fmt.Sprintf("Error reading file: %v", err), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		w.Write(data)
	}
}

func main() {
	const envFile = ".env"

	if _, err := os.Stat(envFile); os.IsNotExist(err) {
		log.Fatalf("Environment file %s does not exist", envFile)
	}

	if err := godotenv.Load(envFile); err != nil {
		log.Fatalf("Error loading %s: %v", envFile, err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		log.Fatalf("Environment variable PORT not set in %s", envFile)
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})
	http.HandleFunc("/compile", compileHandler)

	// New endpoints for serving the library files
	http.HandleFunc("/api/floats", serveFile("floats"))
	http.HandleFunc("/api/strings", serveFile("strings"))
	http.HandleFunc("/api/arrays", serveFile("arrays"))

	addr := ":" + port
	log.Printf("Server starting on %s...", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
