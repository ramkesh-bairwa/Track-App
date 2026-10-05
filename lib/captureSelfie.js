// Captures one webcam frame. Returns { photo, reason } so the caller can tell
// the user what happened. Browsers require a secure context (https:// or
// http://localhost) and always prompt for permission — this cannot be silent.
//   reason: 'ok' | 'insecure' | 'unsupported' | 'denied' | 'nodevice' | 'inuse' | 'timeout' | 'blank' | 'error'
export async function captureSelfie({ timeoutMs = 8000 } = {}) {
  if (typeof navigator === 'undefined') return { photo: null, reason: 'unsupported' };
  // getUserMedia only exists in a secure context. window.isSecureContext is
  // true for https and for http://localhost / 127.0.0.1 / [::1].
  if (typeof window !== 'undefined' && window.isSecureContext === false) return { photo: null, reason: 'insecure' };
  if (!navigator.mediaDevices?.getUserMedia) return { photo: null, reason: window?.isSecureContext ? 'unsupported' : 'insecure' };

  let stream;
  try {
    stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false }),
      new Promise((_, rej) => setTimeout(() => rej(new DOMException('timeout', 'TimeoutError')), timeoutMs)),
    ]);
  } catch (err) {
    const n = err?.name || '';
    const reason =
      n === 'NotAllowedError' || n === 'SecurityError' ? 'denied' :
      n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError' ? 'nodevice' :
      n === 'NotReadableError' || n === 'TrackStartError' ? 'inuse' :
      n === 'TimeoutError' ? 'timeout' : 'error';
    return { photo: null, reason };
  }
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => {});
    await new Promise((res) => {
      if (video.readyState >= 2 && video.videoWidth) return res();
      video.addEventListener('loadeddata', res, { once: true });
      setTimeout(res, 3000);
    });
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const w = 320;
    const h = Math.round((vh / vw) * w) || 240;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // The first frames can be black while the sensor exposes, so retry a few
    // times before deciding the camera is covered or not delivering an image.
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, attempt ? 400 : 450));
      ctx.drawImage(video, 0, 0, w, h);
      if (!isBlankFrame(ctx.getImageData(0, 0, w, h).data)) {
        return { photo: canvas.toDataURL('image/jpeg', 0.6), reason: 'ok' };
      }
    }
    return { photo: null, reason: 'blank' };
  } catch {
    return { photo: null, reason: 'error' };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// True for an all-black or single-colour frame (covered lens, camera not ready).
function isBlankFrame(px) {
  let sum = 0, sumSq = 0, n = 0;
  for (let i = 0; i < px.length; i += 4 * 16) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    sum += y;
    sumSq += y * y;
    n++;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return mean < 12 || variance < 20;
}
