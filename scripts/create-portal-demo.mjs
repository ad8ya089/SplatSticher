import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { DEMO_ROOMS } from '../src/core/demoRooms.js';
import { isPointInsidePortalCut, summarizePortalCuts } from '../src/core/portalCutter.js';

const gunzip = promisify(zlib.gunzip);

const jobs = [
  {
    roomId: 'enchanted_castle',
    input: 'public/demo/enchanted_castle_like_room_world.spz',
    output: 'public/demo/portal_enchanted_castle.ply',
    count: 30000,
  },
  {
    roomId: 'hogwarts_bedroom',
    input: 'public/demo/Hogwarts_Castle_Magical_Bedroom.spz',
    output: 'public/demo/portal_hogwarts_bedroom.ply',
    count: 32000,
  },
  {
    roomId: 'cramped_apartment',
    input: 'public/demo/Cramped_Urban_Apartment_Night.spz',
    output: 'public/demo/portal_cramped_apartment.ply',
    count: 28000,
  },
  {
    roomId: 'cozy_bedroom',
    input: 'public/demo/cozy_dimly_lit_bedroom.spz',
    output: 'public/demo/portal_cozy_bedroom.ply',
    count: 28000,
  },
];

function signed24LE(bytes, offset) {
  let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (value & 0x800000) value |= 0xff000000;
  return value;
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

async function createPortalPly({ roomId, input, output, count }) {
  const room = DEMO_ROOMS.find((item) => item.id === roomId);
  if (!room) throw new Error(`Unknown demo room ${roomId}`);

  const compressed = await fs.readFile(input);
  const raw = await gunzip(compressed);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const numPoints = view.getUint32(8, true);
  const fractionalBits = view.getUint8(13);
  const alphaOffset = 16 + numPoints * 9;
  const colorOffset = alphaOffset + numPoints;
  const step = Math.max(1, Math.floor(numPoints / count));
  const stride = 11 * 4 + 3;
  const body = Buffer.alloc(count * stride);
  let accepted = 0;
  let portalSkipped = 0;
  let visited = 0;

  for (let pointIndex = 0; pointIndex < numPoints && accepted < count; pointIndex += step) {
    const [x, y, z] = readPoint(bytes, pointIndex, fractionalBits);
    visited += 1;
    if (isPointInsidePortalCut(room, [x, y, z])) {
      portalSkipped += 1;
      continue;
    }

    const dest = accepted * stride;
    const alpha = bytes[alphaOffset + pointIndex] ?? 210;
    const r = bytes[colorOffset + pointIndex * 3] ?? 210;
    const g = bytes[colorOffset + pointIndex * 3 + 1] ?? 190;
    const b = bytes[colorOffset + pointIndex * 3 + 2] ?? 150;

    body.writeFloatLE(x, dest);
    body.writeFloatLE(y, dest + 4);
    body.writeFloatLE(z, dest + 8);
    body.writeFloatLE(-3.85, dest + 12);
    body.writeFloatLE(-3.85, dest + 16);
    body.writeFloatLE(-3.85, dest + 20);
    body.writeFloatLE(0, dest + 24);
    body.writeFloatLE(0, dest + 28);
    body.writeFloatLE(0, dest + 32);
    body.writeFloatLE(1, dest + 36);
    body.writeFloatLE(Math.max(0.2, Math.min(5, alpha / 45)), dest + 40);
    body.writeUInt8(r, dest + 44);
    body.writeUInt8(g, dest + 45);
    body.writeUInt8(b, dest + 46);
    accepted += 1;
  }

  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${accepted}`,
    'property float x',
    'property float y',
    'property float z',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'property float opacity',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header\n',
  ].join('\n');

  await fs.writeFile(output, Buffer.concat([Buffer.from(header), body.subarray(0, accepted * stride)]));
  console.log(
    `${output}: ${accepted.toLocaleString()} portal-cut splats, skipped ${portalSkipped.toLocaleString()} sampled portal points from ${visited.toLocaleString()} visits`,
  );
  console.log(JSON.stringify({ room: roomId, cuts: summarizePortalCuts(room) }));
}

for (const job of jobs) {
  await createPortalPly(job);
}
