/**
 * SketchRip - Content Script
 * 
 * Main content script that runs on Sketchfab pages.
 * Orchestrates WebGL context hooking, scene traversal, and extraction.
 */

(function() {
  'use strict';
  
  // Prevent double injection
  if (window.__sketchrip_injected__) return;
  window.__sketchrip_injected__ = true;
  
  console.log('[SketchRip] Initializing...');
  
  // ============================================================
  // Initialization
  // ============================================================
  
  // Patch WebGL context creation
  patchCreateContext();
  
  // Wait for Sketchfab model to load
  waitForModel();
  
  // ============================================================
  // Model Detection
  // ============================================================
  
  function waitForModel() {
    const maxAttempts = 30; // 30 seconds
    let attempts = 0;
    
    const checkInterval = setInterval(() => {
      attempts++;
      
      // Check for Sketchfab's model data
      const model = findSketchfabModel();
      if (model) {
        clearInterval(checkInterval);
        console.log('[SketchRip] Model found!', model);
        onModelLoaded(model);
        return;
      }
      
      // Check for canvas elements
      const canvases = document.querySelectorAll('canvas');
      for (const canvas of canvases) {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          console.log('[SketchRip] WebGL canvas found');
          onCanvasFound(canvas);
          return;
        }
      }
      
      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        console.warn('[SketchRip] Timeout waiting for model');
      }
    }, 1000);
  }
  
  function findSketchfabModel() {
    // Method 1: Look for THREE instances
    const three = findThreeInstance();
    if (!three) return null;
    
    // Method 2: Look for Sketchfab-specific properties
    // Sketchfab sets window.__SKETCHFAB__ or similar
    if (window.__SKETCHFAB__) return { hasSketchfabData: true };
    
    // Method 3: Check for model loading indicators
    const loader = document.querySelector('[class*="loader"]');
    const modelContainer = document.querySelector('[class*="model"]');
    
    if (loader && loader.offsetParent !== null) {
      return { loading: true };
    }
    
    if (modelContainer) {
      return { hasContainer: true };
    }
    
    return null;
  }
  
  function findThreeInstance() {
    // Check window
    if (window.THREE) return window.THREE;
    
    // Scan object tree
    const found = [];
    
    function scan(obj, depth = 0) {
      if (depth > 6) return;
      if (!obj || typeof obj !== 'object') return;
      
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && val.THREE && typeof val.THREE === 'object') {
          found.push(val);
        }
        if (val && typeof val === 'object') {
          scan(val, depth + 1);
        }
      }
    }
    
    scan(window);
    return found[0];
  }
  
  function onModelLoaded(model) {
    console.log('[SketchRip] Model loaded, extracting...');
    
    // Give renderer time to initialize
    setTimeout(() => extractModel(), 2000);
  }
  
  function onCanvasFound(canvas) {
    console.log('[SketchRip] Canvas found:', canvas);
    // Wait a bit for WebGL context to be populated
    setTimeout(() => extractModel(), 1000);
  }
  
  // ============================================================
  // Extraction Orchestrator
  // ============================================================
  
  function extractModel() {
    console.log('[SketchRip] Starting extraction...');
    
    const result = {
      status: 'extracting',
      timestamp: Date.now(),
    };
    
    try {
      // Step 1: Find Three.js instances
      console.log('[SketchRip] Finding Three.js...');
      const three = findThreeInstance();
      
      if (!three) {
        result.status = 'error';
        result.error = 'Three.js not found. Sketchfab may not have loaded properly.';
        console.warn('[SketchRip] Three.js not found');
        reportResult(result);
        return;
      }
      
      result.threeVersion = three.RENDERER;
      console.log('[SketchRip] Found Three.js');
      
      // Step 2: Find the renderer
      console.log('[SketchRip] Finding renderer...');
      const renderer = findRenderer(three);
      if (!renderer) {
        result.status = 'warning';
        result.error = 'Renderer not found via standard methods. Attempting fallback...';
        console.warn('[SketchRip] Renderer not found, trying fallback');
      }
      result.renderer = renderer ? 'found' : 'not found (fallback mode)';
      
      // Step 3: Find the scene
      console.log('[SketchRip] Finding scene...');
      const scene = findScene(three);
      if (!scene) {
        result.status = 'error';
        result.error = 'Scene not found. Model data may not be available.';
        reportResult(result);
        return;
      }
      result.scene = {
        name: scene.name,
        objectCount: countSceneObjects(scene),
      };
      console.log('[SketchRip] Found scene with', result.scene.objectCount, 'objects');
      
      // Step 4: Extract meshes
      console.log('[SketchRip] Extracting meshes...');
      const meshes = [];
      let triCount = 0;
      let vertCount = 0;
      
      scene.traverse((object) => {
        if (object.isMesh || object.isInstancedMesh) {
          const meshData = extractMeshData(object, three);
          if (meshData) {
            meshes.push(meshData);
            triCount += meshData.triangles;
            vertCount += meshData.vertices;
          }
        }
      });
      
      result.meshes = meshes;
      result.stats = {
        triangles: triCount,
        vertices: vertCount,
        meshCount: meshes.length,
      };
      console.log('[SketchRip] Extracted', meshes.length, 'meshes,', triCount, 'triangles');
      
      // Step 5: Extract materials
      console.log('[SketchRip] Extracting materials...');
      const materials = extractAllMaterials(scene);
      result.materials = materials;
      console.log('[SketchRip] Found', materials.length, 'materials');
      
      // Step 6: Extract textures
      console.log('[SketchRip] Extracting textures...');
      const textures = [];
      for (const mat of materials) {
        const texList = extractTexturesFromMaterial(mat, three);
        textures.push(...texList);
      }
      result.textures = textures;
      console.log('[SketchRip] Found', textures.length, 'textures');
      
      // Step 7: Check for animations
      console.log('[SketchRip] Checking animations...');
      const animations = checkAnimations(scene, three);
      result.animations = animations;
      
      // Final
      result.status = 'success';
      result.extractTime = Date.now() - (result.startTime || Date.now());
      
      console.log('[SketchRip] Extraction complete!');
      console.log('[SketchRip]', JSON.stringify(result.stats, null, 2));
      
    } catch (err) {
      console.error('[SketchRip] Extraction error:', err);
      result.status = 'error';
      result.error = err.message;
      result.stack = err.stack;
    }
    
    reportResult(result);
  }
  
  // ============================================================
  // Scene Finding
  // ============================================================
  
  function findRenderer(three) {
    // Method 1: Search window for WebGLRenderer instances
    const renderers = findRenderers(three);
    if (renderers.length > 0) return renderers[0];
    
    // Method 2: Search by canvas
    const canvases = document.querySelectorAll('canvas');
    for (const canvas of canvases) {
      const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
      if (gl && gl.getParameter) {
        return { domElement: canvas, gl: gl };
      }
    }
    
    return null;
  }
  
  function findRenderers(three) {
    const renderers = [];
    
    function scanForRenderer(obj, depth = 0) {
      if (depth > 4) return;
      if (!obj || typeof obj !== 'object') return;
      
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && val.domElement && val.domElement instanceof HTMLCanvasElement) {
          renderers.push(val);
        }
        if (val && typeof val === 'object') {
          scanForRenderer(val, depth + 1);
        }
      }
    }
    
    scanForRenderer(window);
    return renderers;
  }
  
  function findScene(three) {
    // Method 1: Look for scene in renderer
    const renderer = findRenderer(three);
    if (renderer?.domElement) {
      // Search window for scene associated with this renderer
      const result = findSceneForRenderer(renderer.domElement);
      if (result) return result;
    }
    
    // Method 2: Look for THREE.Scene directly
    const result = findThreeObject(window, 'Scene');
    return result;
  }
  
  function findSceneForRenderer(canvas) {
    function scan(obj, depth = 0) {
      if (depth > 6) return null;
      if (!obj || typeof obj !== 'object') return null;
      
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val && val.domElement === canvas && val._scene) {
          return val._scene;
        }
        if (val && val.isScene) {
          // Check if this scene belongs to our renderer
          // Three.js stores scene in renderer's properties
        }
        const found = scan(val, depth + 1);
        if (found) return found;
      }
      return null;
    }
    
    return scan(window);
  }
  
  function findThreeObject(obj, typeName) {
    function scan(o, d = 0) {
      if (d > 6) return null;
      if (!o || typeof o !== 'object') return null;
      
      for (const key of Object.keys(o)) {
        const val = o[key];
        if (val && val.is[typeName]) {
          return val;
        }
        const found = scan(val, d + 1);
        if (found) return found;
      }
      return null;
    }
    return scan(obj);
  }
  
  function countSceneObjects(scene) {
    let count = 0;
    scene.traverse(() => count++);
    return count;
  }
  
  // ============================================================
  // Mesh Extraction
  // ============================================================
  
  function extractMeshData(mesh, three) {
    if (!mesh.geometry) return null;
    
    const geometry = mesh.geometry;
    const result = {
      name: mesh.name || `mesh_${mesh.uuid.substring(0, 8)}`,
      uuid: mesh.uuid,
      type: mesh.type,
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
      scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
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
        
        // Check for index
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
      
      // Morph targets
      if (geometry.morphAttributes) {
        const morphCount = Object.values(geometry.morphAttributes).reduce(
          (sum, arr) => sum + arr.length, 0
        );
        if (morphCount > 0) {
          result.morphTargetCount = morphCount;
        }
      }
    }
    
    return result;
  }
  
  function getMaterialClassName(mat) {
    if (!mat?.constructor) return 'Unknown';
    return mat.constructor.name;
  }
  
  // ============================================================
  // Material & Texture Extraction
  // ============================================================
  
  function extractAllMaterials(scene) {
    const materials = new Map();
    
    scene.traverse((object) => {
      if (object.material) {
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const mat of mats) {
          if (mat && mat.uuid && !materials.has(mat.uuid)) {
            materials.set(mat.uuid, mat);
          }
        }
      }
    });
    
    const result = [];
    for (const [, mat] of materials) {
      result.push({
        uuid: mat.uuid,
        name: mat.name || `mat_${mat.uuid.substring(0, 8)}`,
        type: getMaterialClassName(mat),
        color: mat.color ? {
          r: mat.color.r, g: mat.color.g, b: mat.color.b
        } : null,
        opacity: mat.opacity ?? 1,
        transparent: mat.transparent ?? false,
        roughness: mat.roughness ?? 1,
        metalness: mat.metalness ?? 0,
        emissive: mat.emissive ? {
          r: mat.emissive.r, g: mat.emissive.g, b: mat.emissive.b
        } : null,
        emissiveIntensity: mat.emissiveIntensity ?? 1,
        maps: {},
      });
      
      // Collect texture map references
      const mapKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap'];
      for (const key of mapKeys) {
        if (mat[key]) {
          result[result.length - 1].maps[key] = {
            uuid: mat[key].uuid,
            width: mat[key].image?.width,
            height: mat[key].image?.height,
          };
        }
      }
    }
    
    return result;
  }
  
  function extractTexturesFromMaterial(material, three) {
    const textures = [];
    const texKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap'];
    
    for (const key of texKeys) {
      const tex = material[key];
      if (tex && tex.isTexture && tex.image) {
        textures.push({
          uuid: tex.uuid,
          name: tex.name || `tex_${tex.uuid.substring(0, 8)}`,
          type: key,
          width: tex.image.width,
          height: tex.image.height,
          hasMipmaps: tex.generateMipmaps,
          wrapS: tex.wrapS,
          wrapT: tex.wrapT,
          format: tex.format,
          minFilter: tex.minFilter,
          magFilter: tex.magFilter,
          image: tex.image,
        });
      }
    }
    
    return textures;
  }
  
  // ============================================================
  // Animation Detection
  // ============================================================
  
  function checkAnimations(scene, three) {
    let hasAnimations = false;
    let animationCount = 0;
    let clipNames = [];
    
    scene.traverse((object) => {
      if (object.isSkinnedMesh) {
        hasAnimations = true;
        animationCount++;
        if (object.skeleton) {
          clipNames.push(`Skeleton: ${object.name} (${object.skeleton.bones.length} bones)`);
        }
      }
    });
    
    // Check for AnimationMixer
    if (three.AnimationMixer) {
      function findMixers(obj) {
        for (const key of Object.keys(obj)) {
          const val = obj[key];
          if (val && val.isAnimationMixer) {
            hasAnimations = true;
            if (val._clipActionInitiator) {
              const actions = Object.values(val._clipActionInitiator || {});
              for (const a of actions) {
                if (a._clip) clipNames.push(`Clip: ${a._clip.name} (${a._clip.tracks.length} tracks, ${a._clip.duration.toFixed(2)}s)`);
              }
            }
          }
          if (val && typeof val === 'object') findMixers(val);
        }
      }
      findMixers(window);
    }
    
    return {
      hasAnimations,
      count: hasAnimations ? animationCount : 0,
      clips: clipNames,
    };
  }
  
  // ============================================================
  // Result Reporting
  // ============================================================
  
  function reportResult(result) {
    // Send to Electron via Chrome runtime messaging
    // This works when the extension is loaded in Electron's webview
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'EXTRACTION_COMPLETE',
        data: result,
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[SketchRip] Chrome messaging error:', chrome.runtime.lastError.message);
        }
      });
    }
    
    // Also make available via window for Electron to read
    window.__sketchrip_result__ = result;
    
    // Dispatch event for UI to pick up
    document.dispatchEvent(new CustomEvent('sketchrip:extraction-complete', { detail: result }));
    
    console.log('[SketchRip] Result available via window.__sketchrip_result__');
    return result;
  }
  
})();
