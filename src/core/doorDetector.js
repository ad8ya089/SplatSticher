import * as THREE from 'three';

export function extractWorldVertices(root, options = {}) {
  const maxVertices = options.maxVertices ?? 350000;
  const stride = Math.max(1, options.stride ?? 1);
  const collected = [];
  const vertex = new THREE.Vector3();

  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    const attr = child.geometry.attributes.position;
    const localStride = Math.max(stride, Math.ceil(attr.count / maxVertices));
    for (let i = 0; i < attr.count; i += localStride) {
      vertex.fromBufferAttribute(attr, i).applyMatrix4(child.matrixWorld);
      collected.push(vertex.x, vertex.y, vertex.z);
      if (collected.length / 3 >= maxVertices) return;
    }
  });

  return new Float32Array(collected);
}

export function computeBoundsFromVertices(vertices) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 3) {
    min[0] = Math.min(min[0], vertices[i]);
    min[1] = Math.min(min[1], vertices[i + 1]);
    min[2] = Math.min(min[2], vertices[i + 2]);
    max[0] = Math.max(max[0], vertices[i]);
    max[1] = Math.max(max[1], vertices[i + 1]);
    max[2] = Math.max(max[2], vertices[i + 2]);
  }
  return {
    min,
    max,
    xMin: min[0],
    yMin: min[1],
    zMin: min[2],
    xMax: max[0],
    yMax: max[1],
    zMax: max[2],
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))];
}

export function computeYStats(vertices) {
  const count = vertices.length / 3;
  const values = new Float32Array(count);
  for (let i = 0; i < count; i += 1) values[i] = vertices[i * 3 + 1];
  values.sort();
  return {
    min: percentile(values, 0),
    p01: percentile(values, 0.01),
    p05: percentile(values, 0.05),
    p10: percentile(values, 0.1),
    p20: percentile(values, 0.2),
    p30: percentile(values, 0.3),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    max: percentile(values, 0.999999),
  };
}

function mergeNearbyDoors(doors) {
  const sorted = [...doors].sort((a, b) => a.wall.localeCompare(b.wall) || a.centerOffset - b.centerOffset);
  const merged = [];

  for (const door of sorted) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.wall === door.wall &&
      Math.abs(prev.centerOffset - door.centerOffset) < 0.45
    ) {
      prev.width = Math.max(prev.width, door.width);
      prev.confidence = Math.max(prev.confidence, door.confidence);
      prev.worldX = (prev.worldX + door.worldX) / 2;
      prev.worldZ = (prev.worldZ + door.worldZ) / 2;
    } else {
      merged.push({ ...door });
    }
  }

  return merged;
}

export function detectDoorsFromVertices(vertices, inputBounds, options = {}) {
  if (!vertices?.length) return [];

  const bounds = inputBounds?.xMin !== undefined ? inputBounds : computeBoundsFromVertices(vertices);
  const wallMargin = options.wallMargin ?? Math.max(0.25, Math.min(bounds.size?.[0] ?? 1, bounds.size?.[2] ?? 1) * 0.06);
  const minDoorWidth = options.minDoorWidth ?? 0.55;
  const maxDoorWidth = options.maxDoorWidth ?? 2.85;
  const gapThreshold = options.gapThreshold ?? 0.18;
  const bins = options.bins ?? 36;
  const allowEdgeGaps = options.allowEdgeGaps ?? true;
  const yStats = computeYStats(vertices);
  const floorY = options.floorY ?? yStats.p05;
  const wallMinY = floorY + (options.wallBaseOffset ?? 0.35);
  const wallMaxY = floorY + (options.wallHeight ?? 2.4);

  const walls = {
    north: [],
    south: [],
    west: [],
    east: [],
  };

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    if (y < wallMinY || y > wallMaxY) continue;
    if (z < bounds.zMin + wallMargin) walls.north.push(x);
    if (z > bounds.zMax - wallMargin) walls.south.push(x);
    if (x < bounds.xMin + wallMargin) walls.west.push(z);
    if (x > bounds.xMax - wallMargin) walls.east.push(z);
  }

  const doors = [];
  const pushGaps = (values, dimMin, dimMax, wall, isXWall) => {
    if (values.length < bins) return;
    const dimSize = dimMax - dimMin;
    if (dimSize <= 0) return;
    const binWidth = dimSize / bins;
    const hist = new Array(bins).fill(0);
    for (const value of values) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((value - dimMin) / binWidth)));
      hist[idx] += 1;
    }

    const maxDensity = Math.max(...hist);
    const threshold = maxDensity * gapThreshold;
    let gapStart = null;

    for (let i = 0; i <= bins; i += 1) {
      const dense = i < bins && hist[i] > threshold;
      if (!dense && gapStart === null) {
        gapStart = i;
      } else if ((dense || i === bins) && gapStart !== null) {
        const gapEnd = i;
        const width = (gapEnd - gapStart) * binWidth;
        const touchesEdge = gapStart === 0 || gapEnd === bins;
        if (width >= minDoorWidth && width <= maxDoorWidth && (!touchesEdge || allowEdgeGaps)) {
          const center = dimMin + ((gapStart + gapEnd) / 2) * binWidth;
          const wallPos = isXWall
            ? wall === 'west'
              ? bounds.xMin
              : bounds.xMax
            : wall === 'north'
              ? bounds.zMin
              : bounds.zMax;
          doors.push({
            id: `${wall}-${doors.length}`,
            wall,
            centerOffset: center,
            width,
            worldX: isXWall ? wallPos : center,
            worldZ: isXWall ? center : wallPos,
            facingYaw: isXWall ? (wall === 'west' ? 90 : 270) : wall === 'north' ? 180 : 0,
            edgeGap: touchesEdge,
            confidence: Math.max(0.15, 1 - width / Math.max(dimSize, 0.001)) + (touchesEdge ? 0.05 : 0),
          });
        }
        gapStart = null;
      }
    }
  };

  pushGaps(walls.north, bounds.xMin, bounds.xMax, 'north', false);
  pushGaps(walls.south, bounds.xMin, bounds.xMax, 'south', false);
  pushGaps(walls.west, bounds.zMin, bounds.zMax, 'west', true);
  pushGaps(walls.east, bounds.zMin, bounds.zMax, 'east', true);

  const maxPerWall = options.maxPerWall ?? 2;
  const perWall = new Map();
  for (const door of mergeNearbyDoors(doors).sort((a, b) => b.confidence - a.confidence)) {
    const current = perWall.get(door.wall) || [];
    if (current.length < maxPerWall) {
      current.push(door);
      perWall.set(door.wall, current);
    }
  }

  return [...perWall.values()]
    .flat()
    .sort((a, b) => a.wall.localeCompare(b.wall) || a.centerOffset - b.centerOffset)
    .slice(0, options.maxDoors ?? 8);
}
