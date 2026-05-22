/**
 * SketchRip - glTF/GLB Exporter
 * 
 * Converts extracted mesh data into glTF 2.0 format.
 */

const GLB_HEADER = {
  magic: 0x46546C67, // "glTF"
  version: 2,
  length: 0,
};

const CHUNK_TYPES = {
  JSON: 0x4E4F534A,
  BIN: 0x004E4942,
};

const GL_FORMATS = {
  R: 5000,
  RG: 5001,
  RGB: 5003,
  RGBA: 5004,
  RED: 5010,
  RED_INTEGER: 5010,
};

const GL_TYPES = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
};

/**
 * Export mesh data to GLB format.
 * @param {Array} meshes - Extracted mesh data
 * @param {Array} materials - Extracted materials
 * @param {Array} textures - Extracted textures
 * @returns {Uint8Array} GLB binary
 */
function exportGLB(meshes, materials, textures) {
  // Step 1: Build glTF JSON
  const gltf = buildGLTF(meshes, materials, textures);
  
  // Step 2: Serialize JSON to JSON chunk
  const jsonStr = JSON.stringify(gltf);
  const jsonChunk = serializeJSONChunk(jsonStr);
  
  // Step 3: Serialize BIN chunk
  const binChunk = serializeBINChunk(gltf);
  
  // Step 4: Assemble GLB
  const binLength = binChunk.length;
  const glb = new Uint8Array(
    12 + // Header
    jsonChunk.length + 8 + // JSON chunk (8 bytes header)
    (binLength > 0 ? binLength + 8 : 0) // BIN chunk
  );
  
  let offset = 0;
  
  // Header
  writeUint32(glb, offset, GLB_HEADER.magic); offset += 4;
  writeUint32(glb, offset, GLB_HEADER.version); offset += 4;
  writeUint32(glb, offset, glb.length); offset += 4;
  
  // JSON chunk
  writeUint32(glb, offset, jsonChunk.length); offset += 4;
  writeUint32(glb, offset, CHUNK_TYPES.JSON); offset += 4;
  glb.set(jsonChunk, offset); offset += jsonChunk.length;
  
  // BIN chunk
  if (binLength > 0) {
    writeUint32(glb, offset, binLength); offset += 4;
    writeUint32(glb, offset, CHUNK_TYPES.BIN); offset += 4;
    glb.set(binChunk, offset);
  }
  
  return glb;
}

/**
 * Build glTF JSON structure.
 */
