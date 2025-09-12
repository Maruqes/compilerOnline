package main

import (
	"net/http"
	"sync"
	"time"
)

// ipLimiter manages token buckets per IP.
type ipLimiter struct {
	mu      sync.Mutex
	buckets map[string]*tokenBucket
	rate    float64       // tokens per second
	burst   int           // max tokens
	ttl     time.Duration // idle bucket eviction
}

type tokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

func newIPLimiter(ratePerMinute int, burst int) *ipLimiter {
	if ratePerMinute <= 0 {
		ratePerMinute = 30
	}
	if burst <= 0 {
		burst = ratePerMinute
	}
	return &ipLimiter{
		buckets: make(map[string]*tokenBucket),
		rate:    float64(ratePerMinute) / 60.0,
		burst:   burst,
		ttl:     10 * time.Minute,
	}
}

func (l *ipLimiter) allow(ip string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[ip]
	if !ok {
		b = &tokenBucket{tokens: float64(l.burst - 1), lastRefill: now}
		l.buckets[ip] = b
		return true
	}
	// Refill
	elapsed := now.Sub(b.lastRefill).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * l.rate
		if b.tokens > float64(l.burst) {
			b.tokens = float64(l.burst)
		}
		b.lastRefill = now
	}
	if b.tokens >= 1 {
		b.tokens -= 1
		return true
	}
	return false
}

// cleanup removes old buckets occasionally; call in background.
func (l *ipLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	for range ticker.C {
		cutoff := time.Now().Add(-l.ttl)
		l.mu.Lock()
		for k, b := range l.buckets {
			if b.lastRefill.Before(cutoff) {
				delete(l.buckets, k)
			}
		}
		l.mu.Unlock()
	}
}

func rateLimitMiddleware(next http.Handler, limiter *ipLimiter) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractClientIP(r)
		if !limiter.allow(ip) {
			w.Header().Set("Retry-After", "1")
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}
