import { DEMO_ROOMS } from '../src/core/demoRooms.js';
import { stitchRoomsByDoor } from '../src/core/roomAligner.js';
import { isPointInsidePortalCut } from '../src/core/portalCutter.js';
import { parsePLY } from '../src/core/splatParser.js';
import fs from 'node:fs/promises';

const GAP_M = 1.25;
const EPSILON = 0.025;
const SAMPLE_SPACING_M = 0.35;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function* permutations(items, length, prefix = []) {
  if (prefix.length === length) {
    yield prefix;
    return;
  }
  for (const item of items) {
    if (prefix.includes(item)) continue;
    yield* permutations(items, length, [...prefix, item]);
  }
}

function pointInRoomFootprint(room, x, z) {
  const footprint = room.footprint;
  if (!footprint) return false;
  const localX = x - (room.worldX ?? 0);
  const localZ = z - (room.worldZ ?? 0);
  return (
    localX >= footprint.xMin - EPSILON &&
    localX <= footprint.xMax + EPSILON &&
    localZ >= footprint.zMin - EPSILON &&
    localZ <= footprint.zMax + EPSILON
  );
}

function pointInConnector(link, x, z) {
  const ax = link.a[0];
  const az = link.a[2];
  const bx = link.b[0];
  const bz = link.b[2];
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq < 0.0001) return false;

  const t = ((x - ax) * dx + (z - az) * dz) / lengthSq;
  if (t < -EPSILON || t > 1 + EPSILON) return false;
  const closestX = ax + Math.max(0, Math.min(1, t)) * dx;
  const closestZ = az + Math.max(0, Math.min(1, t)) * dz;
  return Math.hypot(x - closestX, z - closestZ) <= (link.width || 1) / 2 + EPSILON;
}

function hasFloorAt(rooms, links, x, z) {
  return rooms.some((room) => pointInRoomFootprint(room, x, z)) || links.some((link) => pointInConnector(link, x, z));
}

function validateRoute(rooms, links) {
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const waypoints = [];
  for (const [index, link] of links.entries()) {
    const from = roomById.get(link.from);
    const to = roomById.get(link.to);
    if (index === 0 && from) waypoints.push([from.worldX ?? 0, from.worldZ ?? 0]);
    waypoints.push([link.a[0], link.a[2]]);
    waypoints.push([link.b[0], link.b[2]]);
    if (to) waypoints.push([to.worldX ?? 0, to.worldZ ?? 0]);
  }

  let samples = 0;
  for (let i = 1; i < waypoints.length; i += 1) {
    const [sx, sz] = waypoints[i - 1];
    const [ex, ez] = waypoints[i];
    const distance = Math.hypot(ex - sx, ez - sz);
    const steps = Math.max(1, Math.ceil(distance / SAMPLE_SPACING_M));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = sx + (ex - sx) * t;
      const z = sz + (ez - sz) * t;
      samples += 1;
      if (!hasFloorAt(rooms, links, x, z)) {
        return { passable: false, samples, failedAt: [x, z] };
      }
    }
  }
  return { passable: true, samples };
}

const rows = [];
let checked = 0;

for (let length = 2; length <= DEMO_ROOMS.length; length += 1) {
  for (const order of permutations(DEMO_ROOMS, length)) {
    const { rooms, links } = stitchRoomsByDoor(order, { gap: GAP_M });
    assert(links.length === length - 1, `${length}-room order did not create enough door links`);

    for (const link of links) {
      assert(Math.abs(link.distanceM - GAP_M) < 0.001, `${link.id}: connector distance is not ${GAP_M}m`);
      assert(Math.abs(link.a[2] - link.b[2]) < 0.001, `${link.id}: doorway Z coordinates are misaligned`);
      assert(link.width >= 1.15, `${link.id}: connector is too narrow`);
    }

    const route = validateRoute(rooms, links);
    assert(route.passable, `${rooms.map((room) => room.id).join(' -> ')} failed at ${route.failedAt?.join(', ')}`);

    checked += 1;
    if (length === DEMO_ROOMS.length) {
      rows.push({
        order: rooms.map((room) => room.label).join(' -> '),
        connectors: links.length,
        totalMeters: links.reduce((sum, link) => sum + link.distanceM, 0).toFixed(2),
        samples: route.samples,
      });
    }
  }
}

const portalRows = [];
for (const room of DEMO_ROOMS) {
  assert(room.portalSplatUrl, `${room.id}: missing portalSplatUrl`);
  const buffer = await fs.readFile(`public${room.portalSplatUrl}`);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const parsed = await parsePLY(arrayBuffer, { maxPoints: 1000000 });
  let pointsInsideCut = 0;
  for (let i = 0; i < parsed.positions.length; i += 3) {
    if (
      isPointInsidePortalCut(room, [
        parsed.positions[i],
        parsed.positions[i + 1],
        parsed.positions[i + 2],
      ])
    ) {
      pointsInsideCut += 1;
    }
  }
  assert(pointsInsideCut === 0, `${room.id}: ${pointsInsideCut} portal preview splats remain inside cut boxes`);
  portalRows.push({
    room: room.label,
    portalPreview: room.portalSplatUrl,
    splats: parsed.numPoints,
    cutLeaks: pointsInsideCut,
  });
}

const defaultJoin = stitchRoomsByDoor(DEMO_ROOMS, { gap: GAP_M });
console.table(
  defaultJoin.rooms.map((room) => ({
    room: room.label,
    worldX: room.worldX.toFixed(3),
    worldZ: room.worldZ.toFixed(3),
    entry: room.stitchDoorWorld.entry ? `${room.stitchDoorWorld.entry.x.toFixed(3)}, ${room.stitchDoorWorld.entry.z.toFixed(3)}` : '-',
    exit: room.stitchDoorWorld.exit ? `${room.stitchDoorWorld.exit.x.toFixed(3)}, ${room.stitchDoorWorld.exit.z.toFixed(3)}` : '-',
  })),
);
console.table(rows);
console.table(portalRows);
console.log(`Door stitch validation complete: ${checked} ordered combinations passed.`);
