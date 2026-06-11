const SPZ_MAGIC_TEXT = 'NGSP';
const DEFAULT_SPZ_SAMPLE_LIMIT = 250000;
const DEFAULT_PLY_SAMPLE_LIMIT = 100000;

function extensionOf(name = '') {
  const clean = name.split('?')[0].split('#')[0];
  const index = clean.lastIndexOf('.');
  return index >= 0 ? clean.slice(index + 1).toLowerCase() : '';
}

function readAscii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function signed24LE(bytes, offset) {
  let value = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (value & 0x800000) value |= 0xff000000;
  return value;
}

function halfToFloat(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

async function gunzip(arrayBuffer) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not expose DecompressionStream for SPZ gzip data.');
  }
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function parseSPZ(arrayBuffer, options = {}) {
  const maxPoints = options.maxPoints ?? DEFAULT_SPZ_SAMPLE_LIMIT;
  const decompressed = await gunzip(arrayBuffer);
  const bytes = new Uint8Array(decompressed);
  const view = new DataView(decompressed);

  if (bytes.byteLength < 16 || readAscii(bytes, 0, 4) !== SPZ_MAGIC_TEXT) {
    throw new Error('Invalid SPZ file: missing NGSP header.');
  }

  const version = view.getUint32(4, true);
  const numPoints = view.getUint32(8, true);
  const shDegree = view.getUint8(12);
  const fractionalBits = view.getUint8(13);
  const flags = view.getUint8(14);
  const reserved = view.getUint8(15);

  if (version < 1 || version > 2) {
    throw new Error(`Unsupported SPZ version ${version}.`);
  }

  const usesFloat16 = version === 1;
  const bytesPerPointPosition = usesFloat16 ? 6 : 9;
  const positionByteLength = numPoints * bytesPerPointPosition;
  const expectedMinSize = 16 + positionByteLength + numPoints + numPoints * 3 + numPoints * 3 + numPoints * 3;
  if (bytes.byteLength < expectedMinSize) {
    throw new Error('SPZ payload is shorter than the advertised point count.');
  }

  const sampleCount = Math.min(numPoints, maxPoints);
  const step = Math.max(1, Math.floor(numPoints / sampleCount));
  const positions = new Float32Array(sampleCount * 3);
  const scale = 1 / (1 << fractionalBits);
  const positionOffset = 16;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const pointIndex = Math.min(numPoints - 1, sampleIndex * step);
    const sourceBase = positionOffset + pointIndex * bytesPerPointPosition;
    const destBase = sampleIndex * 3;

    if (usesFloat16) {
      positions[destBase] = halfToFloat(view.getUint16(sourceBase, true));
      positions[destBase + 1] = halfToFloat(view.getUint16(sourceBase + 2, true));
      positions[destBase + 2] = halfToFloat(view.getUint16(sourceBase + 4, true));
    } else {
      positions[destBase] = signed24LE(bytes, sourceBase) * scale;
      positions[destBase + 1] = signed24LE(bytes, sourceBase + 3) * scale;
      positions[destBase + 2] = signed24LE(bytes, sourceBase + 6) * scale;
    }
  }

  return {
    positions,
    numPoints,
    sampledPoints: sampleCount,
    format: 'spz',
    meta: {
      magic: SPZ_MAGIC_TEXT,
      version,
      shDegree,
      fractionalBits,
      flags,
      reserved,
      antialiased: (flags & 1) !== 0,
      positionEncoding: usesFloat16 ? 'float16' : 'signed24_fixed_point',
      decompressedBytes: bytes.byteLength,
    },
  };
}

function findHeaderEnd(bytes) {
  const marker = new TextEncoder().encode('end_header');
  outer:
  for (let i = 0; i <= bytes.length - marker.length; i += 1) {
    for (let j = 0; j < marker.length; j += 1) {
      if (bytes[i + j] !== marker[j]) continue outer;
    }
    let end = i + marker.length;
    while (end < bytes.length && (bytes[end] === 10 || bytes[end] === 13)) end += 1;
    return end;
  }
  return -1;
}

const PLY_TYPE_READERS = {
  char: { size: 1, read: (view, offset) => view.getInt8(offset) },
  int8: { size: 1, read: (view, offset) => view.getInt8(offset) },
  uchar: { size: 1, read: (view, offset) => view.getUint8(offset) },
  uint8: { size: 1, read: (view, offset) => view.getUint8(offset) },
  short: { size: 2, read: (view, offset) => view.getInt16(offset, true) },
  int16: { size: 2, read: (view, offset) => view.getInt16(offset, true) },
  ushort: { size: 2, read: (view, offset) => view.getUint16(offset, true) },
  uint16: { size: 2, read: (view, offset) => view.getUint16(offset, true) },
  int: { size: 4, read: (view, offset) => view.getInt32(offset, true) },
  int32: { size: 4, read: (view, offset) => view.getInt32(offset, true) },
  uint: { size: 4, read: (view, offset) => view.getUint32(offset, true) },
  uint32: { size: 4, read: (view, offset) => view.getUint32(offset, true) },
  float: { size: 4, read: (view, offset) => view.getFloat32(offset, true) },
  float32: { size: 4, read: (view, offset) => view.getFloat32(offset, true) },
  double: { size: 8, read: (view, offset) => view.getFloat64(offset, true) },
  float64: { size: 8, read: (view, offset) => view.getFloat64(offset, true) },
};

