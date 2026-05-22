/**
 * SketchRip - WebGL Model Extractor
 * 
 * Extracts 3D model data from Sketchfab's WebGL viewer by hooking into
 * the rendering pipeline and capturing scene graph, geometry, textures,
 * and material properties.
 */

// ============================================================
// WebGL Context Hook
// ============================================================

const _createContext = WebGLRenderingContext.prototype.getContext;
const _createContext2 = WebGL2RenderingContext.prototype.getContext;
const _getContextAttribs = WebGLRenderingContext.prototype.getContextAttributes;

const hookedContexts = [];

function patchCreateContext() {
  WebGLRenderingContext.prototype.getContext = function() {
    const ctx = _createContext.apply(this, arguments);
    if (ctx) patchWebGLContext(ctx);
    return ctx;
  };
  
  if (WebGL2RenderingContext) {
    WebGL2RenderingContext.prototype.getContext = function() {
      const ctx = _createContext2.apply(this, arguments);
      if (ctx) patchWebGLContext(ctx);
      return ctx;
    };
  }
}

function patchWebGLContext(ctx) {
  if (ctx._sketchripPatched) return;
  ctx._sketchripPatched = true;
  hookedContexts.push(ctx);
  
  // Hook createBuffer, createTexture, createShader, etc.
  // These are called during Sketchfab's model loading
  
  const origBindBuffer = ctx.bindBuffer;
  ctx.bindBuffer = function(target, buffer) {
    if (buffer) {
      // When a buffer is bound, its data will be uploaded soon
    }
    return origBindBuffer.call(this, target, buffer);
  };
}

// ============================================================
// Three.js Scene Graph Traversal
// ============================================================

/**
 * Find all Three.js renderer instances on the page.
 * Sketchfab uses its own Three.js fork.
 */
function findRenderers() {
  const renderers = [];
  
  // Method 1: Scan window for THREE instances
  const threeInstances = findThreeInstances();
  
  for (const three of threeInstances) {
    if (three.WebGLRenderer) {
      // Get all renderer instances
      const instances = getRendererInstances(three);
      renderers.push(...instances);
    }
  }
  
  // Method 2: Scan DOM for canvas elements with WebGL context
  const canvases = document.querySelectorAll('canvas');
  for (const canvas of canvases) {
    if (canvas.getContext('webgl2') || canvas.getContext('webgl')) {
      if (!renderers.find(r => r.domElement === canvas)) {
        renderers.push({ domElement: canvas });
      }
    }
  }
  
  return renderers;
}

function findThreeInstances() {
  const instances = [];
  
  // Check window for THREE
  if (window.THREE) instances.push(window.THREE);
  
  // Check all objects for THREE property
  function scanObject(obj, depth = 0) {
    if (depth > 5) return;
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val && val.THREE && val.WebGLRenderer) {
        instances.push(val);
        continue;
      }
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        scanObject(val, depth + 1);
      }
    }
  }
  scanObject(window);
  
  // Check document for THREE objects
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    if (script.textContent && script.textContent.includes('THREE')) {
      // Look for THREE instances in inline scripts
      const matches = script.textContent.match(/THREE\s*=\s*(\{[^}]+})/g);
      if (matches) {
        for (const m of matches) {
          // Try to find the object reference
        }
      }
    }
  }
  
  return instances;
}

/**
 * Get all WebGLRenderer instances from a THREE namespace object.
 * Three.js doesn't expose this directly, so we scan the prototype chain.
 */
function getRendererInstances(three) {
  const instances = [];
  
  // Method: Scan all properties of the THREE object and its prototypes
  // Three.js stores renderer references in various places
  
  // Try to find via renderer.domElement scanning
  const allCanvases = document.querySelectorAll('canvas');
  for (const canvas of allCanvases) {
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (gl) {
      // Find the renderer by checking renderer properties
      // Three.js stores the GL context in renderer.getContext()
      instances.push({
        domElement: canvas,
        gl: gl,
        // Will be populated when we traverse the scene
      });
    }
  }
  
  return instances;
}

// ============================================================
// Scene Graph Extraction
// ============================================================

/**
 * Extract all mesh data from a Three.js scene.
 */
