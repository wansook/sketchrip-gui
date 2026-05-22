const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;
let webview;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile('renderer/index.html');

  // Open devtools in dev mode
  if (app.commandLine.hasSwitch('dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC: load sketchfab URL in webview
ipcMain.handle('load-url', async (_event, url) => {
  if (!webview) return { ok: false, error: 'webview not ready' };
  webview.src = url;
  return { ok: true };
});

// IPC: extract model data from webview
ipcMain.handle('extract-model', async (_event) => {
  if (!webview) return { ok: false, error: 'webview not ready' };
  return webview.executeJavaScript(`
    (function extract() {
      // Find Three.js renderer and scene
      const keys = Object.keys(window).filter(k => k.includes('THREE') || k.includes('three'));
      if (keys.length === 0) return { error: 'No Three.js instance found' };
      
      // Try to get renderer
      const rendererKeys = Object.keys(window).filter(k => {
        const v = window[k];
        return v && v instanceof Object && v.domElement;
      });
      
      // Sketchfab uses its own internal renderer
      // Try accessing through webview's document
      let scene = null;
      let meshes = [];
      let textures = [];
      
      // Search for Sketchfab's internal Three.js instance
      // Sketchfab stores data on the webview's window object
      const doc = webview.getWebContents();
      if (!doc) return { error: 'no webContents' };
      
      // Try common sketchfab patterns
      // @ts-ignore
      if (window.__SKETCHFAB__) {
        return { error: 'Need to access sketchfab internal data via script injection' };
      }
      
      return { error: 'Failed to find model data - need deeper injection' };
    })()
  `);
});

ipcMain.handle('inject-extractor', async (_event) => {
  if (!webview) return { ok: false };
  return webview.executeJavaScript(`
    (function inject() {
      // Inject Three.js inspector
      const script = document.createElement('script');
      script.src = 'data:application/javascript,console.log("injected")';
      document.body.appendChild(script);
      return { ok: true };
    })()
  `);
});
