import * as THREE from 'three';

export const DEFAULT_METERS_PER_PIXEL = 0.04;
export const PLAYER_EYE_HEIGHT = 1.65;

export function computeScale(rooms, fallback = DEFAULT_METERS_PER_PIXEL) {
  const candidates = rooms
    .map((room) => {
      const width = Number(room.realWidthM);
      const pixelWidth = Number(room.floorPlanW);
      return width > 0 && pixelWidth > 0 ? width / pixelWidth : null;
    })
    .filter((value) => typeof value === 'number' && Number.isFinite(value));

  if (!candidates.length) return fallback;
  candidates.sort((a, b) => a - b);
  return candidates[Math.floor(candidates.length / 2)];
}

export function quaternionForYawAndFlip(yawDeg = 0, flipX = false) {
  const yaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    THREE.MathUtils.degToRad(yawDeg),
  );
  if (!flipX) return yaw.toArray();
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  return yaw.multiply(flip).normalize().toArray();
}

export function getRoomPortalDoors(room) {
  return {
    ...(room.stitchDoors || {}),
    ...(room.portalDoors || {}),
  };
}

export function getRoomPortalDoor(room, doorName) {
  return room.portalDoors?.[doorName] || room.stitchDoors?.[doorName] || null;
}

export function directionForWall(wall = 'east') {
  switch (wall) {
    case 'west':
      return { x: -1, z: 0, yawDeg: 90 };
    case 'north':
      return { x: 0, z: -1, yawDeg: 0 };
    case 'south':
      return { x: 0, z: 1, yawDeg: 180 };
    case 'east':
    default:
      return { x: 1, z: 0, yawDeg: 270 };
  }
}

export function inwardDirectionForWall(wall = 'east') {
  const outward = directionForWall(wall);
  return {
    x: -outward.x,
    z: -outward.z,
    yawDeg: (outward.yawDeg + 180) % 360,
  };
}

export function computeWorldTransforms(rooms, metersPerPixel = DEFAULT_METERS_PER_PIXEL, options = {}) {
  const originX = options.originX ?? Math.min(...rooms.map((room) => room.floorPlanX ?? 0), 0);
  const originY = options.originY ?? Math.min(...rooms.map((room) => room.floorPlanY ?? 0), 0);

  return rooms.map((room, index) => {
    const yawDeg = Number(room.floorPlanRotation ?? 0) + Number(room.manualYawDeg ?? 0);
    const worldX =
      typeof room.worldX === 'number'
        ? room.worldX
        : ((room.floorPlanX ?? 0) - originX) * metersPerPixel;
    const worldZ =
      typeof room.worldZ === 'number'
        ? room.worldZ
        : ((room.floorPlanY ?? 0) - originY) * metersPerPixel;

    const splatYLift = Number(
      room.splatYLift ??
        room.analysis?.yLift ??
        room.demoMeta?.splatYLift ??
        room.colliderAnalysis?.yLift ??
        0,
    );
    const colliderYLift = Number(
      room.colliderYLift ??
        room.colliderAnalysis?.yLift ??
        room.demoMeta?.colliderYLift ??
        splatYLift,
    );
    const manualYOffset = Number(room.manualYOffset ?? 0);
    const visualFlipX = Boolean(room.visualFlipX);

    return {
      id: room.id,
      label: room.label || `Room ${index + 1}`,
      sourceRoom: room,
      splatUrl: room.splatUrl,
      splatFile: room.splatFile,
      visualFormat: room.visualFormat || room.format || 'spz',
      colliderUrl: room.colliderUrl,
      colliderFile: room.colliderFile,
      position: [worldX, splatYLift + manualYOffset, worldZ],
      colliderPosition: [worldX, colliderYLift + manualYOffset, worldZ],
      splatQuaternion: quaternionForYawAndFlip(yawDeg, visualFlipX),
      colliderQuaternion: quaternionForYawAndFlip(yawDeg, false),
      scale: room.scale || [1, 1, 1],
      colliderScale: room.colliderScale || [1, 1, 1],
      yawDeg,
      visualFlipX,
      doors: room.colliderAnalysis?.doors || room.doors || [],
      stitchDoors: room.stitchDoors || null,
      stitchDoorWorld: room.stitchDoorWorld || null,
      portalDoors: room.portalDoors || null,
      portalDoorWorld: room.portalDoorWorld || null,
      footprint: room.footprint || null,
      useFloorProxy: room.useFloorProxy === true,
      bounds: room.colliderAnalysis?.bounds || null,
      spawnPoint: [
        typeof room.spawnX === 'number' ? room.spawnX : worldX,
        PLAYER_EYE_HEIGHT,
        typeof room.spawnZ === 'number' ? room.spawnZ : worldZ,
      ],
      spawnYawDeg: typeof room.spawnYawDeg === 'number' ? room.spawnYawDeg : 180,
      floorMismatchM: Math.abs((splatYLift || 0) - (colliderYLift || 0)),
    };
  });
}

