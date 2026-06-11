export const DEFAULT_PORTAL_CUT = {
  planeMarginM: 0.72,
  sideMarginM: 0.28,
  heightM: 2.35,
  floorClearanceM: 0.08,
};

function getFloorY(room) {
  return Number(room.analysis?.floorY ?? room.demoMeta?.splatFloorY ?? 0);
}

export function getPortalCutBoxes(room, options = {}) {
  const config = {
    ...DEFAULT_PORTAL_CUT,
    ...(room.portalCut || {}),
    ...options,
  };
  const floorY = getFloorY(room);
  const yMin = floorY + config.floorClearanceM;
  const yMax = floorY + config.heightM;
  const boxes = [];

  for (const [name, door] of Object.entries(room.stitchDoors || {})) {
    if (!door) continue;
    const halfWidth = (door.width || 1.1) / 2 + config.sideMarginM;
    const wall = door.wall || 'east';
    const base = {
      name,
      wall,
      yMin,
      yMax,
      door,
    };

    if (wall === 'east' || wall === 'west') {
      boxes.push({
        ...base,
        xMin: door.x - config.planeMarginM,
        xMax: door.x + config.planeMarginM,
        zMin: door.z - halfWidth,
        zMax: door.z + halfWidth,
      });
    } else {
      boxes.push({
        ...base,
        xMin: door.x - halfWidth,
        xMax: door.x + halfWidth,
        zMin: door.z - config.planeMarginM,
        zMax: door.z + config.planeMarginM,
      });
    }
  }

  return boxes;
}

export function isPointInsidePortalCut(room, point, options = {}) {
  const [x, y, z] = Array.isArray(point) ? point : [point.x, point.y, point.z];
  return getPortalCutBoxes(room, options).some(
    (box) =>
      x >= box.xMin &&
      x <= box.xMax &&
      y >= box.yMin &&
      y <= box.yMax &&
      z >= box.zMin &&
      z <= box.zMax,
  );
}

export function summarizePortalCuts(room) {
  return getPortalCutBoxes(room).map((box) => ({
    name: box.name,
    wall: box.wall,
    x: [Number(box.xMin.toFixed(3)), Number(box.xMax.toFixed(3))],
    y: [Number(box.yMin.toFixed(3)), Number(box.yMax.toFixed(3))],
    z: [Number(box.zMin.toFixed(3)), Number(box.zMax.toFixed(3))],
  }));
}
