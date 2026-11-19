#!/usr/bin/env node
// Builds vendor/camera-helper/MyTrack Camera.app (macOS only) from
// camera-helper/MyTrackCamera.swift — ONLY when the source changed. Keeping
// the exact same build is the point: macOS ties the camera permission to it,
// so as long as it's unchanged, the permission survives MyTrack updates.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('Camera helper: macOS only, skipped.');
  process.exit(0);
}
const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(DESKTOP, 'camera-helper', 'MyTrackCamera.swift');
const OUT = path.join(DESKTOP, 'vendor', 'camera-helper');
const APP = path.join(OUT, 'MyTrack Camera.app');
const BIN = path.join(APP, 'Contents', 'MacOS', 'MyTrackCamera');
const HASH_FILE = path.join(APP, 'Contents', 'Resources', 'source.sha256');
const hash = crypto.createHash('sha256').update(fs.readFileSync(SRC)).digest('hex');

if (fs.existsSync(BIN) && fs.existsSync(HASH_FILE) && fs.readFileSync(HASH_FILE, 'utf8').trim() === hash) {
  console.log('Camera helper unchanged — keeping the existing build (and its camera permission).');
  process.exit(0);
}
console.log('Building the camera helper…');
fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(path.dirname(BIN), { recursive: true });
fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
execFileSync('xcrun', ['swiftc', '-O', '-o', BIN, SRC, '-framework', 'AVFoundation', '-framework', 'AppKit'], { stdio: 'inherit' });
fs.writeFileSync(
  path.join(APP, 'Contents', 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.podup.mytrack.camera</string>
  <key>CFBundleName</key><string>MyTrack Camera</string>
  <key>CFBundleDisplayName</key><string>MyTrack Camera</string>
  <key>CFBundleExecutable</key><string>MyTrackCamera</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSCameraUsageDescription</key><string>MyTrack takes a photo when someone signs in to or unlocks this computer (shown in MyTrack's Login history → System login).</string>
</dict>
</plist>
`
);
fs.writeFileSync(HASH_FILE, hash);
execFileSync('codesign', ['--force', '--sign', '-', '--identifier', 'com.podup.mytrack.camera', APP], { stdio: 'inherit' });
console.log(`✓ ${path.relative(DESKTOP, APP)}`);
