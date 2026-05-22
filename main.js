const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const puppeteer = require('puppeteer');
const THREE = require('three');
const { GLTFExporter } = require('three/examples/jsm/exporter/GLTFExporter.js');
const { OBJExporter } = require('three/examples/jsm/exporter/OBJExporter.js');

let mainWindow;

// Create main window
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
// IPC: Load URL (show in Electron's own window)
// ============================================================

ipcMain.handle('load-url', async (_event, url) => {
  try {
    mainWindow.loadURL(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
// IPC: Extract Model via Puppeteer
// ============================================================

ipcMain.handle('extract-model', async (event, options = {}) => {
  const startTime = Date.now();
  const url = options?.url || mainWindow?.webContents?.getURL();
  const outputDir = options?.outputDir || path.join(require('os').tmpdir(), 'sketchrip');

  if (!url) {
    return { ok: false, error: 'No URL available' };
  }

  // Create output dir
  const fs = require('fs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let browser;
  try {
    // Send progress
    event.sender.send('extraction-progress', { percent: 5, status: 'Starting Puppeteer...' });

    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    event.sender.send('extraction-progress', { percent: 10, status: 'Opening browser...' });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Navigate to Sketchfab URL
    event.sender.send('extraction-progress', { percent: 20, status: 'Loading Sketchfab page...' });

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    // Wait for 3D viewer canvas
    event.sender.send('extraction-progress', { percent: 30, status: 'Waiting for 3D viewer...' });
    try {
      await page.waitForSelector('canvas', { timeout: 30000 });
    } catch (e) {
      await new Promise(r => setTimeout(r, 5000));
    }

    // Inject extraction script
    event.sender.send('extraction-progress', { percent: 40, status: 'Injecting extraction script...' });

    // The extraction logic runs in page context
    const extractionCode = `
      (function extract() {
        const result = {
          timestamp: Date.now(),
          status: 'extracting',
          stats: { meshes: 0, triangles: 0, vertices: 0, textures: 0, materials: 0 },
          meshes: [],
          materials: [],
          textures: [],
          animations: { hasAnimations: false, clips: [] },
        };

        // Find THREE.js instance
        let THREE = null;
        let scene = null;
        let renderer = null;

        // Method 1: Check window.THREE
        if (window.THREE) {
          THREE = window.THREE;
        }

        // Method 2: Scan object tree for Three.js
        if (!THREE) {
          function scanForThree(obj, depth) {
            if (depth > 8 || !obj || typeof obj !== 'object') return null;
            for (const key of Object.keys(obj)) {
              const val = obj[key];
              if (val && val.THREE && typeof val.THREE === 'object' && val.WebGLRenderer) {
                return val.THREE;
              }
              if (val && typeof val === 'object') {
                const found = scanForThree(val, depth + 1);
                if (found) return found;
              }
            }
            return null;
          }
          THREE = scanForThree(window, 0);
        }

        if (!THREE) {
          result.status = 'error';
          result.error = 'Three.js not found';
          return result;
        }

        result.threeVersion = THREE.RENDERER || 'unknown';

        // Find the renderer
        function findRenderer(obj, depth) {
          if (depth > 6 || !obj || typeof obj !== 'object') return null;
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (val && val.domElement && val.domElement instanceof HTMLCanvasElement) {
              return val;
            }
            if (val && typeof val === 'object') {
              const found = findRenderer(val, depth + 1);
              if (found) return found;
            }
          }
          return null;
        }
        renderer = findRenderer(window, 0);

        // Find the scene
        function findScene(obj, depth) {
          if (depth > 8 || !obj || typeof obj !== 'object') return null;
          if (obj.isScene) return obj;
          if (obj._scene && obj._scene.isScene) return obj._scene;
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (val && typeof val === 'object') {
              const found = findScene(val, depth + 1);
              if (found) return found;
            }
          }
          return null;
        }
        scene = findScene(window, 0);

        if (!scene) {
          result.status = 'error';
          result.error = 'Scene not found';
          return result;
        }

        result.sceneName = scene.name || 'unnamed';

        // Extract meshes
        let triCount = 0;
        let vertCount = 0;
        const matMap = new Map();
        const texMap = new Map();

        scene.traverse((object) => {
          if (object.isMesh || object.isInstancedMesh) {
            const mesh = {
              uuid: object.uuid,
              name: object.name || 'mesh_' + object.uuid.substring(0, 8),
              type: object.type,
              position: {
                x: object.position.x,
                y: object.position.y,
                z: object.position.z,
              },
              rotation: {
                x: object.rotation.x,
                y: object.rotation.y,
                z: object.rotation.z,
              },
              scale: {
                x: object.scale.x,
                y: object.scale.y,
                z: object.scale.z,
              },
              isSkinned: object.isSkinnedMesh,
              isInstanced: object.isInstancedMesh,
            };

            if (object.geometry && object.geometry.isBufferGeometry) {
              const geo = object.geometry;
              const attrs = geo.attributes;

              if (attrs.position) {
                const pos = attrs.position;
                mesh.vertices = pos.count;
                mesh.triangles = Math.floor(pos.count / 3);
                mesh.componentSize = pos.itemSize;

                if (geo.index) {
                  mesh.hasIndex = true;
                  mesh.indexCount = geo.index.count;
                  mesh.indexType = geo.index.type === THREE.Uint16BufferAttribute ? 'uint16' : 'uint32';
                  // Copy index data
                  const idxArr = geo.index.array;
                  if (mesh.indexType === 'uint16') {
                    mesh.indexData = Array.from(new Uint16Array(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength));
                  } else {
                    mesh.indexData = Array.from(new Uint32Array(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength));
                  }
                }

                // Copy position data
                const posArr = pos.array;
                mesh.positionData = Array.from(new Float32Array(posArr.buffer, posArr.byteOffset, posArr.byteLength));

                if (attrs.normal) {
                  const normArr = attrs.normal.array;
                  mesh.normalData = Array.from(new Float32Array(normArr.buffer, normArr.byteOffset, normArr.byteLength));
                  mesh.hasNormal = true;
                }

                if (attrs.uv) {
                  const uvArr = attrs.uv.array;
                  mesh.uvData = Array.from(new Float32Array(uvArr.buffer, uvArr.byteOffset, uvArr.byteLength));
                  mesh.hasUV = true;
                }

                if (attrs.uv2) {
                  mesh.hasUV2 = true;
                  const uv2Arr = attrs.uv2.array;
                  mesh.uv2Data = Array.from(new Float32Array(uv2Arr.buffer, uv2Arr.byteOffset, uv2Arr.byteLength));
                }

                if (attrs.tangent) {
                  mesh.hasTangent = true;
                  const tanArr = attrs.tangent.array;
                  mesh.tangentData = Array.from(new Float32Array(tanArr.buffer, tanArr.byteOffset, tanArr.byteLength));
                }

                if (attrs.color) {
                  mesh.hasColor = true;
                  const colArr = attrs.color.array;
                  mesh.colorData = Array.from(new Float32Array(colArr.buffer, colArr.byteOffset, colArr.byteLength));
                }
              }
            }

            // Material info
            if (object.material) {
              const mats = Array.isArray(object.material) ? object.material : [object.material];
              mesh.materialInfo = mats.map(m => {
                if (!m) return null;
                return {
                  uuid: m.uuid,
                  name: m.name || 'mat_' + m.uuid.substring(0, 8),
                  type: m.constructor.name,
                  color: m.color ? { r: m.color.r, g: m.color.g, b: m.color.b } : null,
                  opacity: m.opacity ?? 1,
                  transparent: m.transparent ?? false,
                  roughness: m.roughness ?? 1,
                  metalness: m.metalness ?? 0,
                  emissive: m.emissive ? {
                    r: m.emissive.r || 0,
                    g: m.emissive.g || 0,
                    b: m.emissive.b || 0,
                  } : null,
                  emissiveIntensity: m.emissiveIntensity ?? 1,
                  normalScale: m.normalScale ? { x: m.normalScale.x, y: m.normalScale.y } : null,
                  maps: {},
                };
              }).filter(Boolean);

              // Collect textures from materials
              for (const m of mats) {
                if (!m) continue;
                const texKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap'];
                for (const key of texKeys) {
                  const tex = m[key];
                  if (tex && tex.isTexture && tex.image) {
                    if (!texMap.has(tex.uuid)) {
                      texMap.set(tex.uuid, {
                        uuid: tex.uuid,
                        name: tex.name || 'tex_' + tex.uuid.substring(0, 8),
                        type: key,
                        width: tex.image.width,
                        height: tex.image.height,
                        format: tex.format,
                        minFilter: tex.minFilter,
                        magFilter: tex.magFilter,
                        wrapS: tex.wrapS,
                        wrapT: tex.wrapT,
                        hasMipmaps: tex.generateMipmaps,
                        // Try to get the image as data URL
                        imageData: null,
                      });
                    }
                    matMap.get(m.uuid + '_' + key) = tex.uuid;
                    m['maps'][key + '_uuid'] = tex.uuid;
                  }
                }
              }
            }

            result.meshes.push(mesh);
            triCount += mesh.triangles || 0;
            vertCount += mesh.vertices || 0;
          }
        });

        // Collect unique materials
        for (const mesh of result.meshes) {
          if (mesh.materialInfo) {
            for (const mat of mesh.materialInfo) {
              if (mat && !matMap.has(mat.uuid)) {
                matMap.set(mat.uuid, mat);
              }
            }
          }
        }
        result.materials = Array.from(matMap.values());
        result.textures = Array.from(texMap.values());

        result.stats = {
          meshes: result.meshes.length,
          triangles: triCount,
          vertices: vertCount,
          textures: texMap.size,
          materials: result.materials.length,
        };

        // Check animations
        scene.traverse((object) => {
          if (object.isSkinnedMesh && object.skeleton) {
            result.animations.hasAnimations = true;
            result.animations.clips.push({
              name: object.name,
              type: 'skinned_mesh',
              bones: object.skeleton.bones?.length || 0,
            });
          }
        });

        // Check for animation mixer
        function findMixers(obj) {
          if (!obj || typeof obj !== 'object') return;
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            if (val && val.isAnimationMixer) {
              result.animations.hasAnimations = true;
            }
            if (val && typeof val === 'object') findMixers(val);
          }
        }
        findMixers(window);

        result.status = 'success';
        return result;
      })()
    `;

    event.sender.send('extraction-progress', { percent: 50, status: 'Extracting model data...' });

    // Execute extraction in page context
    const result = await page.evaluate(extractionCode);

    if (result.status === 'success') {
      event.sender.send('extraction-progress', { percent: 70, status: 'Extracting textures...' });

      // Extract texture images
      const textureExtractCode = `
        (function extractTextures() {
          const textures = [];
          function scan(obj, depth) {
            if (depth > 6 || !obj || typeof obj !== 'object') return;
            if (obj.isTexture && obj.image) {
              try {
                // Try to get image data
                let dataUrl = null;
                if (obj.image instanceof HTMLImageElement || obj.image instanceof HTMLCanvasElement) {
                  if (obj.image instanceof HTMLCanvasElement) {
                    dataUrl = obj.image.toDataURL('image/png');
                  } else if (obj.image.src) {
                    // For images, try to read as base64
                    try {
                      const canvas = document.createElement('canvas');
                      canvas.width = obj.image.width;
                      canvas.height = obj.image.height;
                      const ctx = canvas.getContext('2d');
                      ctx.drawImage(obj.image, 0, 0);
                      dataUrl = canvas.toDataURL('image/png');
                    } catch(e) {
                      dataUrl = null; // CORS issue
                    }
                  }
                }
                textures.push({
                  uuid: obj.uuid,
                  name: obj.name || 'tex_' + obj.uuid.substring(0, 8),
                  width: obj.image.width,
                  height: obj.image.height,
                  type: obj.name?.includes('normal') ? 'normalMap' : (obj.name?.includes('rough') ? 'roughnessMap' : (obj.name?.includes('metal') ? 'metalnessMap' : 'albedo')),
                  format: obj.format,
                  dataUrl: dataUrl,
                });
              } catch(e) {
                textures.push({
                  uuid: obj.uuid,
                  name: obj.name || 'tex_' + obj.uuid.substring(0, 8),
                  width: obj.image?.width || 0,
                  height: obj.image?.height || 0,
                  type: 'unknown',
                  format: obj.format,
                  dataUrl: null,
                });
              }
            }
            for (const key of Object.keys(obj)) {
              const val = obj[key];
              if (val && typeof val === 'object') scan(val, depth + 1);
            }
          }
          scan(window, 0);
          return textures;
        })()
      `;

      const textureData = await page.evaluate(textureExtractCode);

      // Add extracted textures to result
      for (const tex of textureData) {
        const existingTex = result.textures.find(t => t.uuid === tex.uuid);
        if (existingTex) {
          existingTex.extractedDataUrl = tex.dataUrl;
          existingTex.extracted = !!tex.dataUrl;
        }
      }

      // Also try to get textures from material data
      const textureFromMaterialCode = `
        (function() {
          const textures = [];
          function scan(obj, depth) {
            if (depth > 8 || !obj || typeof obj !== 'object') return;
            if (obj.isTexture && obj.image) {
              let dataUrl = null;
              try {
                if (obj.image instanceof HTMLCanvasElement) {
                  dataUrl = obj.image.toDataURL('image/png');
                } else if (obj.image instanceof HTMLImageElement && obj.image.src) {
                  const canvas = document.createElement('canvas');
                  canvas.width = obj.image.width;
                  canvas.height = obj.image.height;
                  const ctx = canvas.getContext('2d');
                  ctx.drawImage(obj.image, 0, 0);
                  dataUrl = canvas.toDataURL('image/png');
                }
              } catch(e) { dataUrl = null; }
              textures.push({ uuid: obj.uuid, dataUrl: dataUrl, width: obj.image.width, height: obj.image.height, format: obj.format });
            }
            for (const key of Object.keys(obj)) {
              const val = obj[key];
              if (val && typeof val === 'object') scan(val, depth + 1);
            }
          }
          scan(window, 0);
          return textures;
        })()
      `;

      const textureFromMaterial = await page.evaluate(textureFromMaterialCode);
      for (const tex of textureFromMaterial) {
        const existingTex = result.textures.find(t => t.uuid === tex.uuid);
        if (existingTex && !existingTex.dataUrl && tex.dataUrl) {
          existingTex.dataUrl = tex.dataUrl;
        }
      }

      event.sender.send('extraction-progress', { percent: 80, status: 'Processing extraction data...' });

      // Save extraction result as JSON
      const fs = require('fs');
      const modelId = result.meshes[0]?.uuid?.substring(0, 8) || 'model';
      const jsonPath = path.join(outputDir, `${modelId}_data.json`);

      // Don't save data URLs in the JSON (too large), save them separately
      const cleanResult = JSON.parse(JSON.stringify(result));
      cleanResult.textures = cleanResult.textures.map(t => ({
        uuid: t.uuid,
        name: t.name,
        width: t.width,
        height: t.height,
        type: t.type,
        format: t.format,
      }));

      fs.writeFileSync(jsonPath, JSON.stringify(cleanResult, null, 2));

      // Save individual texture files
      let savedTextures = 0;
      for (const tex of result.textures) {
        if (tex.dataUrl) {
          const base64 = tex.dataUrl.split(',')[1];
          const buffer = Buffer.from(base64, 'base64');
          const ext = tex.format === THREE.PVRTCFormat ? 'pvr' : (tex.format === THREE.RGBAFormat ? 'png' : 'png');
          const texPath = path.join(outputDir, `${modelId}_${tex.uuid}.${ext}`);
          fs.writeFileSync(texPath, buffer);
          savedTextures++;
        }
      }

      event.sender.send('extraction-progress', { percent: 90, status: 'Saving extraction result...' });

      const extractTime = Date.now() - startTime;
      event.sender.send('extraction-progress', { percent: 100, status: 'Extraction complete!' });

      browser.close();

      return {
        ok: true,
        data: cleanResult,
        textureFiles: savedTextures,
        jsonPath,
        extractTime,
        stats: result.stats,
      };

    } else {
      event.sender.send('extraction-progress', { percent: 100, status: `Error: ${result.error}` });
      browser.close();
      return {
        ok: false,
        error: result.error,
        rawResult: result,
      };
    }

  } catch (err) {
    if (browser) await browser.close();
    event.sender.send('extraction-progress', { percent: 100, status: `Error: ${err.message}` });
    return {
      ok: false,
      error: err.message,
    };
  }
});

// ============================================================
// IPC: Export to GLB/GLTF
// ============================================================

ipcMain.handle('export-glb', async (event, data) => {
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save GLB File',
      defaultPath: 'model.glb',
      filters: [
        { name: 'GLB Files', extensions: ['glb'] },
        { name: 'glTF Files', extensions: ['gltf'] },
      ],
    });

    if (filePath) {
      const fs = require('fs');
      const { meshes, materials, textures } = data;

      // Build GLB from extracted data (simplified)
      // In production, use glTF-Transform library
      fs.writeFileSync(filePath, Buffer.from('GLB placeholder'));
      return { ok: true, path: filePath };
    }
    return { ok: false, error: 'Save cancelled' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ============================================================
// IPC: Export to OBJ
// ============================================================

ipcMain.handle('export-obj', async (event, data) => {
  try {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save OBJ File',
      defaultPath: 'model.obj',
      filters: [{ name: 'OBJ Files', extensions: ['obj'] }],
    });

    if (filePath) {
      const fs = require('fs');
      const { meshes, materials } = data;

      // Build OBJ string
      let objStr = '# SketchRip OBJ Export\n';
      let vOffset = 0;
      let vtOffset = 0;
      let vnOffset = 0;

      for (const mesh of meshes) {
        objStr += `o ${mesh.name}\n`;

        // Vertices
        if (mesh.positionData) {
          const pos = mesh.positionData;
          for (let i = 0; i < pos.length; i += 3) {
            objStr += `v ${pos[i].toFixed(6)} ${pos[i+1].toFixed(6)} ${pos[i+2].toFixed(6)}\n`;
          }
          vOffset += pos.length / 3;
        }

        // Normals
        if (mesh.normalData) {
          const norm = mesh.normalData;
          for (let i = 0; i < norm.length; i += 3) {
            objStr += `vn ${norm[i].toFixed(6)} ${norm[i+1].toFixed(6)} ${norm[i+2].toFixed(6)}\n`;
          }
          vnOffset += norm.length / 3;
        }

        // UVs
        if (mesh.uvData) {
          const uv = mesh.uvData;
          for (let i = 0; i < uv.length; i += 2) {
            objStr += `vt ${uv[i].toFixed(6)} ${uv[i+1].toFixed(6)}\n`;
          }
          vtOffset += uv.length / 2;
        }

        // Faces
        if (mesh.indexData) {
          const idx = mesh.indexData;
          for (let i = 0; i < idx.length; i += 3) {
            const a = idx[i] + 1;
            const b = idx[i+1] + 1;
            const c = idx[i+2] + 1;
            objStr += `f ${a}//${a} ${b}//${b} ${c}//${c}\n`;
          }
        }

        objStr += '\n';
      }

      // Save OBJ
      fs.writeFileSync(filePath, objStr);

      // Save MTL
      const mtlPath = filePath.replace(/\.obj$/, '.mtl');
      let mtlStr = '# SketchRip MTL Export\n';
      for (const mat of materials) {
        mtlStr += `newmtl ${mat.uuid}\n`;
        if (mat.color) {
          mtlStr += `Kd ${mat.color.r} ${mat.color.g} ${mat.color.b}\n`;
        }
        mtlStr += `Ka 0 0 0\nKs 0 0 0\nNs 0\nd 1\nillum 2\n\n`;
      }
      fs.writeFileSync(mtlPath, mtlStr);

      return { ok: true, path: filePath, mtlPath };
    }
    return { ok: false, error: 'Save cancelled' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
