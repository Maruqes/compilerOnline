#!/usr/bin/env bash
set -euo pipefail

# Deploy compilerOnline as a systemd service.
# Run as root on the target VM.

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="/opt/compilerOnline"

if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root (use sudo)." >&2
    exit 1
fi

echo "==> Installing project to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
rsync -a --delete "${PROJECT_DIR}/" "${INSTALL_DIR}/"

echo "==> Building Go binary..."
cd "${INSTALL_DIR}"
go build -o compilerOnline .

echo "==> Setting up Kata host prerequisites..."
cp "${INSTALL_DIR}/scripts/setup-kata.sh" /usr/local/bin/compileronline-setup-kata.sh
chmod +x /usr/local/bin/compileronline-setup-kata.sh
/usr/local/bin/compileronline-setup-kata.sh

echo "==> Installing systemd service..."
cp "${INSTALL_DIR}/scripts/compileronline.service" /etc/systemd/system/compileronline.service
systemctl daemon-reload
systemctl enable compileronline.service

echo "==> Starting service..."
systemctl restart compileronline.service

echo "==> Status:"
systemctl status compileronline.service --no-pager

echo "==> Done. compilerOnline is running on port ${PORT:-8080}."
