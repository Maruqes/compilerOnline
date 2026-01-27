package main

import (
	"fmt"
	"sync"
)

type concurrencyLimiter struct {
	mu       sync.Mutex
	total    int
	perIP    map[string]int
	maxTotal int
	maxPerIP int
}

func newConcurrencyLimiter(maxTotal, maxPerIP int) *concurrencyLimiter {
	if maxTotal < 0 {
		maxTotal = 0
	}
	if maxPerIP < 0 {
		maxPerIP = 0
	}
	return &concurrencyLimiter{
		perIP:    make(map[string]int),
		maxTotal: maxTotal,
		maxPerIP: maxPerIP,
	}
}

// tryAcquire reserves a slot for a compilation and returns a release func.
// max values <= 0 mean "unlimited" for that dimension.
func (l *concurrencyLimiter) tryAcquire(ip string) (func(), bool, string, int, int) {
	if l == nil {
		return func() {}, true, "", 0, 0
	}
	if ip == "" {
		ip = "unknown"
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.maxTotal > 0 && l.total >= l.maxTotal {
		return nil, false, fmt.Sprintf("too many concurrent compilations (limit %d)", l.maxTotal), l.total, l.perIP[ip]
	}
	if l.maxPerIP > 0 {
		if l.perIP == nil {
			l.perIP = make(map[string]int)
		}
		if l.perIP[ip] >= l.maxPerIP {
			return nil, false, fmt.Sprintf("too many concurrent compilations from this IP (limit %d)", l.maxPerIP), l.total, l.perIP[ip]
		}
	}

	l.total++
	if l.maxPerIP > 0 {
		l.perIP[ip]++
	}
	currentTotal := l.total
	currentPerIP := l.perIP[ip]

	released := false
	release := func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		if released {
			return
		}
		released = true
		if l.total > 0 {
			l.total--
		} else {
			l.total = 0
		}
		if l.maxPerIP > 0 {
			if current := l.perIP[ip] - 1; current <= 0 {
				delete(l.perIP, ip)
			} else {
				l.perIP[ip] = current
			}
		}
	}

	return release, true, "", currentTotal, currentPerIP
}
