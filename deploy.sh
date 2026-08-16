#!/usr/bin/env bash
set -euo pipefail

# Build and deploy the package to a remote host (global npm install location).
# Default target host is: mqtt-ifaces
#
# Usage:
#   bash deploy.sh
#   bash deploy.sh myuser@myhost
#
# Optional env vars:
#   REMOTE_DIR   (default: /usr/local/lib/node_modules/lgtv2mqtt)
#   REMOTE_TMP   (default: /tmp)
#   SERVICE      (default: lgtv2mqtt) systemd unit to restart after deploying

REMOTE_HOST="${1:-mqtt-ifaces}"
REMOTE_DIR="${REMOTE_DIR:-/usr/local/lib/node_modules/lgtv2mqtt}"
REMOTE_TMP="${REMOTE_TMP:-/tmp}"
SERVICE="${SERVICE:-lgtv2mqtt}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' not found." >&2
    exit 1
  fi
}

require_cmd npm
require_cmd scp
require_cmd ssh
require_cmd tar

echo "Packing npm module..."
TGZ_FILE="$(npm pack --silent | tail -n 1)"

if [[ ! -f "$TGZ_FILE" ]]; then
  echo "Error: npm pack did not produce a tarball." >&2
  exit 1
fi

echo "Created tarball: $TGZ_FILE"

echo "Copying tarball to ${REMOTE_HOST}:${REMOTE_TMP}/..."
/usr/bin/keychain -q --nogui ~/.ssh/id_ed25519; source ~/.keychain/infinite-sh; scp "$TGZ_FILE" "${REMOTE_HOST}:${REMOTE_TMP}/"

REMOTE_TGZ="${REMOTE_TMP}/$(basename "$TGZ_FILE")"

echo "Deploying on remote host..."
/usr/bin/keychain -q --nogui ~/.ssh/id_ed25519; source ~/.keychain/infinite-sh; ssh "$REMOTE_HOST" "REMOTE_TGZ='$REMOTE_TGZ' REMOTE_DIR='$REMOTE_DIR' SERVICE='$SERVICE' bash -s" <<'EOF'
set -euo pipefail

if [[ ! -f "$REMOTE_TGZ" ]]; then
  echo "Error: remote tarball not found: $REMOTE_TGZ" >&2
  exit 1
fi

sudo mkdir -p "$REMOTE_DIR"
sudo find "$REMOTE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
sudo tar -xzf "$REMOTE_TGZ" -C "$REMOTE_DIR" --strip-components=1
sudo npm install --omit=dev --prefix "$REMOTE_DIR"
sudo systemctl restart "$SERVICE"
sudo rm -f "$REMOTE_TGZ"
EOF

echo "Cleaning up local tarball..."
rm -f "$TGZ_FILE"

echo "Deployment complete."
