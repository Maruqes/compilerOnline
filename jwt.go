package main

import (
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

var jwtSecret []byte

// initJWT loads secret from env (JWT_SECRET) or falls back to ADMIN_PASS.
func initJWT() error {
	sec := os.Getenv("JWT_SECRET")
	if sec == "" {
		sec = adminPass // already validated in main
	}
	if len(sec) < 16 { // basic strength guard
		return errors.New("jwt secret too short (<16 chars)")
	}
	jwtSecret = []byte(sec)
	return nil
}

// issueJWT creates a signed JWT with a short expiration.
func issueJWT(username string) (string, error) {
	claims := jwt.MapClaims{
		"sub":  username,
		"role": "admin",
		"exp":  time.Now().Add(4 * time.Hour).Unix(),
		"iat":  time.Now().Unix(),
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(jwtSecret)
}

// parseJWT validates token string and returns claims.
func parseJWT(tokenStr string) (jwt.MapClaims, error) {
	tok, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Name}))
	if err != nil {
		return nil, err
	}
	if claims, ok := tok.Claims.(jwt.MapClaims); ok && tok.Valid {
		return claims, nil
	}
	return nil, errors.New("invalid token")
}

// requireAdmin verifies Authorization Bearer JWT.
func requireAdmin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Accept token via Authorization header or cookie "admintoken"
		var tokenStr string
		authH := r.Header.Get("Authorization")
		if strings.HasPrefix(strings.ToLower(authH), "bearer ") {
			tokenStr = strings.TrimSpace(authH[7:])
		}
		if tokenStr == "" {
			if c, err := r.Cookie("admintoken"); err == nil {
				tokenStr = c.Value
			}
		}
		redirectToLogin := func() {
			if r.Method == http.MethodGet && strings.Contains(r.Header.Get("Accept"), "text/html") {
				http.Redirect(w, r, "/adminLogin", http.StatusFound)
				return
			}
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		if tokenStr == "" {
			redirectToLogin()
			return
		}
		claims, err := parseJWT(tokenStr)
		if err != nil {
			redirectToLogin()
			return
		}
		// simple role check
		if role, _ := claims["role"].(string); role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h(w, r)
	}
}

// adminHandlerLogin handles POST {username,password} and returns JWT.
func adminHandlerLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		(http.ServeFile)(w, r, "web/adminLogin.html")
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return
	}
	user := r.FormValue("username")
	pass := r.FormValue("password")
	if user != adminUser || pass != adminPass {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	token, err := issueJWT(user)
	if err != nil {
		logger.Error("jwt issue", zap.Error(err))
		http.Error(w, "token error", http.StatusInternalServerError)
		return
	}
	// Set httpOnly cookie
	http.SetCookie(w, &http.Cookie{Name: "admintoken", Value: token, Path: "/", HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode, Expires: time.Now().Add(4 * time.Hour)})
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte("{\"token\":\"" + token + "\"}"))
}

// adminHandler serves admin.html (protected by JWT middleware).
func adminHandler(w http.ResponseWriter, r *http.Request) {
	(http.ServeFile)(w, r, "web/admin.html")
}
