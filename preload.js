const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sketchrip', {
  loadUrl: (url) => ipcRenderer.invoke('load-url', url),
  extractModel: () => ipcRenderer.invoke('extract-model'),
  injectExtractor: () => ipcRenderer.invoke('inject-extractor'),
  onExtractionUpdate: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('extraction-update', handler);
    return () => ipcRenderer.removeListener('extraction-update', handler);
  },
});