function extractSceneData(scene, options = {}) {
  const result = {
    meshes: [],
    materials: [],
    textures: [],
    animations: null,
  };
  
  let totalTriangles = 0;
  let totalVertices = 0;
  
  scene.traverse((object) => {
    if (object.isMesh || object.isInstancedMesh) {
      const mesh = extractMesh(object);
      if (mesh) {
        result.meshes.push(mesh);
        totalTriangles += mesh.triangles;
        totalVertices += mesh.vertices;
      }
    }
    
    // Collect all materials
    if (object.material) {
      const mats = Array.isArray(object.material) ? object.material : [object.material];
      for (const mat of mats) {
        if (mat && !result.materials.find(m => m.uuid === mat.uuid)) {
          const matData = extractMaterial(mat);
          if (matData) result.materials.push(matData);
        }
      }
    }
    
    // Collect animations (from mixer)
    if (object.isSkinnedMesh) {
      // Handle skinned meshes (character models)
    }
  });
  
  result.stats = {
    triangles: totalTriangles,
    vertices: totalVertices,
    meshes: result.meshes.length,
    materials: result.materials.length,
  };
  
  return result;
}

/**
 * Extract a single mesh's geometry data.
 */
function extractMesh(mesh) {
  const geometry = mesh.geometry;
  if (!geometry) return null;
  
  const result = {
    uuid: mesh.uuid,
    name: mesh.name || `mesh_${mesh.uuid.substring(0, 8)}`,
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
    morphTargets: mesh.morphTargetInfluences ? mesh.morphTargetInfluences.length : 0,
  };
  
  // Extract BufferGeometry data
  if (geometry.isBufferGeometry) {
    const attrs = geometry.attributes;
    
    // Positions
    if (attrs.position) {
      const pos = attrs.position;
      result.attributes = result.attributes || {};
      result.attributes.position = {
        componentSize: pos.itemSize,
        count: pos.count,
        normalized: pos.normalized,
        isFloat: isFloatBuffer(pos),
      };
      // Store raw data (will be transferred as base64)
      result.data = {
        position: bufferToBase64(pos.array),
      };
      result.vertices = pos.count;
      result.triangles = Math.floor(pos.count / 3);
    }
    
    // Normals
    if (attrs.normal) {
      result.attributes.normal = {
        componentSize: attrs.normal.itemSize,
        count: attrs.normal.count,
      };
      if (result.data) {
        result.data.normal = bufferToBase64(attrs.normal.array);
      }
    }
    
    // UV coordinates
    if (attrs.uv) {
      result.attributes.uv = {
        componentSize: attrs.uv.itemSize,
        count: attrs.uv.count,
      };
      if (result.data) {
        result.data.uv = bufferToBase64(attrs.uv.array);
      }
    }
    
    // UV2 (second texture coordinate set)
    if (attrs.uv2) {
      result.attributes.uv2 = {
        componentSize: attrs.uv2.itemSize,
        count: attrs.uv2.count,
      };
    }
    
    // Tangents (needed for normal maps)
    if (attrs.tangent) {
      result.attributes.tangent = {
        componentSize: attrs.tangent.itemSize,
        count: attrs.tangent.count,
      };
    }
    
    // Vertex colors
    if (attrs.color) {
      result.attributes.color = {
        componentSize: attrs.color.itemSize,
        count: attrs.color.count,
      };
    }
    
    // Index (for indexed geometry)
    if (geometry.index) {
      result.index = {
        type: geometry.index.type, // Uint16Array or Uint32Array
        count: geometry.index.count,
      };
      if (result.data) {
        result.data.index = bufferToBase64(geometry.index.array);
      }
    }
    
    // Skin weights (for skinned meshes)
    if (geometry.skinIndices && geometry.skinWeights) {
      result.skinning = {
        indices: bufferToBase64(geometry.skinIndices.array),
        weights: bufferToBase64(geometry.skinWeights.array),
      };
    }
    
    // Morph targets
    if (geometry.morphAttributes) {
      result.morphTargets = {};
      for (const [key, targets] of Object.entries(geometry.morphAttributes)) {
        result.morphTargets[key] = {
          count: targets.length,
        };
      }
    }
    
    // Draw ranges
    if (geometry.drawRange && geometry.drawRange.count < Infinity) {
      result.drawRange = {
        start: geometry.drawRange.start,
        count: geometry.drawRange.count,
      };
    }
  } else if (geometry.geometry) {
    // BufferGeometryGroup - extract from each group
    for (const group of geometry.geometry) {
      const subMesh = extractMeshFromGeometry(group, mesh);
      if (subMesh) {
        // Merge into single mesh
        if (!result.subMeshes) result.subMeshes = [];
        result.subMeshes.push(subMesh);
      }
    }
  }
  
  // Extract material info
  if (mesh.material) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    result.materials = mats.map(m => m ? m.uuid : null);
  }
  
  // Instanced mesh data
  if (mesh.isInstancedMesh) {
    result.instanced = {
      count: mesh.count,
      instanceMatrix: bufferToBase64(mesh.instanceMatrix.array),
    };
  }
  
  return result;
}

