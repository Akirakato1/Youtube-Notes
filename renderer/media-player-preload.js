const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('player', {
  // Hand off to the OS's default video player. Used as a fallback button
  // when Chromium's <video> can't decode the file.
  openExternal: (filePath) => ipcRenderer.invoke('video:openExternal', filePath),

  // Persist the current playback position. Fire-and-forget — the renderer
  // calls this every few seconds during playback, no need to block on a
  // round-trip.
  savePosition: (notePath, position) => ipcRenderer.send('video:savePosition', { notePath, position }),
});
