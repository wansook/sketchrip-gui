const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
const extensionPath = path.join(__dirname, 'extension');

// Load Chrome extension into Electron session
function loadExtension() {
  try {
    // Read manifest to get extension info
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
    
    // For Manifest V3, load as packed extension
    // Chrome extension protocol is only available in Chrome, so we use
    // a different approach: inject the extension's JS files manually
    
    console.log('[SketchRip] Extension loaded from:', extensionPath);
    console.log('[SketchRip] Content scripts:', manifest.content_scripts?.[0]?.js || []);
    
    return manifest;
  } catch (err) {
    console.error('[SketchRip] Failed to load extension:', err.message);
    return null;
  }
}

const extensionManifest = loadExtension();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('renderer/index.html');

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

// ============================================================
// IPC: Load Sketchfab URL
// ============================================================

ipcMain.handle('load-url', async (_event, url) => {
  try {
    mainWindow.loadURL(url);
    
    // Wait for page to load, then inject content script
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[SketchRip] Page loaded, injecting content script');
      injectContentScript(mainWindow.webContents);
    });
    
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
// IPC: Extract Model Data
// ============================================================

ipcMain.handle('extract-model', async (_event, options = {}) => {
  if (!mainWindow) {
    return { ok: false, error: 'No main window' };
  }
  
  try {
    const url = mainWindow.webContents.getURL();
    
    // Check if we're on Sketchfab
    if (!url || !url.includes('sketchfab.com')) {
      return { ok: false, error: 'Not a Sketchfab page. Load a Sketchfab URL first.' };
    }
    
    // Inject extraction script and run it
    const result = await runExtraction(mainWindow.webContents);
    
    if (result.ok) {
      // Report success
      console.log('[SketchRip] Extraction successful');
      console.log(`  Meshes: ${result.stats?.meshCount || 0}`);
      console.log(`  Triangles: ${result.stats?.triangles || 0}`);
      console.log(`  Vertices: ${result.stats?.vertices || 0}`);
      console.log(`  Textures: ${result.textures?.length || 0}`);
    } else {
      console.warn('[SketchRip] Extraction failed:', result.error);
    }
    
    return result;
  } catch (err) {
    console.error('[SketchRip] Extraction error:', err);
    return { ok: false, error: err.message };
  }
});

// ============================================================
// IPC: Export to GLB
// ============================================================

ipcMain.handle('export-glb', async (_event, data) => {
  try {
    const { meshes, materials, textures } = data;
    
    // Run exporter in renderer process
    const result = await mainWindow.webContents.executeJavaScript(`
      SketchRipExporter.exportGLB(${JSON.stringify({ meshes, materials, textures })})
    `);
    
    if (result.ok) {
      // Show save dialog
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save GLB File',
        defaultPath: 'model.glb',
        filters: [
          { name: 'GLB Files', extensions: ['glb'] },
          { name: 'glTF Files', extensions: ['gltf'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      
      if (filePath) {
        fs.writeFileSync(filePath, Buffer.from(result.buffer));
        console.log('[SketchRip] Saved to:', filePath);
        return { ok: true, path: filePath };
      }
    }
    
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
// IPC: Export to OBJ
// ============================================================

ipcMain.handle('export-obj', async (_event, data) => {
  try {
    const { meshes, materials } = data;
    
    const result = await mainWindow.webContents.executeJavaScript(`
      SketchRipExporter.exportOBJ(${JSON.stringify({ meshes, materials })})
    `);
    
    if (result.ok) {
      const { filePath: objPath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save OBJ File',
        defaultPath: 'model.obj',
        filters: [
          { name: 'OBJ Files', extensions: ['obj'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      
      if (objPath) {
        fs.writeFileSync(objPath, result.objData);
        
        // Also save MTL
        const mtlPath = objPath.replace(/\.obj$/, '.mtl');
        fs.writeFileSync(mtlPath, result.mtlData);
        
        console.log('[SketchRip] Saved OBJ:', objPath);
        console.log('[SketchRip] Saved MTL:', mtlPath);
        return { ok: true, path: objPath };
      }
    }
    
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
// Content Script Injection
// ============================================================

/**
 * Inject and run the content script on a webContents.
 * This simulates Chrome extension content script behavior.
 */
async function injectContentScript(webContents) {
  // Load utility scripts
  const utilPaths = ['utils/extractor.js', 'utils/material.js'];
  for (const utilPath of utilPaths) {
    const fullPath = path.join(extensionPath, utilPath);
    const code = fs.readFileSync(fullPath, 'utf8');
    try {
      await webContents.executeJavaScript(code);
    } catch (err) {
      console.warn(`[SketchRip] Failed to inject ${utilPath}:`, err.message);
    }
  }
  
  // Load content script
  const contentPath = path.join(extensionPath, 'content.js');
  const code = fs.readFileSync(contentPath, 'utf8');
  try {
    await webContents.executeJavaScript(code);
  } catch (err) {
    console.warn('[SketchRip] Failed to inject content.js:', err.message);
  }
}

/**
 * Run the extraction on a webContents.
 * This is the core extraction logic that runs in the page context.
 */
async function runExtraction(webContents) {
  try {
    // First, ensure content scripts are injected
    await injectContentScript(webContents);
    
    // Wait a bit for Sketchfab model to load
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Run the extraction function
    const result = await webContents.executeJavaScript(`
      (function runExtraction() {
        // Find the Three.js renderer and scene
        return findAndExtract();
      })()
    `);
    
    return result || { ok: false, error: 'Extraction returned no result' };
  } catch (err) {
    console.error('[SketchRip] Extraction failed:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Find Sketchfab's Three.js scene and extract model data.
 * This runs in the page context.
 */
async function findAndExtract() {
  const startTime = Date.now();
  const result = { status: 'extracting', startTime };
  
  try {
    // Step 1: Find Three.js
    const three = findThreeJS();
    if (!three) {
      result.status = 'error';
      result.error = 'Three.js not found on page';
      return result;
    }
    result.threeVersion = three.RENDERER || 'unknown';
    
    // Step 2: Find renderer
    const renderer = findRenderer(three);
    result.rendererFound = !!renderer;
    
    // Step 3: Find scene
    const scene = findScene(three, renderer);
    if (!scene) {
      result.status = 'error';
      result.error = 'Scene not found';
      return result;
    }
    
    result.sceneName = scene.name || 'unnamed';
    
    // Step 4: Extract meshes
    const meshData = extractMeshes(scene, three);
    result.meshes = meshData.meshes;
    result.stats = meshData.stats;
    
    // Step 5: Extract materials
    const materialData = extractMaterials(scene);
    result.materials = materialData.materials;
    result.textureMap = materialData.textureMap;
    
    // Step 6: Extract textures (sample data only, no image yet)
    const texData = extractTextures(materialData);
    result.textures = texData;
    
    // Step 7: Check animations
    result.animations = checkAnimations(scene, three);
    
    result.status = 'success';
    result.extractTime = Date.now() - startTime;
    
    return result;
  } catch (err) {
    result.status = 'error';
    result.error = err.message;
    result.stack = err.stack;
    console.error('[SketchRip] Extraction error:', err);
    return result;
  }
}

/**
 * Find Three.js instance on the page.
 */
function findThreeJS() {
  // Check window
  if (window.THREE) return window.THREE;
  
  // Scan object tree
  return scanForThree(window, 0, 0);
}

function scanForThree(obj, depth, count) {
  if (count > 50000) return null; // Prevent infinite loops
  if (depth > 6) return null;
  if (!obj || typeof obj !== 'object') return null;
  
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && val.THREE && typeof val.THREE === 'object' && val.WebGLRenderer) {
      return val.THREE;
    }
    if (val && val.WebGLRenderer) {
      // This IS the Three.js instance
      return val;
    }
    if (val && typeof val === 'object') {
      const found = scanForThree(val, depth + 1, count + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find the WebGL renderer.
 */
function findRenderer(three) {
  function scan(obj, depth = 0) {
    if (depth > 5) return null;
    if (!obj || typeof obj !== 'object') return null;
    
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && val.domElement && val.domElement instanceof HTMLCanvasElement) {
        return val;
      }
      if (val && typeof val === 'object') {
        const found = scan(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  
  // Scan window for renderer
  let result = scan(window);
  if (result) return result;
  
  // Fallback: find canvas with WebGL context
  const canvases = document.querySelectorAll('canvas');
  for (const canvas of canvases) {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) return { domElement: canvas, gl };
  }
  
  return null;
}

/**
 * Find the Three.js scene.
 */
function findScene(three, renderer) {
  // Method 1: Search for THREE.Scene objects
  function findSceneInObject(obj, depth = 0) {
    if (depth > 6) return null;
    if (!obj || typeof obj !== 'object') return null;
    
    // Check if this is a Scene
    if (obj.isScene) return obj;
    
    // Check if this has a _scene property (Three.js renderer)
    if (obj._scene && obj._scene.isScene) return obj._scene;
    
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === 'object') {
        const found = findSceneInObject(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  
  let scene = findSceneInObject(window);
  if (scene) return scene;
  
  // Method 2: Try to get from renderer
  if (renderer?.domElement) {
    // Try to find scene associated with this canvas
    return findSceneForCanvas(renderer.domElement);
  }
  
  // Method 3: Generic search
  return findSceneInObject(document);
}

function findSceneForCanvas(canvas) {
  function scan(obj, depth = 0) {
    if (depth > 5) return null;
    if (!obj || typeof obj !== 'object') return null;
    
    if (obj.domElement === canvas && obj._scene && obj._scene.isScene) {
      return obj._scene;
    }
    
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && typeof val === 'object') {
        const found = scan(val, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  
  return scan(window);
}

/**
 * Extract mesh data from scene.
 */
function extractMeshes(scene, three) {
  const meshes = [];
  let triCount = 0;
  let vertCount = 0;
  
  scene.traverse((object) => {
    if (object.isMesh || object.isInstancedMesh) {
      const meshData = extractMesh(object, three);
      if (meshData) {
        meshes.push(meshData);
        triCount += meshData.triangles;
        vertCount += meshData.vertices;
      }
    }
  });
  
  return {
    meshes,
    stats: {
      triangles: triCount,
      vertices: vertCount,
      meshCount: meshes.length,
    },
  };
}

/**
 * Extract data from a single mesh.
 */
function extractMesh(mesh, three) {
  if (!mesh.geometry) return null;
  
  const geometry = mesh.geometry;
  const result = {
    name: mesh.name || `mesh_${mesh.uuid.substring(0, 8)}`,
    uuid: mesh.uuid,
    type: mesh.type,
    position: {
      x: mesh.position.x,
      y: mesh.position.y,
      z: mesh.position.z,
    },
    rotation: {
      x: mesh.rotation.x,
      y: mesh.rotation.y,
      z: mesh.rotation.z,
    },
    scale: {
      x: mesh.scale.x,
      y: mesh.scale.y,
      z: mesh.scale.z,
    },
    isSkinned: mesh.isSkinnedMesh,
    isInstanced: mesh.isInstancedMesh,
  };
  
  if (geometry.isBufferGeometry) {
    const attrs = geometry.attributes;
    
    if (attrs.position) {
      const pos = attrs.position;
      result.vertices = pos.count;
      result.triangles = Math.floor(pos.count / 3);
      result.componentSize = pos.itemSize;
      
      if (geometry.index) {
        result.hasIndex = true;
        result.indexCount = geometry.index.count;
        result.indexType = geometry.index.type === three.Uint16BufferAttribute ? 'uint16' : 'uint32';
      }
    }
    
    if (attrs.normal) result.hasNormal = true;
    if (attrs.uv) result.hasUV = true;
    if (attrs.uv2) result.hasUV2 = true;
    if (attrs.tangent) result.hasTangent = true;
    if (attrs.color) result.hasColor = true;
    
    // Material reference
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      result.materialUuids = mats.map(m => m ? m.uuid : null);
      result.materialType = getMaterialClassName(mats[0]);
    }
  }
  
  return result;
}

function getMaterialClassName(mat) {
  if (!mat?.constructor) return 'Unknown';
  return mat.constructor.name;
}

/**
 * Extract all materials from scene.
 */
function extractMaterials(scene) {
  const materials = new Map();
  const textureMap = new Map();
  
  scene.traverse((object) => {
    if (object.material) {
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of mats) {
        if (mat && mat.uuid && !materials.has(mat.uuid)) {
          materials.set(mat.uuid, mat);
          
          // Collect textures
          const texKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap'];
          for (const key of texKeys) {
            const tex = mat[key];
            if (tex && tex.isTexture) {
              textureMap.set(tex.uuid, {
                uuid: tex.uuid,
                name: tex.name,
                width: tex.image?.width,
                height: tex.image?.height,
                type: key,
                format: tex.format,
                minFilter: tex.minFilter,
                magFilter: tex.magFilter,
                wrapS: tex.wrapS,
                wrapT: tex.wrapT,
                hasMipmaps: tex.generateMipmaps,
              });
            }
          }
        }
      }
    }
  });
  
  return {
    materials: Array.from(materials.values()).map(mat => ({
      uuid: mat.uuid,
      name: mat.name || `mat_${mat.uuid.substring(0, 8)}`,
      type: getMaterialClassName(mat),
      color: mat.color ? {
        r: mat.color.r,
        g: mat.color.g,
        b: mat.color.b,
      } : null,
      opacity: mat.opacity ?? 1,
      transparent: mat.transparent ?? false,
      roughness: mat.roughness ?? 1,
      metalness: mat.metalness ?? 0,
      emissive: mat.emissive ? {
        r: mat.emissive.r,
        g: mat.emissive.g,
        b: mat.emissive.b,
      } : null,
      emissiveIntensity: mat.emissiveIntensity ?? 1,
      normalScale: mat.normalScale ? {
        x: mat.normalScale.x,
        y: mat.normalScale.y,
      } : null,
      maps: {},
    })),
    textureMap,
  };
}

/**
 * Extract texture info from materials.
 */
function extractTextures(materialData) {
  const textures = [];
  
  for (const [, tex] of materialData.textureMap) {
    textures.push(tex);
  }
  
  return textures;
}

/**
 * Check for animations.
 */
function checkAnimations(scene, three) {
  let hasAnimations = false;
  let clipNames = [];
  
  scene.traverse((object) => {
    if (object.isSkinnedMesh) {
      hasAnimations = true;
      if (object.skeleton) {
        clipNames.push(`Skeleton: ${object.name} (${object.skeleton.bones.length} bones)`);
      }
    }
  });
  
  return {
    hasAnimations,
    clips: clipNames,
  };
}
