#!/bin/bash
# Stops the screenshot tracker and removes it from login. Screenshots already
# taken are left where they are.
LABEL="com.mytrack.screenshot-tracker"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/ScreenTracker"
echo "Screenshot tracker removed."
