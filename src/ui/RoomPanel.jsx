import React from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  DoorOpen,
  Eye,
  EyeOff,
  FileUp,
  Shield,
  Trash2,
} from 'lucide-react';

function number(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '0.000';
}

export function RoomPanel({
  room,
  rooms,
  metersPerPixel,
  showColliders,
  collisionEnabled,
  status,
  onUpdateRoom,
  onRemoveRoom,
  onSplatUpload,
  onColliderUpload,
  onToggleColliders,
  onToggleCollision,
}) {
  if (!room) {
    return <div className="empty-panel">No room selected</div>;
  }

  const points = room.analysis?.numPoints || room.demoMeta?.numPoints || 0;
  const portalDoors = Object.entries(room.portalDoors || {}).map(([id, door]) => ({
    id,
    ...door,
    worldX: door.x,
    worldZ: door.z,
  }));
  const detectedDoors = room.colliderAnalysis?.doors || room.doors || [];
  const doors = portalDoors.length ? portalDoors : detectedDoors;
  const mismatch = Math.abs(Number(room.splatYLift ?? room.demoMeta?.splatYLift ?? 0) - Number(room.colliderYLift ?? room.demoMeta?.colliderYLift ?? 0));

  return (
    <div className="room-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Selected Room</p>
          <h2>{room.label}</h2>
        </div>
        <button className="danger-icon" onClick={() => onRemoveRoom(room.id)} disabled={rooms.length <= 1}>
          <Trash2 size={16} />
        </button>
      </div>

      <div className="status-line">
        {room.status === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
        <span>{room.status === 'analyzing' ? 'Analyzing' : room.status === 'error' ? room.error : room.enabled === false ? 'Ready, not included' : 'Ready for stitching'}</span>
      </div>

      <div className="form-grid">
        <label>
          <span>Name</span>
          <input value={room.label || ''} onChange={(event) => onUpdateRoom(room.id, { label: event.target.value })} />
        </label>
        <label>
          <span>Category</span>
          <input value={room.category || ''} onChange={(event) => onUpdateRoom(room.id, { category: event.target.value })} />
        </label>
        <label>
          <span>Width m</span>
          <input
            type="number"
            value={room.realWidthM || 0}
            step="0.1"
            onChange={(event) => onUpdateRoom(room.id, { realWidthM: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Depth m</span>
          <input
            type="number"
            value={room.realDepthM || 0}
            step="0.1"
            onChange={(event) => onUpdateRoom(room.id, { realDepthM: Number(event.target.value) })}
          />
        </label>
      </div>

      <div className="upload-row">
        <label className="upload-button">
          <FileUp size={16} />
          <span>SPZ/PLY/GLB</span>
          <input type="file" accept=".spz,.ply,.glb,.gltf" onChange={(event) => onSplatUpload(room.id, event.target.files?.[0])} />
        </label>
        <label className="upload-button">
          <Box size={16} />
          <span>Collider</span>
          <input type="file" accept=".glb,.gltf" onChange={(event) => onColliderUpload(room.id, event.target.files?.[0])} />
        </label>
      </div>

      <div className="facts">
        <div>
          <span>Points</span>
          <strong>{points ? points.toLocaleString() : '-'}</strong>
        </div>
        <div>
          <span>Sample</span>
          <strong>{room.analysis?.sampledPoints ? room.analysis.sampledPoints.toLocaleString() : '-'}</strong>
        </div>
        <div>
          <span>SPZ lift</span>
          <strong>{number(room.splatYLift ?? room.demoMeta?.splatYLift)}m</strong>
        </div>
        <div>
          <span>GLB lift</span>
          <strong>{number(room.colliderYLift ?? room.demoMeta?.colliderYLift)}m</strong>
        </div>
      </div>

      {mismatch > 0.45 && (
        <div className="warning-line">
          <AlertTriangle size={16} />
          <span>Floor mismatch {mismatch.toFixed(2)}m</span>
        </div>
      )}

      <div className="form-grid">
        <label>
          <span>Yaw deg</span>
          <input
            type="number"
            value={room.manualYawDeg || 0}
            step="1"
            onChange={(event) => onUpdateRoom(room.id, { manualYawDeg: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Y offset</span>
          <input
            type="number"
            value={room.manualYOffset || 0}
            step="0.05"
            onChange={(event) => onUpdateRoom(room.id, { manualYOffset: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Plan X</span>
          <input
            type="number"
            value={Math.round(room.floorPlanX || 0)}
            onChange={(event) => onUpdateRoom(room.id, { floorPlanX: Number(event.target.value), worldX: undefined })}
          />
        </label>
        <label>
          <span>Plan Y</span>
          <input
            type="number"
            value={Math.round(room.floorPlanY || 0)}
            onChange={(event) => onUpdateRoom(room.id, { floorPlanY: Number(event.target.value), worldZ: undefined })}
          />
        </label>
      </div>

      <div className="toggle-list">
        <label>
          <input
            type="checkbox"
            checked={room.enabled !== false}
            onChange={(event) => onUpdateRoom(room.id, { enabled: event.target.checked })}
          />
          <span>Include in world</span>
        </label>
        {room.realSplatUrl && (
          <label>
            <input
              type="checkbox"
              checked={room.splatUrl === room.realSplatUrl}
              onChange={(event) =>
                onUpdateRoom(room.id, {
                  splatUrl: event.target.checked ? room.realSplatUrl : room.liteSplatUrl,
                  visualFormat: event.target.checked ? 'spz' : 'ply',
                })
              }
            />
            <span>Full SPZ asset</span>
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={Boolean(room.visualFlipX)}
            onChange={(event) => onUpdateRoom(room.id, { visualFlipX: event.target.checked })}
          />
          <span>Flip visual X</span>
        </label>
        <label>
          <input type="checkbox" checked={showColliders} onChange={(event) => onToggleColliders(event.target.checked)} />
          <span>{showColliders ? <Eye size={14} /> : <EyeOff size={14} />} Show colliders</span>
        </label>
        <label>
          <input type="checkbox" checked={collisionEnabled} onChange={(event) => onToggleCollision(event.target.checked)} />
          <span><Shield size={14} /> Collision</span>
        </label>
      </div>

      <div className="door-list">
        <div className="subhead">
          <DoorOpen size={16} />
          <span>Doors Found</span>
        </div>
        {doors.length ? (
          doors.map((door) => (
            <div className="door-row" key={door.id || `${door.wall}-${door.centerOffset}`}>
              <strong>{door.label || door.id || door.wall}</strong>
              <span>{number(door.width, 2)}m</span>
              <span>{number(door.worldX, 2)}, {number(door.worldZ, 2)}</span>
            </div>
          ))
        ) : (
          <p className="muted">No GLB gaps yet</p>
        )}
      </div>

      <div className="panel-footer">
        <span>Scale {metersPerPixel.toFixed(3)} m/px</span>
        <span>{status}</span>
      </div>
    </div>
  );
}