function buildGLTF(meshes, materials, textures) {
  const gltf = {
    asset: {
      version: '2.0',
      generator: 'SketchRip',
    },
    scene: 0,
    scenes: [{
      name: 'Sketchfab Model',
      nodes: meshes.map((_, i) => i),
    }],
    nodes: [],
    meshes: [],
    materials: [],
    textures: [],
    samplers: [],
    bufferViews: [],
    buffers: [{
      uri: 'data:application/octet-stream;base64,' + '', // Will be set
      byteLength: 0,
    }],
  };
  
  let bufferData = new Uint8Array(0);
  
  // Build textures
  for (const tex of textures) {
    if (tex.imageData) {
      gltf.textures.push({
        source: gltf.textures.length,
        sampler: 0,
      });
      gltf.samplers.push({
        magFilter: tex.magFilter || 9728, // NEAREST/MIP_NEAREST default
        minFilter: tex.minFilter || 9987, // LINEAR/MIP_LINEAR default
        wrapS: tex.wrapS || 33071, // REPEAT
        wrapT: tex.wrapT || 33071,
      });
      
      // Add image from imageData (base64 PNG)
      gltf.images = gltf.images || [];
      gltf.images.push({
        mimeType: 'image/png',
        uri: tex.imageData,
      });
    }
  }
  
  // Build materials
  for (const mat of materials) {
    const matEntry = {
      name: mat.name,
      pbrMetallicRoughness: {
        baseColorFactor: [
          mat.color?.r ?? 1,
          mat.color?.g ?? 1,
          mat.color?.b ?? 1,
          mat.opacity ?? 1,
        ],
        metallicFactor: mat.metalness ?? 0,
        roughnessFactor: mat.roughness ?? 1,
      },
      emissiveFactor: [
        mat.emissive?.r ?? 0,
        mat.emissive?.g ?? 0,
        mat.emissive?.b ?? 0,
      ],
      alphaMode: mat.transparent ? 'BLEND' : 'OPAQUE',
      doubleSided: mat.side === 2, // THREE.DoubleSide
    };
    
    // Map textures to material
    if (mat.maps) {
      const texMap = {};
      if (mat.maps.map) texMap['baseColorTexture'] = mat.maps.map;
      if (mat.maps.normalMap) texMap['normalTexture'] = mat.maps.normalMap;
      if (mat.maps.roughnessMap) texMap['metallicRoughnessTexture'] = mat.maps.roughnessMap;
      if (mat.maps.metalnessMap) texMap['metallicRoughnessTexture'] = mat.maps.metalnessMap;
      if (mat.maps.emissiveMap) texMap['emissiveTexture'] = mat.maps.emissiveMap;
      if (mat.maps.alphaMap) texMap['alphaMode'] = mat.maps.alphaMap;
      if (mat.maps.aoMap) texMap['occlusionTexture'] = mat.maps.aoMap;
      
      // Need to map uuids to texture indices
      for (const [key, texUuid] of Object.entries(texMap)) {
        const texIdx = textures.findIndex(t => t.uuid === texUuid);
        if (texIdx >= 0) {
          if (key === 'normalTexture') {
            matEntry.normalTexture = { index: texIdx, scale: mat.normalScale?.x ?? 1 };
          } else if (key === 'occlusionTexture') {
            matEntry.occlusionTexture = { index: texIdx };
          } else if (key === 'metallicRoughnessTexture') {
            // roughness is channel G, metalness is channel B
            matEntry.metallicRoughnessTexture = { index: texIdx };
          } else {
            matEntry[key + ''] = { index: texIdx };
          }
        }
      }
    }
    
    gltf.materials.push(matEntry);
  }
  
  // Build meshes and buffer views
  for (const mesh of meshes) {
    const meshEntry = {
      name: mesh.name,
      primitives: [{
        attributes: {},
      }],
    };
    
    const prim = meshEntry.primitives[0];
    const bufferOffset = bufferData.length;
    
    // Position buffer
    if (mesh.data?.position) {
      const pos = base64ToBytes(mesh.data.position);
      const bufferViewIdx = gltf.bufferViews.length;
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: bufferOffset,
        byteLength: pos.length,
        target: 34962, // ARRAY_BUFFER
      });
      
      prim.attributes.POSITION = gltf.bufferViews.length - 1;
      
      bufferData = concatBuffers(bufferData, pos);
      bufferOffset += pos.length;
    }
    
    // Normal buffer
    if (mesh.data?.normal) {
      const norm = base64ToBytes(mesh.data.normal);
      const bufferViewIdx = gltf.bufferViews.length;
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: bufferOffset,
        byteLength: norm.length,
        target: 34962,
      });
      
      prim.attributes.NORMAL = bufferViewIdx;
      
      bufferData = concatBuffers(bufferData, norm);
      bufferOffset += norm.length;
    }
    
    // UV buffer
    if (mesh.data?.uv) {
      const uv = base64ToBytes(mesh.data.uv);
      const bufferViewIdx = gltf.bufferViews.length;
      gltf.bufferViews.push({
        buffer: 0,
        byteOffset: bufferOffset,
        byteLength: uv.length,
        target: 34962,
      });
      
      prim.attributes.UV_0 = bufferViewIdx;
      
      bufferData = concatBuffers(bufferData, uv);
      bufferOffset += uv.length;
    }
    
    // Index buffer
    if (mesh.index) {
      prim.indices = prim.attributes.INDEX || gltf.bufferViews.length;
      
      // Create index buffer view
      if (mesh.data?.index) {
        const idx = base64ToBytes(mesh.data.index);
        const bufferViewIdx = gltf.bufferViews.length;
        gltf.bufferViews.push({
          buffer: 0,
          byteOffset: bufferOffset,
          byteLength: idx.length,
          target: 34963, // ELEMENT_ARRAY_BUFFER
        });
        
        prim.attributes.INDEX = bufferViewIdx;
        
        bufferData = concatBuffers(bufferData, idx);
        bufferOffset += idx.length;
      }
    }
    
    // Material binding
    if (mesh.materials?.length) {
      const matIdx = materials.findIndex(m => m.uuid === mesh.materials[0]);
      if (matIdx >= 0) prim.material = matIdx;
    }
    
    prim.material = prim.material ?? 0;
    
    gltf.meshes.push(meshEntry);
    gltf.nodes.push({
      name: mesh.name,
      mesh: gltf.meshes.length - 1,
      translation: [mesh.position?.x ?? 0, mesh.position?.y ?? 0, mesh.position?.z ?? 0],
      rotation: [
        mesh.rotation?.x ?? 0,
        mesh.rotation?.y ?? 0,
        mesh.rotation?.z ?? 0,
      ],
      scale: [
        mesh.scale?.x ?? 1,
        mesh.scale?.y ?? 1,
        mesh.scale?.z ?? 1,
      ],
    });
  }
  
  // Set buffer data
  gltf.buffers[0].uri = 'data:application/octet-stream;base64,' + btoa(
    String.fromCharCode(...bufferData)
  );
  gltf.buffers[0].byteLength = bufferData.length;
  
  return gltf;
}

