// The area-selection overlay (snip-overlay.html): receives the frozen screen
// image and reports the box the user drew (or null to cancel).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snip', {
  onImage: (cb) => ipcRenderer.on('mytrack:snip-image', (_e, url) => cb(url)),
  pick: (rect) => ipcRenderer.send('mytrack:snip-pick', rect),
});
