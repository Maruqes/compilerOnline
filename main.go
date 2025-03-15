package main

import (
	"log"
	"net/http"
	"os"

	"github.com/joho/godotenv"
)

func main() {
	const envFile = ".env"

	// Check if the .env file exists.
	if _, err := os.Stat(envFile); os.IsNotExist(err) {
		log.Fatalf("Environment file %s does not exist", envFile)
	}

	// Load the environment variables.
	if err := godotenv.Load(envFile); err != nil {
		log.Fatalf("Error loading %s: %v", envFile, err)
	}

	// Get the port from the environment variable.
	port := os.Getenv("PORT")
	if port == "" {
		log.Fatalf("PORT variable not set in %s", envFile)
	}

	// Set up a simple HTTP handler.
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Hello, World!"))
	})
	addr := ":" + port
	log.Printf("Server starting on %s...", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
