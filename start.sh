#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo ""
echo " BKM Studio"
echo " Checking Node.js..."
echo ""

if ! command -v node &>/dev/null; then
  echo " Node.js not found. Please install Node.js 18 or later:"
  echo " https://nodejs.org/en/download"
  echo ""
  exit 1
fi

# Install deps on first run
if [ ! -d "server/node_modules" ]; then
  echo " Installing server dependencies (first run only)..."
  (cd server && npm install --omit=dev --silent)
  echo " Done."
  echo ""
fi

echo " Starting BKM Studio server on http://localhost:3000 ..."
(cd server && node server.js) &
SERVER_PID=$!

sleep 2

# Open browser (macOS / Linux)
if command -v open &>/dev/null; then
  open "http://localhost:3000/bkm-bosch.html"
elif command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:3000/bkm-bosch.html"
fi

echo " Server running at: http://localhost:3000/bkm-bosch.html"
echo " Press Ctrl+C to stop."
echo ""

wait $SERVER_PID
