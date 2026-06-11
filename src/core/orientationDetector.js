function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor(sortedValues.length * ratio)));
  return sortedValues[index];
}

export function axisStats(positions, axis = 1) {
  const count = Math.floor(positions.length / 3);
  const values = new Float32Array(count);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  for (let i = 0; i < count; i += 1) {
    const value = positions[i * 3 + axis];
    values[i] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }

  values.sort();
  return {
    min,
    max,
    mean: count ? sum / count : 0,
    p01: percentile(values, 0.01),
    p05: percentile(values, 0.05),
    p10: percentile(values, 0.1),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  };
}

export function boundsFromPositions(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max, size: max.map((value, index) => value - min[index]) };
}

export function detectOrientation(positions, format, options = {}) {
  if (!positions?.length) {
    return {
      floorY: 0,
      ceilY: 0,
      yLift: 0,
      flippedYLift: 0,
      roomHeightM: 0,
      isDataInverted: false,
      recommendedFlipX: false,
      confidence: 0,
      notes: ['No point sample was available.'],
    };
  }

  const y = axisStats(positions, 1);
  const bounds = boundsFromPositions(positions);
  const roomHeightM = y.p95 - y.p05;
  const midY = (y.p05 + y.p95) / 2;
  const normalizedMedian = roomHeightM > 0 ? (y.p50 - midY) / (roomHeightM / 2) : 0;
  const isDataInverted = normalizedMedian < -0.35 && y.p95 < Math.abs(y.p05);

  const manualFlip = options.flipX;
  const recommendedFlipX =
    typeof manualFlip === 'boolean'
      ? manualFlip
      : Boolean(options.assumeRendererFlip && format === 'spz' && !isDataInverted);

  return {
    bounds,
    yStats: y,
    floorY: y.p05,
    ceilY: y.p95,
    yLift: -y.p05,
    flippedYLift: y.p95,
    roomHeightM,
    isDataInverted,
    recommendedFlipX,
    confidence: Math.min(1, Math.abs(normalizedMedian)),
    correctionEuler: recommendedFlipX ? [Math.PI, 0, 0] : [0, 0, 0],
    correctionQuaternion: recommendedFlipX ? [1, 0, 0, 0] : [0, 0, 0, 1],
    notes: [
      format === 'spz'
        ? 'SPZ is analyzed from corrected v2 fixed-point samples; visual flip remains user-adjustable.'
        : 'Orientation uses sampled vertex Y percentiles.',
    ],
  };
}

export function getYLiftFromGLBStats(glbStats, percentileName = 'p05') {
  const floorY = glbStats?.yStats?.[percentileName] ?? glbStats?.bounds?.min?.[1] ?? 0;
  return -floorY;
}
