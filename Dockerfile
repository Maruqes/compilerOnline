# syntax=docker/dockerfile:1.7

# ---- build stage ----
FROM golang:1.26-bookworm AS builder

# CGO is required by github.com/mattn/go-sqlite3
ENV CGO_ENABLED=1 \
    GOOS=linux \
    GOARCH=amd64

# gcc/g++ are needed to build the cgo sqlite3 binding
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Cache module downloads
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source
COPY . .

# Build the server binary
RUN go build -trimpath -o /out/compilerOnline .

# ---- runtime stage ----
FROM debian:bookworm-slim AS runtime

# Minimal runtime deps:
#  - ca-certificates: required to pull docker.io/library/busybox:latest over HTTPS
#  - mount/umount/util-linux: used indirectly by containerd/kata helpers
#  - sqlite3: optional, useful for inspecting data/containers.db from inside the container
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        util-linux \
        sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Non-root default; the container is run with --privileged when Kata is in use,
# but we keep the user for the HTTP server process. The Go app re-executes
# itself with sudo when not root, but inside Docker we run as root directly
# (see docker-compose: user: root), so this is mostly informational.
RUN groupadd --system --gid 1000 app \
    && useradd --system --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

# Copy the compiled binary
COPY --from=builder /out/compilerOnline /app/compilerOnline

# Static assets are bind-mounted at runtime (lang/, web/, data/, .env) so that
# image rebuilds are not needed when only the assets change. We still create
# the directories so the bind-mount targets exist.
RUN mkdir -p /app/lang /app/web /app/data /app/mnt

# SQLite DBs live under /app/data and are bind-mounted from the host for persistence
VOLUME ["/app/data"]

EXPOSE 8080

# The Go program calls os.Geteuid() and tries to re-exec with sudo when not
# root. Inside Docker we always run as root, so that path is never taken.
ENTRYPOINT ["/app/compilerOnline"]
