package main

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config centralizes all environment-driven settings.
// Add new fields here and in LoadConfig.
type Config struct {
	Port                      string
	LogLevel                  string
	AdminUser                 string
	AdminPass                 string
	JWTSecret                 string
	SandboxBaseImage          string
	SandboxRuntime            string
	SandboxCPUQuotaPercent    int // 0 means unlimited / not set
	KataExecTimeout           time.Duration
	RateLimitPerMin           int
	RateLimitBurst            int
	AdminLoginRateLimitPerMin int
	AdminLoginRateLimitBurst  int
}

func LoadConfig() (*Config, error) {
	c := &Config{
		Port:                      getEnvDefault("PORT", "8080"),
		LogLevel:                  getEnvDefault("LOG_LEVEL", "info"),
		AdminUser:                 os.Getenv("ADMIN_USER"),
		AdminPass:                 os.Getenv("ADMIN_PASS"),
		JWTSecret:                 os.Getenv("JWT_SECRET"),
		SandboxBaseImage:          getEnvDefault("SANDBOX_BASE_IMAGE", "docker.io/library/busybox:latest"),
		SandboxRuntime:            getEnvDefault("SANDBOX_RUNTIME", "io.containerd.kata.v2"),
		SandboxCPUQuotaPercent:    getEnvInt("SANDBOX_CPU_QUOTA_PERCENT", 0),
		KataExecTimeout:           getEnvDurationSeconds("KATA_EXEC_TIMEOUT_SECONDS", 10),
		RateLimitPerMin:           getEnvInt("RATE_LIMIT_PER_MIN", 60),
		RateLimitBurst:            getEnvInt("RATE_LIMIT_BURST", 80),
		AdminLoginRateLimitPerMin: getEnvInt("ADMIN_LOGIN_RATE_LIMIT_PER_MIN", 15),
		AdminLoginRateLimitBurst:  getEnvInt("ADMIN_LOGIN_RATE_LIMIT_BURST", 10),
	}

	if c.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	return c, nil
}

func getEnvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}

func getEnvDurationSeconds(key string, defSeconds int) time.Duration {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil && i > 0 {
			return time.Duration(i) * time.Second
		}
	}
	return time.Duration(defSeconds) * time.Second
}
