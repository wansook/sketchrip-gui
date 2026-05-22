const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sketchrip', {
  loadUrl: (url) => ipcRenderer.invoke('load-url', url),
  extractModel: (options) => ipcRenderer.invoke('extract-model', options),
  exportGLB: (data) => ipcRenderer.invoke('export-glb', data),
  exportOBJ: (data) => ipcRenderer.invoke('export-obj', data),
  onProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('extraction-progress', handler);
    return () => ipcRenderer.removeListener('extraction-progress', handler);
  },
});
