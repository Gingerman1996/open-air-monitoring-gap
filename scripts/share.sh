#!/usr/bin/env bash
# Expose the running stack publicly via ngrok and print the URL.
# One tunnel to web:3000 is enough — Nitro server-proxies /api on the same origin.
#
#   NGROK_AUTHTOKEN=xxxxx ./scripts/share.sh        # docker (compose `share` profile)
#   ./scripts/share.sh --host                       # host ngrok binary, uses ~/.config token
set -euo pipefail
cd "$(dirname "$0")/.."

if ! curl -sf -o /dev/null http://localhost:3000; then
  echo "web is not up on :3000 — run 'docker compose up -d' first." >&2
  exit 1
fi

if [[ "${1:-}" == "--host" ]]; then
  command -v ngrok >/dev/null || { echo "ngrok not installed — 'brew install ngrok'." >&2; exit 1; }
  echo "starting host ngrok → http://localhost:3000 …"
  ngrok http 3000
  exit 0
fi

: "${NGROK_AUTHTOKEN:?set NGROK_AUTHTOKEN (https://dashboard.ngrok.com/get-started/your-authtoken) or use --host}"
docker compose --profile share up -d ngrok

echo -n "waiting for the tunnel"
for _ in $(seq 1 20); do
  url=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
        | python3 -c "import sys,json;t=json.load(sys.stdin)['tunnels'];print(t[0]['public_url'] if t else '')" 2>/dev/null || true)
  [[ -n "${url:-}" ]] && break
  echo -n "."; sleep 1
done
echo
if [[ -n "${url:-}" ]]; then
  echo "public URL:  $url"
  echo "inspector:   http://localhost:4040"
  echo "stop with:   docker compose --profile share down"
else
  echo "tunnel did not come up — check 'docker compose logs ngrok'." >&2
  exit 1
fi
