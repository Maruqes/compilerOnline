## compilerOnline

A small web service that compiles and runs code for a custom language inside an isolated Kata (lightweight VM) instance each time you press Run. Everything is thrown away after the run. A simple web UI for users, a tiny password + JWT protected area for you.

### What it does
1. You send code to `/compile`.
2. It spins up a short‑lived Kata container (BusyBox base), mounts the `lang/` folder read‑only.
3. It writes your code to `test.lang`, runs `./compiler test.lang out`, then runs `./out`.
4. Stdout + stderr are captured (size capped) and returned.
5. A record (time, code, output, error) is stored in SQLite.
6. Each execution now stores the originating client IP for audit/rate limiting groundwork.

### Why Kata?
Stronger isolation than a plain container: lightweight VM boundary + resource limits (CPU quota, 128MB RAM, pid, rlimits, configurable wall clock timeout).

### Prerequisites

- A Linux host with **containerd** running.
- For the default `io.containerd.kata.v2` runtime, the host kernel must provide the Kata/Firecracker virtio/vsock modules. Load them before starting the service:
  ```bash
  sudo modprobe vhost
  sudo modprobe vhost_net
  sudo modprobe vhost_vsock
  ```
  To make this persist across reboots:
  ```bash
  echo -e "vhost\nvhost_net\nvhost_vsock" | sudo tee /etc/modules-load.d/kata-containers.conf
  ```
  Verify Kata can use the host:
  ```bash
  sudo kata-runtime check
  ```
- If Kata is not available or you want faster (but less isolated) startup, set `SANDBOX_RUNTIME=io.containerd.runc.v2` in `.env`.

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
SANDBOX_RUNTIME=io.containerd.kata.v2  # Override container runtime; set to io.containerd.runc.v2 for faster (less isolated) startup
SANDBOX_CPU_QUOTA_PERCENT=10          # Integer percent of a single CPU period (100000). 0 to remove quota. Default ~10% if unset.
ADMIN_LOGIN_RATE_LIMIT_PER_MIN=20     # Brute force protection for /adminLogin (default 20)
ADMIN_LOGIN_RATE_LIMIT_BURST=20       # Burst for login attempts (default = per-min)
SANDBOX_BASE_IMAGE=docker.io/library/busybox:latest  # Pulled & cached once at startup
# SANDBOX_ALLOW_ANY_IMAGE=1            # Disable base image allowlist (use with caution)
JWT_TTL_MINUTES=240                   # Admin JWT lifetime (1-1440 minutes)
JWT_AUDIENCE=prod-admin               # Optional audience claim
LANG_DIR=/opt/compilerOnline/lang     # Path to the language toolchain (default: ./lang relative to CWD)
```
Rules:
- JWT secret (or admin pass) must be at least 16 chars.
- If `.env` is missing the program exits.

### Automated deployment (systemd)

A deploy script installs the service under `/opt/compilerOnline`, builds the binary, loads the Kata kernel modules, and registers a systemd unit.

On the target VM, from the project root:

```bash
sudo ./scripts/deploy.sh
```

After that it runs automatically on boot:

```bash
sudo systemctl status compileronline
sudo systemctl restart compileronline
```

The service uses `LANG_DIR=/opt/compilerOnline/lang` by default, so it does not depend on the current working directory.

### Base Image Preload
At startup the service pulls `SANDBOX_BASE_IMAGE` (defaults to `docker.io/library/busybox:latest`) using containerd and caches it so the first compile is fast. To reduce supply‑chain risk only `docker.io/library/*` images are allowed unless you set `SANDBOX_ALLOW_ANY_IMAGE=1`.

Change the base image by setting:
```
SANDBOX_BASE_IMAGE=docker.io/library/busybox:latest
```
Restart the service; the new image will be used for subsequent ephemeral sandboxes.

See `https://github.com/kata-containers/kata-containers/tree/main/docs/install`

### License
See `LICENSE`.