export function connectRoomCenters(transforms) {
  const links = [];
  for (let i = 1; i < transforms.length; i += 1) {
    links.push({
      id: `${transforms[i - 1].id}-${transforms[i].id}`,
      from: transforms[i - 1].id,
      to: transforms[i].id,
      a: transforms[i - 1].colliderPosition,
      b: transforms[i].colliderPosition,
    });
  }
  return links;
}

export function localDoorToWorld(room, doorName) {
  const door = getRoomPortalDoor(room, doorName);
  if (!door) return null;
  return {
    ...door,
    x: (room.worldX ?? 0) + door.x,
    y: 0,
    z: (room.worldZ ?? 0) + door.z,
  };
}

export function stitchRoomsByDoor(rooms, options = {}) {
  if (options.portalLinks?.length) {
    return stitchRoomsByPortalLinks(rooms, options);
  }

  const gap = options.gap ?? 1.25;
  const stitched = rooms.map((room) => ({
    ...room,
    useFloorProxy: true,
    manualYawDeg: 0,
    floorPlanRotation: 0,
  }));

  if (!stitched.length) return { rooms: stitched, links: [], report: { passable: false, reason: 'no_rooms' } };

  stitched[0].worldX = options.startX ?? 0;
  stitched[0].worldZ = options.startZ ?? 0;

  const links = [];
  for (let i = 1; i < stitched.length; i += 1) {
    const previous = stitched[i - 1];
    const current = stitched[i];
    const exitDoor = previous.stitchDoors?.exit;
    const entryDoor = current.stitchDoors?.entry;

    if (!exitDoor || !entryDoor) {
      current.worldX = (previous.worldX ?? 0) + (previous.realWidthM ?? 5) + gap + (current.realWidthM ?? 5);
      current.worldZ = previous.worldZ ?? 0;
      continue;
    }

    current.worldX = (previous.worldX ?? 0) + exitDoor.x + gap - entryDoor.x;
    current.worldZ = (previous.worldZ ?? 0) + exitDoor.z - entryDoor.z;

    const a = localDoorToWorld(previous, 'exit');
    const b = localDoorToWorld(current, 'entry');
    const width = Math.min(exitDoor.width || 1.2, entryDoor.width || 1.2);
    links.push({
      id: `${previous.id}-door-${current.id}`,
      type: 'door-stitch',
      from: previous.id,
      to: current.id,
      a: [a.x, 0, a.z],
      b: [b.x, 0, b.z],
      width,
      label: `${previous.label} to ${current.label}`,
      distanceM: Math.hypot(b.x - a.x, b.z - a.z),
    });
  }

  for (const room of stitched) {
    room.stitchDoorWorld = {
      entry: localDoorToWorld(room, 'entry'),
      exit: localDoorToWorld(room, 'exit'),
    };
    const footprintCenterX = room.footprint ? (room.footprint.xMin + room.footprint.xMax) / 2 : 0;
    const footprintCenterZ = room.footprint ? (room.footprint.zMin + room.footprint.zMax) / 2 : 0;
    room.spawnX = (room.worldX ?? 0) + footprintCenterX;
    room.spawnZ = (room.worldZ ?? 0) + footprintCenterZ;
    room.spawnYawDeg = -90;
  }

  const report = {
    passable: links.length === Math.max(0, stitched.length - 1),
    roomCount: stitched.length,
    connectorCount: links.length,
    totalConnectorLengthM: links.reduce((sum, link) => sum + link.distanceM, 0),
    links: links.map((link) => ({
      from: link.from,
      to: link.to,
      distanceM: Number(link.distanceM.toFixed(3)),
      width: link.width,
    })),
  };

  return { rooms: stitched, links, report };
}

function setRoomDoorWorld(room) {
  const portalDoorWorld = {};
  for (const [name] of Object.entries(getRoomPortalDoors(room))) {
    portalDoorWorld[name] = localDoorToWorld(room, name);
  }
  room.portalDoorWorld = portalDoorWorld;
  room.stitchDoorWorld = {
    ...portalDoorWorld,
    entry: localDoorToWorld(room, 'entry'),
    exit: localDoorToWorld(room, 'exit'),
  };
}

function placeRoomAtDoor({ placedRoom, targetRoom, placedDoorName, targetDoorName, gap }) {
  const placedDoor = localDoorToWorld(placedRoom, placedDoorName);
  const targetDoor = getRoomPortalDoor(targetRoom, targetDoorName);
  if (!placedDoor || !targetDoor) return false;

  const outward = directionForWall(placedDoor.wall);
  const targetDoorWorld = {
    x: placedDoor.x + outward.x * gap,
    z: placedDoor.z + outward.z * gap,
  };

  targetRoom.worldX = targetDoorWorld.x - targetDoor.x;
  targetRoom.worldZ = targetDoorWorld.z - targetDoor.z;
  setRoomDoorWorld(targetRoom);
  return true;
}

