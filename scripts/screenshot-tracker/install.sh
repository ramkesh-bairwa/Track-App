#!/bin/bash
# Installs the screenshot tracker as a macOS LaunchAgent: it starts by itself
# every time you log in and takes a screenshot every 5 minutes.
#   bash scripts/screenshot-tracker/install.sh
# Shots are filed under the MyTrack account in SCREENSHOT_OWNER_EMAIL (from .env),
# in public/system-tracker/<that email>/ — only admins can see them in the app.
# Optional: SCREENSHOT_OWNER_EMAIL=you@x.com SCREENSHOT_DIR=/some/folder KEEP_DAYS=30 MAX_SIDE=2560 CAPTURE_MODE=screen bash .../install.sh
# Needs Xcode Command Line Tools (xcode-select --install) to build the app.
set -e

LABEL="com.mytrack.screenshot-tracker"
APP_DIR="$HOME/Library/Application Support/ScreenTracker"
APP="$APP_DIR/ScreenTracker.app"
BIN="$APP/Contents/MacOS/ScreenTracker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
env_value() { sed -n "s/^$1=//p" "$PROJECT_DIR/.env" 2>/dev/null | tail -1; }
OWNER="${SCREENSHOT_OWNER_EMAIL:-$(env_value SCREENSHOT_OWNER_EMAIL)}"
OWNER="$(printf '%s' "$OWNER" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
if [ -z "$OWNER" ] || [[ "$OWNER" == */* ]]; then
  echo "Set SCREENSHOT_OWNER_EMAIL in .env to the MyTrack account these screenshots belong to." >&2
  exit 1
fi
ROOT="${SCREENSHOT_DIR:-$(env_value SCREENSHOT_DIR)}"
SCREENSHOT_DIR="${ROOT:-$PROJECT_DIR/public/system-tracker}/$OWNER"
KEEP_DAYS="${KEEP_DAYS:-60}"
MAX_SIDE="${MAX_SIDE:-1920}"
CAPTURE_MODE="${CAPTURE_MODE:-window}" # window | screen | all (see capture.sh)
INTERVAL=300 # seconds

mkdir -p "$APP_DIR" "$HOME/Library/LaunchAgents" "$SCREENSHOT_DIR"
cp "$(dirname "$0")/capture.sh" "$APP_DIR/capture.sh"
chmod +x "$APP_DIR/capture.sh"
printf 'SCREENSHOT_DIR=%q\nKEEP_DAYS=%q\nMAX_SIDE=%q\nCAPTURE_MODE=%q\n' \
  "$SCREENSHOT_DIR" "$KEEP_DAYS" "$MAX_SIDE" "$CAPTURE_MODE" > "$APP_DIR/config"

# ScreenTracker.app (ScreenTracker.swift) is what macOS grants Screen Recording
# to — only it, not every bash script on the machine. It's rebuilt only when the
# Swift source changes, because macOS ties the permission to this exact build:
# after a rebuild you have to turn ScreenTracker on again.
SRC="$(dirname "$0")/ScreenTracker.swift"
SRC_HASH="$(shasum -a 256 "$SRC" | cut -d' ' -f1)"
REBUILT=0
if [ ! -x "$BIN" ] || [ "$(cat "$APP/Contents/Resources/source.sha256" 2>/dev/null)" != "$SRC_HASH" ] || [ "$REBUILD_APP" = 1 ]; then
  echo "Building ScreenTracker.app…"
  rm -rf "$APP"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  /usr/bin/xcrun swiftc -O -o "$BIN" "$SRC"
  echo "$SRC_HASH" > "$APP/Contents/Resources/source.sha256"
  cat > "$APP/Contents/Info.plist" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$LABEL</string>
  <key>CFBundleName</key><string>ScreenTracker</string>
  <key>CFBundleDisplayName</key><string>ScreenTracker</string>
  <key>CFBundleExecutable</key><string>ScreenTracker</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict>
</plist>
PLIST_END
  /usr/bin/codesign --force --sign - --identifier "$LABEL" "$APP" >/dev/null
  # Forget any permission given to an earlier build, so macOS asks again
  # instead of silently refusing the new one.
  /usr/bin/tccutil reset ScreenCapture "$LABEL" >/dev/null 2>&1 || true
  REBUILT=1
fi

cat > "$PLIST" <<PLIST_END
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardErrorPath</key><string>$APP_DIR/tracker.log</string>
</dict>
</plist>
PLIST_END

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Screenshot tracker installed."
echo "  Captures:   CAPTURE_MODE=$CAPTURE_MODE every $((INTERVAL / 60)) minutes"
echo "  Saves to:   $SCREENSHOT_DIR/<date>/<time>.jpg"
echo "  Starts:     automatically at every login"
echo "  Log:        $APP_DIR/tracker.log"
if [ "$REBUILT" = 1 ]; then
  echo
  echo "One-time step: when macOS asks, allow ScreenTracker to record the screen — or turn it on in"
  echo "System Settings → Privacy & Security → Screen & System Audio Recording (click + and pick"
  echo "$APP if it isn't listed). Until then nothing is saved and the Screenshots page says why."
fi
