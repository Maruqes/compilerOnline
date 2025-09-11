package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/joho/godotenv"
)

func compileHandler(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		http.Error(w, "code not provided", http.StatusBadRequest)
		return
	}

	result, err := execInKata(code)
	if err != nil {
		fmt.Println("Error during code execution", err)
		http.Error(w, "Error during code execution (probably 5 sec timeout)\n"+result, http.StatusInternalServerError)
		return
	}

	w.Write([]byte(result))
}

func main() {

	//ask for sudo if not root
	if os.Geteuid() != 0 {
		sudoPath, lookErr := exec.LookPath("sudo")
		if lookErr != nil {
			log.Fatalf("need root or sudo not found: %v", lookErr)
		}
		args := append([]string{"-E", os.Args[0]}, os.Args[1:]...)
		cmd := exec.Command(sudoPath, args...)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		if runErr := cmd.Run(); runErr != nil {
			log.Fatalf("sudo elevation failed: %v", runErr)
		}
		return
	}

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
	log.Printf("Server starting on %s...", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
