// MyTrack Camera — takes one camera photo for MyTrack's "System login"
// history, on macOS. It's a separate, rarely-changing helper so macOS
// remembers its camera permission across MyTrack updates (an unsigned app
// is re-identified on every build, which would reset the permission).
//
//   MyTrackCamera <out.jpg>          write one photo to out.jpg
//   MyTrackCamera --request-access   only ask for camera permission
// Writes "<out>.status": ok | denied | nodevice | error:<why>.
import AVFoundation
import AppKit

let args = CommandLine.arguments
let requestOnly = args.contains("--request-access")
let outPath = args.dropFirst().first { !$0.hasPrefix("--") }

func finish(_ status: String) -> Never {
    if let out = outPath { try? status.write(toFile: out + ".status", atomically: true, encoding: .utf8) }
    print(status)
    exit(status == "ok" ? 0 : 1)
}

// Never hang: give up after 25 seconds.
DispatchQueue.main.asyncAfter(deadline: .now() + 25) { finish("error:timeout") }

final class Grabber: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    let queue = DispatchQueue(label: "camera")
    var frames = 0
    let context = CIContext()

    func start() {
        let discovery = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera, .externalUnknown], mediaType: .video, position: .unspecified)
        guard let device = AVCaptureDevice.default(for: .video) ?? discovery.devices.first else { finish("nodevice") }
        do {
            let input = try AVCaptureDeviceInput(device: device)
            session.sessionPreset = .vga640x480
            guard session.canAddInput(input) else { finish("error:input") }
            session.addInput(input)
            let output = AVCaptureVideoDataOutput()
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.setSampleBufferDelegate(self, queue: queue)
            guard session.canAddOutput(output) else { finish("error:output") }
            session.addOutput(output)
            session.startRunning()
        } catch {
            finish("error:\(error.localizedDescription)")
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frames += 1
        // Skip the first frames while the sensor sets its exposure.
        guard frames == 25, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer), let out = outPath else { return }
        let image = CIImage(cvPixelBuffer: buffer)
        guard let cg = context.createCGImage(image, from: image.extent) else { finish("error:frame") }
        let rep = NSBitmapImageRep(cgImage: cg)
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.6]) else { finish("error:jpeg") }
        do {
            try jpeg.write(to: URL(fileURLWithPath: out))
        } catch {
            finish("error:write")
        }
        session.stopRunning()
        finish("ok")
    }
}

let grabber = Grabber()
func go() {
    if requestOnly { finish("ok") }
    if outPath == nil { finish("error:no output file") }
    grabber.start()
}

switch AVCaptureDevice.authorizationStatus(for: .video) {
case .authorized:
    go()
case .notDetermined:
    AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async {
            if granted { go() } else { finish("denied") }
        }
    }
default:
    finish("denied")
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited) // no Dock icon, no menu bar
app.run()
