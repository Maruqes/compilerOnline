#!/usr/bin/env bash
set -euo pipefail

# One-time host setup for Kata Containers on Fedora/RHEL-like systems.
# Loads required virtio/vsock modules and makes them persistent.

if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root (use sudo)." >&2
    exit 1
fi

echo "==> Loading Kata kernel modules..."
modprobe vhost || true
modprobe vhost_net || true
modprobe vhost_vsock || true

echo "==> Persisting modules across reboots..."
mkdir -p /etc/modules-load.d
cat >/etc/modules-load.d/kata-containers.conf <<'EOF'
vhost
vhost_net
vhost_vsock
EOF

echo "==> Verifying vsock device..."
if [[ -c /dev/vsock ]]; then
    echo "    /dev/vsock OK"
else
    echo "    WARNING: /dev/vsock not found" >&2
fi

echo "==> Running kata-runtime check..."
if command -v kata-runtime >/dev/null 2>&1; then
    kata-runtime check
else
    echo "    WARNING: kata-runtime not found in PATH" >&2
fi

echo "==> Done."
