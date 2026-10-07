#!/bin/bash
# Takes one silent screenshot and saves it as
#   $SCREENSHOT_DIR/YYYY-MM-DD/HH-MM-SS.jpg   (+ HH-MM-SS.json: the app and window title)
# CAPTURE_MODE picks what's in it:
#   window  the window you're working in (default; falls back to the screen under
#           the mouse when no window is focused, e.g. on the bare desktop)
#   screen  the whole screen under the mouse
#   all     every display (extra displays: HH-MM-SS-display2.jpg …)
# The ScreenTracker app runs this at login and then every 5 minutes (see install.sh).
# Each run also writes $SCREENSHOT_DIR/.status.json, which the Screenshots page shows.

# install.sh writes the settings here, so they can change without rebuilding
# the app (a rebuilt app loses its Screen Recording permission).
CONFIG="$(dirname "$0")/config"
[ -f "$CONFIG" ] && . "$CONFIG"

SCREENSHOT_DIR="${SCREENSHOT_DIR:-$HOME/Pictures/ScreenTracker}"
KEEP_DAYS="${KEEP_DAYS:-60}" # day folders older than this are deleted; 0 keeps everything
MAX_SIDE="${MAX_SIDE:-1920}"
CAPTURE_MODE="${CAPTURE_MODE:-window}"
export CAPTURE_MODE

day="$(date +%Y-%m-%d)"
stamp="$(date +%H-%M-%S)"
folder="$SCREENSHOT_DIR/$day"
mkdir -p "$SCREENSHOT_DIR"

status() { # status <state> <message>
  printf '{"time":"%s","state":"%s","mode":"%s","message":"%s"}\n' \
    "$(date +%Y-%m-%dT%H:%M:%S%z)" "$1" "$CAPTURE_MODE" "$2" > "$SCREENSHOT_DIR/.status.json"
}

# Turned off from the Screenshots page.
if [ -f "$SCREENSHOT_DIR/.paused" ]; then
  status paused "Screenshots are turned off."
  exit 0
fi

# Without Screen Recording permission macOS hands back only the wallpaper and
# menu bar, so don't save those — say why instead.
if [ "$SCREEN_PERMISSION" = denied ]; then
  status no-permission "ScreenTracker isn't allowed to record the screen. Turn it on in System Settings → Privacy & Security → Screen & System Audio Recording."
  exit 0
fi

# Nothing useful to capture while the display is asleep or the screen is locked.
if /usr/sbin/ioreg -n IODisplayWrangler -r -d 1 2>/dev/null | grep -q '"CurrentPowerState"=[0-3]'; then
  status skipped "The display was asleep."
  exit 0
fi
if /usr/sbin/ioreg -n Root -d1 2>/dev/null | grep -q '"IOConsoleLocked" = Yes'; then
  status skipped "The screen was locked."
  exit 0
fi

mkdir -p "$folder"
shot="$folder/$stamp.jpg"
meta="$folder/$stamp.json"

# -x no sound, -C include the mouse pointer, -o no window shadow.
case "$CAPTURE_MODE" in
  all)
    files=("$shot" "$folder/$stamp-display2.jpg" "$folder/$stamp-display3.jpg")
    /usr/sbin/screencapture -x -C -t jpg "${files[@]}"
    ;;
  *)
    files=("$shot")
    target=""
    [ -x "$TRACKER_BIN" ] && target="$("$TRACKER_BIN" --target "$meta")"
    case "$target" in
      window\ *) /usr/sbin/screencapture -x -o -t jpg -l "${target#window }" "$shot" ;;
      rect\ *) /usr/sbin/screencapture -x -C -t jpg -R "${target#rect }" "$shot" ;;
      *) /usr/sbin/screencapture -x -C -t jpg -m "$shot" ;; # no helper: main display
    esac
    ;;
esac

if [ ! -s "$shot" ]; then
  rm -f "$meta"
  status error "screencapture didn't save a file."
  exit 1
fi

# Retina captures are ~7 MB each; shrink to at most MAX_SIDE px at JPEG quality 60 (~0.5 MB).
for f in "${files[@]}"; do
  [ -f "$f" ] && /usr/bin/sips -s format jpeg -s formatOptions 60 -Z "$MAX_SIDE" "$f" --out "$f" >/dev/null 2>&1
done
status ok "Saved $day/$stamp.jpg"

if [ "$KEEP_DAYS" -gt 0 ] 2>/dev/null; then
  find "$SCREENSHOT_DIR" -mindepth 1 -maxdepth 1 -type d -name '????-??-??' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null
fi
