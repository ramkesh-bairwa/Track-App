#!/usr/bin/env bash
#
# Deploy MyTrack to the Hostinger VPS — no Docker. Builds on this Mac (the VPS
# is too slow to run `next build`), copies the result over SSH with rsync, then
# restarts the app under PM2.
#
#   ./deploy.sh              # build + deploy
#   ./deploy.sh --no-build   # deploy the existing .next (skip rebuild)
#   ./deploy.sh --restart    # just restart the app on the server
#
set -euo pipefail

# ---- settings (change here if the server/app moves) -----------------------
SERVER="root@187.126.117.103"
SSH_KEY="$HOME/.ssh/id_ed25519_mytrack_vps"
APP_DIR="/var/www/Track-App"
PM2_NAME="track-app"
PORT="3006"
SSH_OPTS="-i $SSH_KEY -o IdentitiesOnly=yes"

cd "$(dirname "$0")"
SSH="ssh $SSH_OPTS $SERVER"

run_restart_only=false
do_build=true
for a in "$@"; do
  case "$a" in
    --no-build) do_build=false ;;
    --restart)  run_restart_only=true ;;
    *) echo "Unknown option: $a"; exit 1 ;;
  esac
done

if $run_restart_only; then
  echo "↻ Restarting $PM2_NAME on the server…"
  $SSH "cd '$APP_DIR' && pm2 restart '$PM2_NAME' --update-env && pm2 status '$PM2_NAME'"
  exit 0
fi

# ---- 1. build locally -----------------------------------------------------
if $do_build; then
  echo "▸ Building locally (npm run build)…"
  npm run build
else
  echo "▸ Skipping build (--no-build); using existing .next"
  [ -d .next ] || { echo "No .next/ found — run without --no-build first."; exit 1; }
fi

# ---- 2. copy to the server ------------------------------------------------
# Source, config and the fresh build. node_modules, secrets and local-only
# data are never sent; .next/cache is huge and not needed at runtime.
echo "▸ Syncing files to $SERVER:$APP_DIR …"
rsync -az --delete --info=progress2 -e "ssh $SSH_OPTS" \
  --exclude 'node_modules/' \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude 'credentials/' \
  --exclude 'downloads/' \
  --exclude 'public/system-tracker/' \
  --exclude '.next/cache/' \
  --exclude '.DS_Store' \
  ./ "$SERVER:$APP_DIR/"

# ---- 3. install deps + self-hosted assets + restart (on the server) -------
# npm on the server skips postinstall, so the pdf.js / tesseract copy scripts
# are run by hand. `npm ci` only re-runs when package-lock.json changed.
echo "▸ Installing deps & restarting on the server…"
$SSH "bash -se" <<REMOTE
  set -euo pipefail
  cd '$APP_DIR'

  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.deps-stamp ]; then
    echo '  · npm ci (dependencies changed)…'
    npm ci --omit=dev
    node scripts/copy-pdfjs.js
    node scripts/copy-tesseract.js
    touch node_modules/.deps-stamp
  else
    echo '  · dependencies unchanged — skipping npm ci'
  fi

  if pm2 describe '$PM2_NAME' >/dev/null 2>&1; then
    pm2 restart '$PM2_NAME' --update-env
  else
    pm2 start npm --name '$PM2_NAME' -- start -- -p '$PORT'
  fi
  pm2 save >/dev/null 2>&1 || true
  pm2 status '$PM2_NAME'
REMOTE

# ---- 4. health check ------------------------------------------------------
echo "▸ Health check…"
sleep 3
if $SSH "curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/login" | grep -q '200'; then
  echo "✓ Deployed — https://my-track.glamofashion.com is up."
else
  echo "⚠ App restarted but /login did not return 200. Check: $SSH 'pm2 logs $PM2_NAME'"
  exit 1
fi
