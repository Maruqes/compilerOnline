## compilerOnline

A small web service that compiles and runs code for a custom language inside an isolated Kata (lightweight VM) instance each time you press Run. Everything is thrown away after the run. A simple web UI for users, a tiny password + JWT protected area for you.

### What it does
1. You send code to `/compile`.
2. It spins up a short‑lived Kata container (Ubuntu base), mounts the `lang/` folder read‑only.
3. It writes your code to `test.lang`, runs `./compiler test.lang out`, then runs `./out`.
4. Stdout + stderr are captured (size capped) and returned.
5. A record (time, code, output, error) is stored in SQLite.
6. Each execution now stores the originating client IP for audit/rate limiting groundwork.

### Why Kata?
Stronger isolation than a plain container: lightweight VM boundary + resource limits (CPU quota, 128MB RAM, pid, rlimits, configurable wall clock timeout).

### Files that matter
- `compileit.go` – does the sandbox run
- `main.go` – HTTP server & wiring
- `db.go` – execution history (SQLite)
- `logger.go` – structured logs also in SQLite
- `jwt.go` – admin auth
- `lang/` – your language toolchain + stdlib
- `web/` – static pages (user UI + admin)

### .env (must exist)
Required:
```
PORT=8080          # Port to listen on
ADMIN_USER=admin   # Admin login
ADMIN_PASS=changeThisPassword_2025!  # Also fallback JWT secret
```
Optional:
```
JWT_SECRET=superLongRandomSecretValueAtLeast16  # If set, replaces fallback
LOG_LEVEL=info   # debug|info|warn|error (default info)
RATE_LIMIT_PER_MIN=30   # Max average requests per minute per IP to /compile (default 30)
RATE_LIMIT_BURST=30     # Burst capacity (default equals RATE_LIMIT_PER_MIN)
KATA_EXEC_TIMEOUT_SECONDS=10  # Wall clock timeout for a single execution (default 10 if unset/<=0)
```
Rules:
- JWT secret (or admin pass) must be at least 16 chars.
- If `.env` is missing the program exits.

See `https://github.com/kata-containers/kata-containers/tree/main/docs/install`

### Run
Needs Linux + containerd + Kata runtime installed & working.
```bash
./compiler-online
```
Open: `http://localhost:8080/`

Admin login: visit `/adminLogin` (uses cookie `admintoken`). Protected: `/admin`, `/stats`, `/history`, `/logs`.

### Data
- History: `data/containers.db` (old rows >90 days pruned daily)
- Logs: `data/logs.sql` (structured JSON style + stack on errors)
- History columns: `container_id, created_at, finished_at, execution_time_ms, ip, code_executed, output, error_message`


### Typical problems
| Symptom                           | Fix                                          |
| --------------------------------- | -------------------------------------------- |
| "environment file does not exist" | Add `.env`                                   |
| "need root or sudo not found"     | Install sudo or run as root                  |
| "missing lang directory"          | Ensure `lang/` exists with `compiler` inside |
| Long first run                    | Pulling Ubuntu image                         |
| JWT secret too short              | Use ≥16 chars                                |
| Execution always stops at N sec   | Adjust `KATA_EXEC_TIMEOUT_SECONDS`           |

### Hardening ideas (not done yet)
- Rate limiting / quotas
- Disable outbound network / shrink base image
- Separate metrics endpoint (Prometheus)

### Dev quick start (skip .env loading complaints by creating one)
```bash
cat > .env <<EOF
PORT=8080
ADMIN_USER=admin
ADMIN_PASS=changeThisPassword_2025!
LOG_LEVEL=debug
EOF
go run .
```

### License
See `LICENSE`.

