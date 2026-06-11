import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { PROPERTY_PRESETS } from '../src/core/propertyPresets.js';
import { isPointInsidePortalCut, summarizePortalCuts } from '../src/core/portalCutter.js';

const gunzip = promisify(zlib.gunzip);
const DEFAULT_LITE_COUNT = 45000;
const DEFAULT_PORTAL_COUNT = 70000;
const FEATURE_LITE_COUNT = 70000;
const FEATURE_PORTAL_COUNT = 110000;
const COLOR_SCALE = 0.15;
const MIN_ALPHA = 5;

function signed24LE(bytes, offset) {
  let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (value & 0x800000) value |= 0xff000000;
  return value;
}

function filePathFromPublicUrl(url) {
  return `public${decodeURIComponent(url)}`;
}

function readPoint(bytes, index, fractionalBits) {
  const scale = 1 / (1 << fractionalBits);
  const base = 16 + index * 9;
  return [
    signed24LE(bytes, base) * scale,
    signed24LE(bytes, base + 3) * scale,
    signed24LE(bytes, base + 6) * scale,
  ];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function logit(value) {
  const p = clamp(value, 0.01, 0.99);
  return Math.log(p / (1 - p));
}

function sectionOffsets(numPoints) {
  const alphaOffset = 16 + numPoints * 9;
  const colorOffset = alphaOffset + numPoints;
  const scaleOffset = colorOffset + numPoints * 3;
  const rotationOffset = scaleOffset + numPoints * 3;
  return { alphaOffset, colorOffset, scaleOffset, rotationOffset };
}

function writeVertex(body, accepted, point, bytes, pointIndex, numPoints) {
  const [x, y, z] = point;
  const { alphaOffset, colorOffset, scaleOffset, rotationOffset } = sectionOffsets(numPoints);
  const stride = 14 * 4;
  const dest = accepted * stride;
  const alpha = bytes[alphaOffset + pointIndex] ?? 210;
  const r = bytes[colorOffset + pointIndex * 3] ?? 210;
  const g = bytes[colorOffset + pointIndex * 3 + 1] ?? 190;
  const b = bytes[colorOffset + pointIndex * 3 + 2] ?? 150;
  const scale0 = (bytes[scaleOffset + pointIndex * 3] ?? 98) / 16 - 10;
  const scale1 = (bytes[scaleOffset + pointIndex * 3 + 1] ?? 98) / 16 - 10;
  const scale2 = (bytes[scaleOffset + pointIndex * 3 + 2] ?? 98) / 16 - 10;
  const rotX = ((bytes[rotationOffset + pointIndex * 3] ?? 128) / 127.5) - 1;
  const rotY = ((bytes[rotationOffset + pointIndex * 3 + 1] ?? 128) / 127.5) - 1;
  const rotZ = ((bytes[rotationOffset + pointIndex * 3 + 2] ?? 128) / 127.5) - 1;
  const rotW = Math.sqrt(Math.max(0, 1 - rotX * rotX - rotY * rotY - rotZ * rotZ));

  body.writeFloatLE(x, dest);
  body.writeFloatLE(y, dest + 4);
  body.writeFloatLE(z, dest + 8);
  body.writeFloatLE((r / 255 - 0.5) / COLOR_SCALE, dest + 12);
  body.writeFloatLE((g / 255 - 0.5) / COLOR_SCALE, dest + 16);
  body.writeFloatLE((b / 255 - 0.5) / COLOR_SCALE, dest + 20);
  body.writeFloatLE(logit(alpha / 255), dest + 24);
  body.writeFloatLE(scale0, dest + 28);
  body.writeFloatLE(scale1, dest + 32);
  body.writeFloatLE(scale2, dest + 36);
  body.writeFloatLE(rotW, dest + 40);
  body.writeFloatLE(rotX, dest + 44);
  body.writeFloatLE(rotY, dest + 48);
  body.writeFloatLE(rotZ, dest + 52);
}

async function writePly(output, body, vertexCount) {
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${vertexCount}`,
    'property float x',
    'property float y',
    'property float z',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'property float opacity',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'end_header\n',
  ].join('\n');

  await fs.writeFile(output, Buffer.concat([Buffer.from(header), body]));
}

async function readSpz(room) {
  const compressed = await fs.readFile(filePathFromPublicUrl(room.realSplatUrl));
  const raw = await gunzip(compressed);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return {
    bytes,
    numPoints: view.getUint32(8, true),
    fractionalBits: view.getUint8(13),
  };
}

async function createPreview(room, mode) {
  const isPortal = mode === 'portal';
  const output = filePathFromPublicUrl(isPortal ? room.portalSplatUrl : room.liteSplatUrl);
  const targetCount = room.id === 'penthouse_living_dining'
    ? isPortal ? FEATURE_PORTAL_COUNT : FEATURE_LITE_COUNT
    : isPortal ? DEFAULT_PORTAL_COUNT : DEFAULT_LITE_COUNT;
  const { bytes, numPoints, fractionalBits } = await readSpz(room);
  const { alphaOffset } = sectionOffsets(numPoints);
  const step = Math.max(1, Math.floor(numPoints / targetCount));
  const stride = 14 * 4;
  const body = Buffer.alloc(targetCount * stride);
  let accepted = 0;
  let skipped = 0;
  let lowAlphaSkipped = 0;
  let visited = 0;

  for (let pointIndex = 0; pointIndex < numPoints && accepted < targetCount; pointIndex += step) {
    const point = readPoint(bytes, pointIndex, fractionalBits);
    visited += 1;
    if ((bytes[alphaOffset + pointIndex] ?? 0) < MIN_ALPHA) {
      lowAlphaSkipped += 1;
      continue;
    }
    if (isPortal && isPointInsidePortalCut(room, point)) {
      skipped += 1;
      continue;
    }
    writeVertex(body, accepted, point, bytes, pointIndex, numPoints);
    accepted += 1;
  }

  await writePly(output, body.subarray(0, accepted * stride), accepted);
  console.log(
    `${output}: ${accepted.toLocaleString()} ${isPortal ? 'portal-cut' : 'lite'} splats` +
      (isPortal
        ? `, skipped ${skipped.toLocaleString()} sampled portal points and ${lowAlphaSkipped.toLocaleString()} low-alpha points from ${visited.toLocaleString()} visits`
        : `, skipped ${lowAlphaSkipped.toLocaleString()} low-alpha points from ${visited.toLocaleString()} visits`),
  );
  if (isPortal) {
    console.log(JSON.stringify({ room: room.id, cuts: summarizePortalCuts(room) }));
  }
}

for (const preset of PROPERTY_PRESETS) {
  for (const room of preset.rooms) {
    await createPreview(room, 'lite');
    await createPreview(room, 'portal');
  }
}
