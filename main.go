package main

import (
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

	// Retorna apenas o nome base do ficheiro.
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

	cmd := exec.Command("./compiler", fileName, outputName)
	fmt.Println("command", cmd, "outputName", outputName)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("erro ao compilar: %v, output: %s", err, output)
	}

	cmd = exec.Command("./" + outputName)
	output, err = cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("erro ao executar o output: %v, output: %s", err, output)
	}

	return string(output), nil
}

func compileHandler(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		http.Error(w, "código não fornecido", http.StatusBadRequest)
		return
	}

	output, err := compile(code)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Write([]byte(output))
}

func main() {
	const envFile = ".env"

	if _, err := os.Stat(envFile); os.IsNotExist(err) {
		log.Fatalf("Ficheiro de ambiente %s não existe", envFile)
	}

	if err := godotenv.Load(envFile); err != nil {
		log.Fatalf("Erro ao carregar %s: %v", envFile, err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		log.Fatalf("Variável PORT não definida em %s", envFile)
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("Olá, Mundo!"))
	})
	http.HandleFunc("/compile", compileHandler)
	addr := ":" + port
	log.Printf("Servidor a iniciar no %s...", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