/**
 * Export mesh data to OBJ format.
 */
function exportOBJ(meshes, materials) {
  let objContent = '# SketchRip - OBJ Export\n';
  let mtlContent = '# SketchRip - MTL Export\n';
  
  let vertexOffset = 0;
  let uvOffset = 0;
  let normalOffset = 0;
  
  for (const mesh of meshes) {
    objContent += `o ${mesh.name}\n`;
    
    // Add vertices
    if (mesh.data?.position) {
      const pos = base64ToFloat32(mesh.data.position);
      for (let i = 0; i < pos.length; i += 3) {
        objContent += `v ${pos[i].toFixed(6)} ${pos[i+1].toFixed(6)} ${pos[i+2].toFixed(6)}\n`;
      }
      vertexOffset += pos.length / 3;
    }
    
    // Add normals
    if (mesh.data?.normal) {
      const norm = base64ToFloat32(mesh.data.normal);
      for (let i = 0; i < norm.length; i += 3) {
        objContent += `vn ${norm[i].toFixed(6)} ${norm[i+1].toFixed(6)} ${norm[i+2].toFixed(6)}\n`;
      }
      normalOffset += norm.length / 3;
    }
    
    // Add UVs
    if (mesh.data?.uv) {
      const uv = base64ToFloat32(mesh.data.uv);
      for (let i = 0; i < uv.length; i += 2) {
        objContent += `vt ${uv[i].toFixed(6)} ${uv[i+1].toFixed(6)}\n`;
      }
      uvOffset += uv.length / 2;
    }
    
    // Add faces
    if (mesh.index) {
      const idx = base64ToUint16(mesh.data.index);
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] + 1 + vertexOffset;
        const b = idx[i+1] + 1 + vertexOffset;
        const c = idx[i+2] + 1 + vertexOffset;
        
        const an = (i + 1) * 3 + normalOffset;
        const au = (i) * 2 + uvOffset;
        
        objContent += `f ${a}//${an} ${b}//${an+3} ${c}//${an+6}\n`;
      }
    } else {
      const vertCount = vertexOffset;
      for (let i = 0; i < vertCount; i += 3) {
        const a = i + 1;
        const b = i + 2;
        const c = i + 3;
        const n = i * 3;
        objContent += `f ${a}//${n} ${b}//${n+3} ${c}//${n+6}\n`;
      }
    }
    
    objContent += '\n';
  }
  
  // Add materials to MTL
  mtlContent += 'newmtl default\n';
  mtlContent += 'Ka 0.00 0.00 0.00\n';
  mtlContent += 'Kd 0.80 0.80 0.80\n';
  mtlContent += 'Ks 0.00 0.00 0.00\n';
  mtlContent += 'Ns 0.00\n';
  mtlContent += 'Ni 1.00\n';
  mtlContent += 'd 1.00\n';
  mtlContent += 'illum 2\n';
  
  return { obj: objContent, mtl: mtlContent };
}

/**
 * Export to glTF JSON (non-binary).
 */
function exportGLTF(meshes, materials, textures) {
  const gltf = buildGLTF(meshes, materials, textures);
  return JSON.stringify(gltf, null, 2);
}

/**
 * Download GLB data as a file.
 */
function downloadGLB(glbData, filename = 'model.glb') {
  const blob = new Blob([glbData], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// Binary Helpers
// ============================================================

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true); // little-endian
}

function concatBuffers(a, b) {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

function serializeJSONChunk(jsonStr) {
  const padding = (4 - (jsonStr.length % 4)) % 4;
  const padded = jsonStr + ' '.repeat(padding);
  const bytes = new TextEncoder().encode(padded);
  return bytes;
}

function serializeBINChunk(bufferData) {
  const padding = (4 - (bufferData.length % 4)) % 4;
  if (padding === 0) return bufferData;
  
  const result = new Uint8Array(bufferData.length + padding);
  result.set(bufferData);
  result.fill(0, bufferData.length);
  return result;
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64ToFloat32(base64) {
  const bytes = base64ToBytes(base64);
  const view = new DataView(bytes.buffer);
  const floats = new Float32Array(bytes.length / 4);
  for (let i = 0; i < floats.length; i++) {
    floats[i] = view.getFloat32(i * 4, true);
  }
  return floats;
}

function base64ToUint16(base64) {
  const bytes = base64ToBytes(base64);
  const view = new DataView(bytes.buffer);
  const shorts = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < shorts.length; i++) {
    shorts[i] = view.getUint16(i * 2, true);
  }
  return shorts;
}
