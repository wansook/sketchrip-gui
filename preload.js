const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sketchrip', {
  loadUrl: (url) => ipcRenderer.invoke('load-url', url),
  extractModel: () => ipcRenderer.invoke('extract-model'),
  exportGLB: (data) => ipcRenderer.invoke('export-glb', data),
  exportOBJ: (data) => ipcRenderer.invoke('export-obj', data),
});

contextBridge.exposeInMainWorld('SketchRipExporter', {
  exportGLB: (data) => ipcRenderer.invoke('export-glb', data),
  exportOBJ: (data) => ipcRenderer.invoke('export-obj', data),
});
