import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);

const jobs = [
  {
    input: 'public/demo/enchanted_castle_like_room_world.spz',
    output: 'public/demo/lite_enchanted_castle.ply',
    count: 24000,
  },
  {
    input: 'public/demo/Hogwarts_Castle_Magical_Bedroom.spz',
    output: 'public/demo/lite_hogwarts_bedroom.ply',
    count: 26000,
  },
  {
    input: 'public/demo/Cramped_Urban_Apartment_Night.spz',
    output: 'public/demo/lite_cramped_apartment.ply',
    count: 22000,
  },
  {
    input: 'public/demo/cozy_dimly_lit_bedroom.spz',
    output: 'public/demo/lite_cozy_bedroom.ply',
    count: 22000,
  },
];

function signed24LE(bytes, offset) {
  let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (value & 0x800000) value |= 0xff000000;
  return value;
}

async function createLitePly({ input, output, count }) {
  const compressed = await fs.readFile(input);
  const raw = await gunzip(compressed);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const numPoints = view.getUint32(8, true);
  const fractionalBits = view.getUint8(13);
  const scale = 1 / (1 << fractionalBits);
  const sampleCount = Math.min(count, numPoints);
  const step = Math.max(1, Math.floor(numPoints / sampleCount));
  const alphaOffset = 16 + numPoints * 9;
  const colorOffset = alphaOffset + numPoints;

  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${sampleCount}`,
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

  const stride = 11 * 4 + 3;
  const body = Buffer.alloc(sampleCount * stride);

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const pointIndex = Math.min(numPoints - 1, sample * step);
    const posBase = 16 + pointIndex * 9;
    const dest = sample * stride;
    const x = signed24LE(bytes, posBase) * scale;
    const y = signed24LE(bytes, posBase + 3) * scale;
    const z = signed24LE(bytes, posBase + 6) * scale;
    const alpha = bytes[alphaOffset + pointIndex] ?? 210;
    const r = bytes[colorOffset + pointIndex * 3] ?? 210;
    const g = bytes[colorOffset + pointIndex * 3 + 1] ?? 190;
    const b = bytes[colorOffset + pointIndex * 3 + 2] ?? 150;

    body.writeFloatLE(x, dest);
    body.writeFloatLE(y, dest + 4);
    body.writeFloatLE(z, dest + 8);
    body.writeFloatLE(-3.8, dest + 12);
    body.writeFloatLE(-3.8, dest + 16);
    body.writeFloatLE(-3.8, dest + 20);
    body.writeFloatLE(0, dest + 24);
    body.writeFloatLE(0, dest + 28);
    body.writeFloatLE(0, dest + 32);
    body.writeFloatLE(1, dest + 36);
    body.writeFloatLE(Math.max(0.2, Math.min(5, alpha / 45)), dest + 40);
    body.writeUInt8(r, dest + 44);
    body.writeUInt8(g, dest + 45);
    body.writeUInt8(b, dest + 46);
  }

  await fs.writeFile(output, Buffer.concat([Buffer.from(header), body]));
  console.log(`${output}: ${sampleCount.toLocaleString()} lite splats`);
}

for (const job of jobs) {
  await createLitePly(job);
}