function buildPortalLink(link, fromRoom, toRoom) {
  const fromDoor = localDoorToWorld(fromRoom, link.fromDoor);
  const toDoor = localDoorToWorld(toRoom, link.toDoor);
  if (!fromDoor || !toDoor) return null;
  const width = Math.min(fromDoor.width || 1.1, toDoor.width || 1.1);
  return {
    id: link.id || `${fromRoom.id}-${link.fromDoor}-${toRoom.id}-${link.toDoor}`,
    type: 'portal-teleport',
    from: fromRoom.id,
    to: toRoom.id,
    fromDoor: link.fromDoor,
    toDoor: link.toDoor,
    fromDoorMeta: fromDoor,
    toDoorMeta: toDoor,
    a: [fromDoor.x, 0, fromDoor.z],
    b: [toDoor.x, 0, toDoor.z],
    width,
    label: link.label || `${fromRoom.label} to ${toRoom.label}`,
    distanceM: Math.hypot(toDoor.x - fromDoor.x, toDoor.z - fromDoor.z),
    triggerRadius: link.triggerRadius ?? Math.max(0.65, width * 0.55),
  };
}

export function stitchRoomsByPortalLinks(rooms, options = {}) {
  const gap = options.gap ?? 1.25;
  const portalLinks = options.portalLinks || [];
  const stitched = rooms.map((room) => ({
    ...room,
    useFloorProxy: true,
    manualYawDeg: 0,
    floorPlanRotation: 0,
  }));

  if (!stitched.length) return { rooms: stitched, links: [], report: { passable: false, reason: 'no_rooms' } };

  const roomById = new Map(stitched.map((room) => [room.id, room]));
  const rootId = options.rootId || portalLinks[0]?.from || stitched[0].id;
  const root = roomById.get(rootId) || stitched[0];
  root.worldX = options.startX ?? 0;
  root.worldZ = options.startZ ?? 0;
  setRoomDoorWorld(root);

  const placed = new Set([root.id]);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const link of portalLinks) {
      const fromRoom = roomById.get(link.from);
      const toRoom = roomById.get(link.to);
      if (!fromRoom || !toRoom) continue;

      if (placed.has(fromRoom.id) && !placed.has(toRoom.id)) {
        if (placeRoomAtDoor({
          placedRoom: fromRoom,
          targetRoom: toRoom,
          placedDoorName: link.fromDoor,
          targetDoorName: link.toDoor,
          gap: link.gap ?? gap,
        })) {
          placed.add(toRoom.id);
          progressed = true;
        }
      } else if (placed.has(toRoom.id) && !placed.has(fromRoom.id)) {
        if (placeRoomAtDoor({
          placedRoom: toRoom,
          targetRoom: fromRoom,
          placedDoorName: link.toDoor,
          targetDoorName: link.fromDoor,
          gap: link.gap ?? gap,
        })) {
          placed.add(fromRoom.id);
          progressed = true;
        }
      }
    }
  }

  let fallbackOffset = 0;
  for (const room of stitched) {
    if (!placed.has(room.id)) {
      fallbackOffset += (room.realWidthM ?? 5) + gap;
      room.worldX = (root.worldX ?? 0) + fallbackOffset;
      room.worldZ = root.worldZ ?? 0;
      setRoomDoorWorld(room);
    }
  }

  const links = portalLinks
    .map((link) => {
      const fromRoom = roomById.get(link.from);
      const toRoom = roomById.get(link.to);
      if (!fromRoom || !toRoom) return null;
      return buildPortalLink(link, fromRoom, toRoom);
    })
    .filter(Boolean);

  for (const room of stitched) {
    setRoomDoorWorld(room);
    const footprintCenterX = room.footprint ? (room.footprint.xMin + room.footprint.xMax) / 2 : 0;
    const footprintCenterZ = room.footprint ? (room.footprint.zMin + room.footprint.zMax) / 2 : 0;
    room.spawnX = (room.worldX ?? 0) + footprintCenterX;
    room.spawnZ = (room.worldZ ?? 0) + footprintCenterZ;
    room.spawnYawDeg = -90;
  }

  const report = {
    passable: links.length === portalLinks.length && placed.size === stitched.length,
    roomCount: stitched.length,
    placedRoomCount: placed.size,
    connectorCount: links.length,
    transitionMode: 'door_portals',
    links: links.map((link) => ({
      from: link.from,
      fromDoor: link.fromDoor,
      to: link.to,
      toDoor: link.toDoor,
      distanceM: Number(link.distanceM.toFixed(3)),
      width: link.width,
    })),
  };

  return { rooms: stitched, links, report };
}
