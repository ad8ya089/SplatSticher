import {
  LUXURY_PENTHOUSE_PORTAL_LINKS,
  LUXURY_PENTHOUSE_ROOMS,
} from '../src/core/propertyPresets.js';
import {
  inwardDirectionForWall,
  stitchRoomsByDoor,
} from '../src/core/roomAligner.js';
//debug
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function insideFootprint(room, x, z, margin = 0.05) {
  const footprint = room.footprint;
  if (!footprint) return true;
  const localX = x - (room.worldX ?? 0);
  const localZ = z - (room.worldZ ?? 0);
  return (
    localX >= footprint.xMin - margin &&
    localX <= footprint.xMax + margin &&
    localZ >= footprint.zMin - margin &&
    localZ <= footprint.zMax + margin
  );
}

const stitched = stitchRoomsByDoor(LUXURY_PENTHOUSE_ROOMS, {
  gap: 1.25,
  metersPerPixel: 0.018,
  portalLinks: LUXURY_PENTHOUSE_PORTAL_LINKS,
  preserveMapPlacement: true,
});

assert(stitched.report.transitionMode === 'door_portals_map', 'expected door_portals_map transition mode');
assert(stitched.links.length === LUXURY_PENTHOUSE_PORTAL_LINKS.length, 'not every portal link was created');
assert(stitched.report.placedRoomCount === LUXURY_PENTHOUSE_ROOMS.length, 'not every room was placed by the portal graph');

const roomById = new Map(stitched.rooms.map((room) => [room.id, room]));
const rows = [];

for (const link of stitched.links) {
  const fromRoom = roomById.get(link.from);
  const toRoom = roomById.get(link.to);
  assert(fromRoom, `${link.id}: missing source room`);
  assert(toRoom, `${link.id}: missing target room`);

  const fromInward = inwardDirectionForWall(link.fromDoorMeta.wall);
  const toInward = inwardDirectionForWall(link.toDoorMeta.wall);
  const sourceInside = {
    x: link.a[0] + fromInward.x * 0.55,
    z: link.a[2] + fromInward.z * 0.55,
  };
  const targetInside = {
    x: link.b[0] + toInward.x * 0.9,
    z: link.b[2] + toInward.z * 0.9,
  };

  assert(
    insideFootprint(fromRoom, sourceInside.x, sourceInside.z),
    `${link.id}: source trigger is outside ${fromRoom.label}`,
  );
  assert(
    insideFootprint(toRoom, targetInside.x, targetInside.z),
    `${link.id}: landing point is outside ${toRoom.label}`,
  );

  rows.push({
    link: link.label,
    fromDoor: `${link.from}:${link.fromDoor}`,
    toDoor: `${link.to}:${link.toDoor}`,
    source: `${sourceInside.x.toFixed(2)}, ${sourceInside.z.toFixed(2)}`,
    landing: `${targetInside.x.toFixed(2)}, ${targetInside.z.toFixed(2)}`,
    mapDistanceM: link.distanceM.toFixed(2),
    yaw: toInward.yawDeg,
  });
}

console.table(rows);
console.log(`Portal validation complete: ${stitched.links.length} bidirectional door links ready.`);
