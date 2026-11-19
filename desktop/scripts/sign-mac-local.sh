#!/bin/bash
# Signs an installed MyTrack.app with the local "MyTrack Local Signing"
# certificate (kept in ~/.mytrack-signing, outside the project).
#
# Why: an ad-hoc signature changes with every build, and macOS ties Screen
# Recording / Camera permission to the signature — so each reinstall looked
# like a new app and lost those permissions. Signed with the same certificate,
# the app keeps them across updates.
#
# Usage: desktop/scripts/sign-mac-local.sh [/Applications/MyTrack.app]
set -euo pipefail
APP="${1:-/Applications/MyTrack.app}"
DIR="$HOME/.mytrack-signing"
KC="$DIR/signing.keychain-db"
if [ ! -f "$KC" ]; then
  echo "No signing keychain at $KC — falling back to ad-hoc signing (permissions will reset)." >&2
  exec codesign --force --deep --sign - "$APP"
fi
security unlock-keychain -p "$(cat "$DIR/keychain-password")" "$KC"
ID=$(security find-identity -p codesigning "$KC" | awk '/MyTrack Local Signing/ {print $2; exit}')
# codesign only looks in the search list: add the keychain for this step, then restore the list.
ORIG=$(security list-keychains -d user | tr -d '"' | xargs)
trap 'security list-keychains -d user -s $ORIG' EXIT
security list-keychains -d user -s $ORIG "$KC"
codesign --force --deep --sign "$ID" "$APP"
codesign --verify --deep --strict "$APP"
echo "Signed $APP with MyTrack Local Signing ($ID)"