function extractMeshFromGeometry(geometry, parentMesh) {
  const result = {
    name: parentMesh.name,
    attributes: {},
  };
  
  if (geometry.attributes.position) {
    result.attributes.position = {
      count: geometry.attributes.position.count,
      componentSize: geometry.attributes.position.itemSize,
    };
    result.vertices = geometry.attributes.position.count;
    result.triangles = Math.floor(geometry.attributes.position.count / 3);
  }
  
  if (geometry.index) {
    result.index = {
      type: geometry.index.type,
      count: geometry.index.count,
    };
    result.data = {
      index: bufferToBase64(geometry.index.array),
    };
    if (geometry.attributes.position) {
      result.data.position = bufferToBase64(geometry.attributes.position.array);
    }
    if (geometry.attributes.normal) {
      result.data.normal = bufferToBase64(geometry.attributes.normal.array);
    }
    if (geometry.attributes.uv) {
      result.data.uv = bufferToBase64(geometry.attributes.uv.array);
    }
  }
  
  return result;
}

/**
 * Check if a buffer contains floating point data.
 */
function isFloatBuffer(buffer) {
  const type = buffer?.array?.constructor?.name;
  return type === 'Float32Array' || type === 'Float64Array';
}

// ============================================================
// Texture Extraction
// ============================================================

/**
 * Extract texture data from a material.
 */
function extractTextures(material) {
  const textures = [];
  const texMapKeys = [
    'map',              // albedo/diffuse
    'normalMap',        // normal map
    'roughnessMap',     // roughness
    'metalnessMap',     // metalness
    'emissiveMap',      // emissive
    'alphaMap',         // alpha mask
    'displacementMap',  // displacement
    'aoMap',            // ambient occlusion
    'lightMap',         // light map
    'envMap',           // environment map
  ];
  
  for (const key of texMapKeys) {
    const tex = material[key];
    if (tex && tex.isTexture) {
      const texData = extractSingleTexture(tex);
      if (texData) textures.push(texData);
    }
  }
  
  // Also check the THREE material's map array
  if (material.map && Array.isArray(material.map)) {
    for (const tex of material.map) {
      if (tex && tex.isTexture) {
        const texData = extractSingleTexture(tex);
        if (texData) textures.push(texData);
      }
    }
  }
  
  return textures;
}

/**
 * Extract a single texture's image data.
 */
function extractSingleTexture(texture) {
  const source = texture.source || texture.image;
  if (!source) return null;
  
  let width, height, format;
  
  if (source.isImageData || source.isCanvas) {
    width = source.width;
    height = source.height;
  } else if (source.width) {
    width = source.width;
    height = height || source.height;
  }
  
  format = texture.format;
  
  // Convert texture to image data
  const imageData = getTextureImageData(texture);
  
  return {
    uuid: texture.uuid,
    name: texture.name || `texture_${texture.uuid.substring(0, 8)}`,
    width,
    height,
    format,
    type: texture.type,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    minFilter: texture.minFilter,
    magFilter: texture.magFilter,
    anisotropy: texture.anisotropy,
    isDepthMap: texture.isDepthTexture,
    hasMipmaps: texture.generateMipmaps,
    mipLevels: source ? countMipLevels(source) : 0,
    imageData: imageData,
  };
}

