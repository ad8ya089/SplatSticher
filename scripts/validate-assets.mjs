import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { detectOrientation } from '../src/core/orientationDetector.js';
import {
  computeBoundsFromVertices,
  computeYStats,
  detectDoorsFromVertices,
  extractWorldVertices,
} from '../src/core/doorDetector.js';
import { DEMO_ROOMS } from '../src/core/demoRooms.js';
import { computeWorldTransforms } from '../src/core/roomAligner.js';

const gunzip = promisify(zlib.gunzip);
const loader = new GLTFLoader();

function signed24LE(bytes, offset) {
  let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (value & 0x800000) value |= 0xff000000;
  return value;
}

async function parseSpzSample(path, maxPoints = 250000) {
  const compressed = await fs.readFile(path);
  const raw = await gunzip(compressed);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const magic = raw.subarray(0, 4).toString('ascii');
  const version = view.getUint32(4, true);
  const numPoints = view.getUint32(8, true);
  const shDegree = view.getUint8(12);
  const fractionalBits = view.getUint8(13);
  const flags = view.getUint8(14);
  const sampleCount = Math.min(numPoints, maxPoints);
  const step = Math.max(1, Math.floor(numPoints / sampleCount));
  const positions = new Float32Array(sampleCount * 3);
  const scale = 1 / (1 << fractionalBits);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const pointIndex = Math.min(numPoints - 1, sample * step);
    const sourceBase = 16 + pointIndex * 9;
    const dest = sample * 3;
    positions[dest] = signed24LE(bytes, sourceBase) * scale;
    positions[dest + 1] = signed24LE(bytes, sourceBase + 3) * scale;
    positions[dest + 2] = signed24LE(bytes, sourceBase + 6) * scale;
  }

  return {
    positions,
    numPoints,
    sampledPoints: sampleCount,
    meta: { magic, version, shDegree, fractionalBits, flags, compressedBytes: compressed.length, decompressedBytes: raw.length },
  };
}

async function loadGltf(path) {
  const buf = await fs.readFile(path);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rows = [];

for (const room of DEMO_ROOMS) {
  const spzPath = `public${room.realSplatUrl || room.splatUrl}`;
  const glbPath = `public${room.colliderUrl}`;
  const parsed = await parseSpzSample(spzPath);
  const orientation = detectOrientation(parsed.positions, 'spz');
  const gltf = await loadGltf(glbPath);
  const vertices = extractWorldVertices(gltf.scene, { maxVertices: 260000 });
  const bounds = computeBoundsFromVertices(vertices);
  const yStats = computeYStats(vertices);
  const doors = detectDoorsFromVertices(vertices, bounds, { floorY: yStats.p05 });

  assert(parsed.meta.magic === 'NGSP', `${room.id}: missing NGSP header`);
  assert(parsed.numPoints === room.demoMeta.numPoints, `${room.id}: point count mismatch`);
  assert(parsed.meta.fractionalBits === room.demoMeta.fractionalBits, `${room.id}: fractional bits mismatch`);
  assert(Number.isFinite(orientation.yLift), `${room.id}: orientation yLift is not finite`);
  assert(vertices.length > 0, `${room.id}: collider has no vertices`);

  rows.push({
    room: room.id,
    points: parsed.numPoints,
    frac: parsed.meta.fractionalBits,
    spzFloor: orientation.floorY.toFixed(3),
    spzLift: orientation.yLift.toFixed(3),
    glbP05: yStats.p05.toFixed(3),
    glbLift: (-yStats.p05).toFixed(3),
    doors: doors.length,
    bounds: bounds.size.map((v) => v.toFixed(2)).join(' x '),
  });
}

const transforms = computeWorldTransforms(
  DEMO_ROOMS.map((room) => ({
    ...room,
    splatYLift: room.demoMeta.splatYLift,
    colliderYLift: room.demoMeta.colliderYLift,
  })),
  0.04,
);

assert(Math.abs(transforms[1].position[0] - 9.64) < 0.001, 'hogwarts transform X should use demo worldX');
assert(Math.abs(transforms[2].position[0] - 27.587) < 0.001, 'apartment transform X should use demo worldX');

console.table(rows);
console.table(
  transforms.map((t) => ({
    room: t.id,
    splatPos: t.position.map((v) => v.toFixed(3)).join(', '),
    colliderPos: t.colliderPosition.map((v) => v.toFixed(3)).join(', '),
    floorMismatchM: t.floorMismatchM.toFixed(3),
    flipX: t.visualFlipX,
  })),
);
console.log('Validation complete.');
