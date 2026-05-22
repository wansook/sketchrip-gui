/**
 * SketchRip - Material Extraction Utilities
 * 
 * Handles extraction and reconstruction of Three.js material types.
 */

/**
 * Extract material from Three.js material object.
 * @param {*} material - Three.js material
 * @returns {Object} Extracted material data
 */
function extractMaterialFromThree(material) {
  if (!material) return null;
  
  const result = {
    uuid: material.uuid,
    name: material.name || `mat_${material.uuid.substring(0, 8)}`,
    type: material.type,
  };
  
  // Color
  if (material.color) {
    result.color = {
      r: material.color.r,
      g: material.color.g,
      b: material.color.b,
    };
  }
  
  // Emissive
  if (material.emissive) {
    result.emissive = {
      r: material.emissive.r,
      g: material.emissive.g,
      b: material.emissive.b,
    };
    result.emissiveIntensity = material.emissiveIntensity ?? 1;
  }
  
  // PBR properties
  if (material.roughness !== undefined) result.roughness = material.roughness;
  if (material.metalness !== undefined) result.metalness = material.metalness;
  if (material.envMapIntensity !== undefined) result.envMapIntensity = material.envMapIntensity;
  
  // Transparency
  if (material.transparent !== undefined) result.transparent = material.transparent;
  if (material.opacity !== undefined) result.opacity = material.opacity;
  
  // Side
  if (material.side !== undefined) result.side = material.side;
  
  // Wireframe
  if (material.wireframe !== undefined) result.wireframe = material.wireframe;
  
  // Maps (texture references)
  result.maps = {};
  const mapKeys = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'displacementMap', 'lightMap'];
  for (const key of mapKeys) {
    if (material[key]) {
      result.maps[key] = {
        uuid: material[key].uuid,
        name: material[key].name,
        width: material[key].image?.width,
        height: material[key].image?.height,
      };
    }
  }
  
  // Normal map scale
  if (material.normalScale) {
    result.normalScale = {
      x: material.normalScale.x,
      y: material.normalScale.y,
    };
  }
  
  // UV transform
  if (material.map?.matrix) {
    result.uvTransform = material.map.matrix.elements;
  }
  
  return result;
}

/**
 * Extract all materials from a Three.js scene.
 */
function extractAllMaterials(scene) {
  const materials = new Map(); // uuid -> material
  
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
  
  return Array.from(materials.values()).map(extractMaterialFromThree);
}

/**
 * Reconstruct a Three.js material from extracted data.
 * Returns a Three.js material that can be used for rendering.
 */
function reconstructMaterial(matData, textureMap) {
  const Three = window.THREE;
  if (!Three) return null;
  
  let material;
  
  switch (matData.type) {
    case 'MeshStandardMaterial':
      material = new Three.MeshStandardMaterial();
      break;
    case 'MeshPhongMaterial':
      material = new Three.MeshPhongMaterial();
      break;
    case 'MeshLambertMaterial':
      material = new Three.MeshLambertMaterial();
      break;
    case 'MeshBasicMaterial':
      material = new Three.MeshBasicMaterial();
      break;
    case 'MeshPhysicalMaterial':
      material = new Three.MeshPhysicalMaterial();
      break;
    case 'MeshToonMaterial':
      material = new Three.MeshToonMaterial();
      break;
    default:
      material = new Three.MeshStandardMaterial();
  }
  
  // Apply properties
  if (matData.color) {
    material.color.setRGB(matData.color.r, matData.color.g, matData.color.b);
  }
  if (matData.emissive) {
    material.emissive.setRGB(matData.emissive.r, matData.emissive.g, matData.emissive.b);
  }
  if (matData.emissiveIntensity !== undefined) material.emissiveIntensity = matData.emissiveIntensity;
  if (matData.roughness !== undefined) material.roughness = matData.roughness;
  if (matData.metalness !== undefined) material.metalness = matData.metalness;
  if (matData.envMapIntensity !== undefined) material.envMapIntensity = matData.envMapIntensity;
  if (matData.transparent !== undefined) material.transparent = matData.transparent;
  if (matData.opacity !== undefined) material.opacity = matData.opacity;
  if (matData.side !== undefined) material.side = matData.side;
  if (matData.wireframe !== undefined) material.wireframe = matData.wireframe;
  
  // Apply textures
  if (matData.maps) {
    for (const [key, texRef] of Object.entries(matData.maps)) {
      const tex = textureMap.get(texRef.uuid);
      if (tex) {
        material[key] = tex;
      }
    }
  }
  
  if (matData.normalScale) {
    material.normalScale.set(matData.normalScale.x, matData.normalScale.y);
  }
  
  return material;
}

/**
 * Get the Three.js material class name from a material.
 */
function getMaterialClassName(mat) {
  if (!mat || !mat.constructor) return 'Unknown';
  return mat.constructor.name;
}
