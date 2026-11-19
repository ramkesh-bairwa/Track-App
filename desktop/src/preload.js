// Exposes a few capabilities to MyTrack's pages: a photo from the macOS
// camera helper, and native screenshots for the Screenshot tool (see main.js
// and src/snip.js). Nothing else from Electron or Node is reachable.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mytrackDesktop', {
  takePhoto: () => ipcRenderer.invoke('mytrack:take-photo'),
  screenshot: {
    displays: () => ipcRenderer.invoke('mytrack:snip-displays'),
    capture: (opts) => ipcRenderer.invoke('mytrack:snip-capture', opts),
  },
  recorder: {
    displays: () => ipcRenderer.invoke('mytrack:snip-displays'),
    sources: (opts) => ipcRenderer.invoke('mytrack:rec-sources', opts),
  },
});
