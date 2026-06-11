import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  computeBoundsFromVertices,
  computeYStats,
  detectDoorsFromVertices,
  extractWorldVertices,
} from './doorDetector.js';

const loader = new GLTFLoader();

function sourceToUrl(source) {
  if (typeof source === 'string') return { url: source, revoke: null };
  const url = URL.createObjectURL(source);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

export async function loadGLTFSource(source) {
  const { url, revoke } = sourceToUrl(source);
  try {
    return await loader.loadAsync(url);
  } finally {
    revoke?.();
  }
}

export async function analyzeGLBCollider(source, options = {}) {
  const gltf = await loadGLTFSource(source);
  const vertices = extractWorldVertices(gltf.scene, options);
  const bounds = computeBoundsFromVertices(vertices);
  const yStats = computeYStats(vertices);
  const floorPercentile = options.floorPercentile ?? 'p05';
  const floorY = yStats[floorPercentile] ?? yStats.p05 ?? bounds.min[1];
  const doors = detectDoorsFromVertices(vertices, bounds, { floorY, ...options.doorOptions });

  return {
    vertexCount: vertices.length / 3,
    bounds,
    yStats,
    floorY,
    yLift: -floorY,
    doors,
  };
}
