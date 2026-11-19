// Turns one or more live screen streams into a single video track: crops a
// selected area out of a screen, or lays several screens side by side / as
// arranged. Frames are drawn on a canvas paced by a Worker timer — page
// timers slow to once a second when the tab is in the background, worker
// timers don't, so the recording keeps its frame rate while you work in
// other windows.
//
// layers: [{ stream, x, y, width, height }]  where each screen sits, in points
// crop:   { x, y, width, height } in the same points (relative to the layout's
//         top-left), or null for everything
// maxW/maxH: output limit in pixels (the picture is only ever scaled down)

const TICKER = `let t; onmessage = (e) => { clearInterval(t); if (e.data > 0) t = setInterval(() => postMessage(0), e.data); };`;

async function videoOf(stream) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  await v.play();
  if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
  return v;
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

export async function composeStream({ layers, crop = null, maxW = 7680, maxH = 4320, fps = 30 }) {
  const videos = await Promise.all(layers.map((l) => videoOf(l.stream)));
  const minX = Math.min(...layers.map((l) => l.x));
  const minY = Math.min(...layers.map((l) => l.y));
  const scene = crop || {
    x: 0,
    y: 0,
    width: Math.max(...layers.map((l) => l.x + l.width)) - minX,
    height: Math.max(...layers.map((l) => l.y + l.height)) - minY,
  };
  // Pixels per point: as sharp as the sharpest screen, then fit the limit.
  const density = Math.max(...layers.map((l, i) => videos[i].videoWidth / l.width));
  const fit = Math.min(1, maxW / (scene.width * density), maxH / (scene.height * density));
  const k = density * fit;

  const canvas = document.createElement('canvas');
  canvas.width = even(scene.width * k);
  canvas.height = even(scene.height * k);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    layers.forEach((l, i) => {
      const v = videos[i];
      if (!v.videoWidth) return;
      ctx.drawImage(v, (l.x - minX - scene.x) * k, (l.y - minY - scene.y) * k, l.width * k, l.height * k);
    });
  }
  draw();

  const stream = canvas.captureStream(fps);
  const url = URL.createObjectURL(new Blob([TICKER], { type: 'text/javascript' }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  worker.onmessage = draw;
  worker.postMessage(Math.round(1000 / fps));

  return {
    track: stream.getVideoTracks()[0],
    width: canvas.width,
    height: canvas.height,
    stop() {
      worker.terminate();
      stream.getTracks().forEach((t) => t.stop());
      videos.forEach((v) => {
        v.pause();
        v.srcObject = null;
      });
    },
  };
}
