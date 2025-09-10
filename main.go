package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
)

func compileHandler(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		http.Error(w, "code not provided", http.StatusBadRequest)
		return
	}

	// output, err := compile(code)
	// if err != nil {
	// 	http.Error(w, err.Error(), http.StatusInternalServerError)
	// 	return
	// }

	// w.Write([]byte(output))
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