/**
 * Convert a WebGL texture to image data (base64 PNG).
 */
function getTextureImageData(texture) {
  const source = texture.source || texture.image;
  if (!source) return null;
  
  // If it's already an Image/Canvas, we can use it directly
  if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
    // Convert to PNG
    try {
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(source, 0, 0);
        const dataURL = canvas.toDataURL('image/png');
        return dataURL;
      }
    } catch (e) {
      console.warn('Texture extraction failed:', e.message);
    }
    return null;
  }
  
  // If it's a DataTexture or similar, try to read from GL
  if (source.width) {
    try {
      return readTextureFromGL(texture);
    } catch (e) {
      console.warn('GL read failed:', e.message);
    }
  }
  
  return null;
}

/**
 * Read texture data directly from WebGL context.
 */
function readTextureFromGL(texture) {
  const gl = texture.gl;
  if (!gl) {
    // Try to find GL context
    for (const canvas of document.querySelectorAll('canvas')) {
      const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (ctx) {
        gl = ctx;
        break;
      }
    }
  }
  
  if (!gl) return null;
  
  // Create a temporary framebuffer to read texture
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture._glTexture, 0);
  
  // Read pixels
  const pixels = new Uint8Array(texture.image.width * texture.image.height * 4);
  gl.readPixels(0, 0, texture.image.width, texture.image.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  
  // Convert to image
  const canvas = document.createElement('canvas');
  canvas.width = texture.image.width;
  canvas.height = texture.image.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(texture.image.width, texture.image.height);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
  
  // Flip vertically (WebGL Y is opposite of canvas Y)
  const flippedCanvas = document.createElement('canvas');
  flippedCanvas.width = canvas.width;
  flippedCanvas.height = canvas.height;
  const flippedCtx = flippedCanvas.getContext('2d');
  flippedCtx.scale(1, -1);
  flippedCtx.drawImage(canvas, 0, -canvas.height);
  
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  
  return flippedCanvas.toDataURL('image/png');
}

function countMipLevels(source) {
  if (source.imageData?.length) return source.imageData.length; // DataTexture
  return 1; // Default
}

// ============================================================
// Material Extraction
// ============================================================

/**
 * Extract material properties.
 */
function extractMaterial(material) {
  return {
    uuid: material.uuid,
    name: material.name || `mat_${material.uuid.substring(0, 8)}`,
    type: material.type,
    color: {
      r: material.color?.r ?? null,
      g: material.color?.g ?? null,
      b: material.color?.b ?? null,
    },
    transparent: material.transparent ?? false,
    opacity: material.opacity ?? 1.0,
    side: material.side,
    wireframe: material.wireframe ?? false,
    // PBR
    roughness: material.roughness ?? 1.0,
    metalness: material.metalness ?? 0.0,
    envMapIntensity: material.envMapIntensity ?? 1.0,
    // Emissive
    emissive: {
      r: material.emissive?.r ?? 0,
      g: material.emissive?.g ?? 0,
      b: material.emissive?.b ?? 0,
    },
    emissiveIntensity: material.emissiveIntensity ?? 1.0,
    // Normal
    normalScale: {
      x: material.normalScale?.x ?? 1,
      y: material.normalScale?.y ?? 1,
    },
    // Map keys (references to textures)
    maps: {
      map: material.map?.uuid ?? null,
      normalMap: material.normalMap?.uuid ?? null,
      roughnessMap: material.roughnessMap?.uuid ?? null,
      metalnessMap: material.metalnessMap?.uuid ?? null,
      emissiveMap: material.emissiveMap?.uuid ?? null,
      alphaMap: material.alphaMap?.uuid ?? null,
      aoMap: material.aoMap?.uuid ?? null,
    },
  };
}

// ============================================================
// Buffer Utilities
// ============================================================

function bufferToBase64(buffer) {
  if (!buffer) return null;
  
  // TypedArray
  const uint8 = new Uint8Array(buffer.buffer || buffer, buffer.byteOffset, buffer.byteLength);
  
  // Convert to binary string
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
    binary += String.fromCharCode.apply(null, chunk);
  }
  
  return btoa(binary);
}
