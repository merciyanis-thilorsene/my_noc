#!/bin/sh
# Generates /usr/share/nginx/html/config.js from env at container start.
# Runs from nginx's /docker-entrypoint.d/ before nginx boots.
set -eu

BACKEND_URL="${BACKEND_URL:-}"
WS_URL="${WS_URL:-}"

cat > /usr/share/nginx/html/config.js <<EOF
window.__NOC_CONFIG__ = {
  backendUrl: "${BACKEND_URL}",
  wsUrl: "${WS_URL}"
};
EOF
