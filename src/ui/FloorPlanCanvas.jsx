import React, { useRef, useState } from 'react';
import { Move, RotateCw, Ruler } from 'lucide-react';

export function FloorPlanCanvas({
  rooms,
  selectedRoomId,
  floorPlanUrl,
  planSize,
  metersPerPixel,
  portalLinks = [],
  onSelectRoom,
  onUpdateRoom,
  setMetersPerPixel,
}) {
  const stageRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const stageWidth = planSize?.width || 1220;
  const stageHeight = planSize?.height || 520;
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const routeSegments = portalLinks.length
    ? portalLinks
        .map((link) => ({ previous: roomById.get(link.from), room: roomById.get(link.to), id: link.id }))
        .filter((segment) => segment.previous && segment.room)
    : rooms
        .filter((room) => room.enabled !== false)
        .slice(1)
        .map((room, index, routeRooms) => ({
          previous: index === 0
            ? rooms.filter((item) => item.enabled !== false)[0]
            : routeRooms[index - 1],
          room,
          id: `${index}-${room.id}`,
        }))
        .filter((segment) => segment.previous);

  function beginDrag(event, room) {
    if (event.button !== 0) return;
    const rect = stageRef.current.getBoundingClientRect();
    const scaleX = stageWidth / rect.width;
    const scaleY = stageHeight / rect.height;
    setDrag({
      id: room.id,
      offsetX: event.clientX * scaleX - rect.left * scaleX - room.floorPlanX,
      offsetY: event.clientY * scaleY - rect.top * scaleY - room.floorPlanY,
    });
    onSelectRoom(room.id);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!drag) return;
    const rect = stageRef.current.getBoundingClientRect();
    const scaleX = stageWidth / rect.width;
    const scaleY = stageHeight / rect.height;
    const x = event.clientX * scaleX - rect.left * scaleX - drag.offsetX;
    const y = event.clientY * scaleY - rect.top * scaleY - drag.offsetY;
    onUpdateRoom(drag.id, {
      floorPlanX: Math.max(40, Math.min(stageWidth - 40, x)),
      floorPlanY: Math.max(40, Math.min(stageHeight - 40, y)),
      worldX: undefined,
      worldZ: undefined,
    });
  }

  function endDrag() {
    setDrag(null);
  }

  return (
    <div className="map-panel">
      <div
        ref={stageRef}
        className={floorPlanUrl ? 'plan-stage has-plan' : 'plan-stage'}
        style={{ width: stageWidth, height: stageHeight }}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {floorPlanUrl && <img className="floor-plan-image" src={floorPlanUrl} alt="" />}
        <div className="plan-grid" />
        <svg className="tour-lines" viewBox={`0 0 ${stageWidth} ${stageHeight}`} aria-hidden="true">
          {routeSegments
            .map(({ previous, room, id }) => {
              return (
                <g key={id || `${previous.id}-${room.id}`}>
                  <line
                    x1={previous.floorPlanX}
                    y1={previous.floorPlanY}
                    x2={room.floorPlanX}
                    y2={room.floorPlanY}
                  />
                  <circle cx={room.floorPlanX} cy={room.floorPlanY} r="4" />
                </g>
              );
            })}
        </svg>
        {rooms.map((room) => {
          const selected = room.id === selectedRoomId;
          const ready = room.splatFile || room.splatUrl;
          const style = {
            width: room.floorPlanW,
            height: room.floorPlanH,
            left: room.floorPlanX - room.floorPlanW / 2,
            top: room.floorPlanY - room.floorPlanH / 2,
            transform: `rotate(${room.floorPlanRotation || 0}deg)`,
          };
          return (
            <div
              key={room.id}
              className={`room-box ${selected ? 'selected' : ''} ${ready ? 'ready' : ''} ${room.enabled === false ? 'disabled-room' : ''}`}
              style={style}
              onPointerDown={(event) => beginDrag(event, room)}
              onClick={() => onSelectRoom(room.id)}
            >
              <div className="room-box-top">
                <Move size={14} />
                <button
                  className="mini-tool"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpdateRoom(room.id, {
                      floorPlanRotation: ((room.floorPlanRotation || 0) + 90) % 360,
                    });
                  }}
                >
                  <RotateCw size={13} />
                </button>
              </div>
              <strong>{room.label}</strong>
              <span>{room.category || 'Room'}</span>
              <small>
                {Number(room.realWidthM || 0).toFixed(1)}m x {Number(room.realDepthM || 0).toFixed(1)}m
              </small>
            </div>
          );
        })}

        <div className="scale-widget">
          <Ruler size={14} />
          <label>
            <span>m/px</span>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={metersPerPixel.toFixed(3)}
              onChange={(event) => setMetersPerPixel(Number(event.target.value) || metersPerPixel)}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
