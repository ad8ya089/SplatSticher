import fs from 'node:fs/promises';
import { PROPERTY_PRESETS } from '../src/core/propertyPresets.js';
import { stitchRoomsByDoor } from '../src/core/roomAligner.js';
import { isPointInsidePortalCut } from '../src/core/portalCutter.js';
import { parsePLY } from '../src/core/splatParser.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function publicPath(url) {
  return `public${decodeURIComponent(url)}`;
}

async function exists(path) {
  try {
    const stat = await fs.stat(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

const rows = [];
const portalRows = [];

for (const preset of PROPERTY_PRESETS) {
  assert(await exists(publicPath(preset.plan.url)), `${preset.id}: missing floor-plan image`);
  const stitched = stitchRoomsByDoor(preset.rooms, { gap: 1.25 });
  assert(stitched.links.length === preset.rooms.length - 1, `${preset.id}: tour links did not cover every room`);
  if (preset.portalLinks?.length) {
    const portalStitched = stitchRoomsByDoor(preset.rooms, { gap: 1.25, portalLinks: preset.portalLinks });
    assert(
      portalStitched.links.length === preset.portalLinks.length,
      `${preset.id}: portal graph did not create every named door link`,
    );
    assert(
      portalStitched.report.placedRoomCount === preset.rooms.length,
      `${preset.id}: portal graph did not place every room`,
    );
    assert(
      portalStitched.report.transitionMode === 'door_portals',
      `${preset.id}: portal graph did not use door_portals mode`,
    );
    portalRows.push(
      ...portalStitched.links.map((link) => ({
        preset: preset.label,
        link: link.label,
        from: `${link.from}:${link.fromDoor}`,
        to: `${link.to}:${link.toDoor}`,
        distanceM: link.distanceM.toFixed(3),
        widthM: link.width.toFixed(2),
      })),
    );
  }

  for (const room of preset.rooms) {
    assert(await exists(publicPath(room.realSplatUrl)), `${room.id}: missing full SPZ`);
    assert(await exists(publicPath(room.colliderUrl)), `${room.id}: missing collider GLB`);
    assert(await exists(publicPath(room.liteSplatUrl)), `${room.id}: missing lite preview`);
    assert(await exists(publicPath(room.portalSplatUrl)), `${room.id}: missing portal preview`);

    const buffer = await fs.readFile(publicPath(room.portalSplatUrl));
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const parsed = await parsePLY(arrayBuffer, { maxPoints: 1000000 });
    let cutLeaks = 0;
    for (let i = 0; i < parsed.positions.length; i += 3) {
      if (
        isPointInsidePortalCut(room, [
          parsed.positions[i],
          parsed.positions[i + 1],
          parsed.positions[i + 2],
        ])
      ) {
        cutLeaks += 1;
      }
    }
    assert(cutLeaks === 0, `${room.id}: ${cutLeaks} portal splats remain inside doorway cut boxes`);

    rows.push({
      preset: preset.label,
      room: room.label,
      points: room.demoMeta?.numPoints || 0,
      portalSplats: parsed.numPoints,
      cutLeaks,
    });
  }
}

console.table(rows);
if (portalRows.length) console.table(portalRows);
console.log(`Property validation complete: ${rows.length} rooms checked.`);
