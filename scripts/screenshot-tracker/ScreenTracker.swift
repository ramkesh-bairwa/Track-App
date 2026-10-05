// The ScreenTracker app. launchd starts it every 5 minutes; it checks the
// Screen Recording permission (asking for it the first time) and then runs
// capture.sh, which does the actual work. macOS grants the permission to this
// app, and capture.sh and screencapture inherit it as its child processes.
//
//   ScreenTracker                   check permission, then run capture.sh
//   ScreenTracker --target <json>   print what to capture and write the
//                                   window's app name and title to <json>:
//                                     "window <id>"         the window you're working in
//                                     "rect <x>,<y>,<w>,<h>" the screen under the mouse
//   ScreenTracker --permission      print "granted" or "denied"
import AppKit
import CoreGraphics

// The frontmost app's frontmost normal window (layer 0, not a tiny popup).
func frontWindow() -> (id: Int, app: String, title: String)? {
    guard let app = NSWorkspace.shared.frontmostApplication,
          let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
    else { return nil }
    for w in list { // ordered front to back
        guard (w[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier,
              (w[kCGWindowLayer as String] as? Int) == 0,
              ((w[kCGWindowAlpha as String] as? Double) ?? 1) > 0,
              let b = w[kCGWindowBounds as String] as? [String: CGFloat],
              (b["Width"] ?? 0) >= 100, (b["Height"] ?? 0) >= 100,
              let id = w[kCGWindowNumber as String] as? Int
        else { continue }
        return (id, app.localizedName ?? "", w[kCGWindowName as String] as? String ?? "")
    }
    return nil
}

// The screen the mouse is on, in screencapture -R coordinates (top-left origin).
func mouseScreenRect() -> String {
    let screens = NSScreen.screens
    guard let main = screens.first else { return "" }
    let mouse = NSEvent.mouseLocation
    let s = screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? main
    let f = s.frame
    return "\(Int(f.minX)),\(Int(main.frame.height - f.maxY)),\(Int(f.width)),\(Int(f.height))"
}

func writeJSON(_ value: [String: String], to path: String) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        try? data.write(to: URL(fileURLWithPath: path))
    }
}

let args = CommandLine.arguments
let granted = CGPreflightScreenCaptureAccess()

if args.count > 1 && args[1] == "--permission" {
    print(granted ? "granted" : "denied")
    exit(0)
}

if args.count > 2 && args[1] == "--target" {
    let mode = ProcessInfo.processInfo.environment["CAPTURE_MODE"] ?? "window"
    if mode == "window", let w = frontWindow() {
        writeJSON(["app": w.app, "title": w.title, "mode": "window"], to: args[2])
        print("window \(w.id)")
    } else {
        let app = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
        writeJSON(["app": app, "title": "", "mode": "screen"], to: args[2])
        print("rect \(mouseScreenRect())")
    }
    exit(0)
}

// First run without permission: this shows the macOS prompt and adds
// ScreenTracker to System Settings → Privacy & Security → Screen Recording.
if !granted { CGRequestScreenCaptureAccess() }

let dir = (Bundle.main.bundlePath as NSString).deletingLastPathComponent
let task = Process()
task.executableURL = URL(fileURLWithPath: "/bin/bash")
task.arguments = [dir + "/capture.sh"]
var env = ProcessInfo.processInfo.environment
env["SCREEN_PERMISSION"] = granted ? "granted" : "denied"
env["TRACKER_BIN"] = Bundle.main.executablePath ?? ""
task.environment = env
do {
    try task.run()
    task.waitUntilExit()
    exit(task.terminationStatus)
} catch {
    FileHandle.standardError.write("ScreenTracker: could not run capture.sh: \(error)\n".data(using: .utf8)!)
    exit(1)
}