function parsePLYHeader(headerText) {
  const lines = headerText.split(/\r?\n/);
  if (lines[0]?.trim() !== 'ply') throw new Error('Invalid PLY file: missing ply header.');

  let format = 'ascii';
  let vertexCount = 0;
  let currentElement = null;
  const vertexProperties = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'format') format = parts[1];
    if (parts[0] === 'element') {
      currentElement = parts[1];
      if (currentElement === 'vertex') vertexCount = Number(parts[2]);
    } else if (parts[0] === 'property' && currentElement === 'vertex') {
      if (parts[1] === 'list') continue;
      vertexProperties.push({ type: parts[1], name: parts[2] });
    }
  }

  return { format, vertexCount, vertexProperties };
}

export async function parsePLY(arrayBuffer, options = {}) {
  const maxPoints = options.maxPoints ?? DEFAULT_PLY_SAMPLE_LIMIT;
  const bytes = new Uint8Array(arrayBuffer);
  const headerEnd = findHeaderEnd(bytes);
  if (headerEnd < 0) throw new Error('Invalid PLY file: end_header not found.');

  const headerText = new TextDecoder().decode(bytes.slice(0, headerEnd));
  const { format, vertexCount, vertexProperties } = parsePLYHeader(headerText);
  const sampleCount = Math.min(vertexCount, maxPoints);
  const step = Math.max(1, Math.floor(vertexCount / sampleCount));
  const positions = new Float32Array(sampleCount * 3);
  const propertyNames = vertexProperties.map((p) => p.name);
  const xIndex = propertyNames.indexOf('x');
  const yIndex = propertyNames.indexOf('y');
  const zIndex = propertyNames.indexOf('z');
  if (xIndex < 0 || yIndex < 0 || zIndex < 0) {
    throw new Error('PLY vertex properties must include x, y, and z.');
  }

  if (format === 'ascii') {
    const body = new TextDecoder().decode(bytes.slice(headerEnd));
    const lines = body.trim().split(/\r?\n/);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const sourceIndex = Math.min(vertexCount - 1, sampleIndex * step);
      const values = lines[sourceIndex]?.trim().split(/\s+/).map(Number);
      if (!values || values.length <= Math.max(xIndex, yIndex, zIndex)) break;
      const dest = sampleIndex * 3;
      positions[dest] = values[xIndex];
      positions[dest + 1] = values[yIndex];
      positions[dest + 2] = values[zIndex];
    }
  } else if (format === 'binary_little_endian') {
    const layout = [];
    let stride = 0;
    for (const prop of vertexProperties) {
      const reader = PLY_TYPE_READERS[prop.type];
      if (!reader) throw new Error(`Unsupported PLY property type ${prop.type}.`);
      layout.push({ ...prop, offset: stride, reader });
      stride += reader.size;
    }
    const view = new DataView(arrayBuffer);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const sourceIndex = Math.min(vertexCount - 1, sampleIndex * step);
      const base = headerEnd + sourceIndex * stride;
      const dest = sampleIndex * 3;
      positions[dest] = layout[xIndex].reader.read(view, base + layout[xIndex].offset);
      positions[dest + 1] = layout[yIndex].reader.read(view, base + layout[yIndex].offset);
      positions[dest + 2] = layout[zIndex].reader.read(view, base + layout[zIndex].offset);
    }
  } else {
    throw new Error(`Unsupported PLY format ${format}.`);
  }

  return {
    positions,
    numPoints: vertexCount,
    sampledPoints: sampleCount,
    format: 'ply',
    meta: {
      format,
      vertexProperties,
    },
  };
}

export async function parseSplatFile(file, options = {}) {
  const ext = extensionOf(file?.name || file?.url || '');
  if (ext === 'glb' || ext === 'gltf') {
    return {
      positions: new Float32Array(0),
      numPoints: 0,
      sampledPoints: 0,
      format: 'glb',
      meta: { note: 'GLB rooms render as mesh scenes and use collider analysis.' },
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer.slice(0, 8));
  if (ext === 'spz' || readAscii(bytes, 0, 2) === '\u001f\u008b') {
    return parseSPZ(arrayBuffer, options);
  }
  if (ext === 'ply' || readAscii(bytes, 0, 3) === 'ply') {
    return parsePLY(arrayBuffer, options);
  }
  throw new Error(`Unsupported splat format .${ext || 'unknown'}. Upload SPZ, PLY, or GLB.`);
}

export function getSplatFormatFromName(name = '') {
  const ext = extensionOf(name);
  if (['spz', 'ply', 'glb', 'gltf', 'splat', 'ksplat'].includes(ext)) return ext;
  return 'unknown';
}
