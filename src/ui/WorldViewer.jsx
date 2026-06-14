import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, DoorOpen, MousePointer2, RotateCcw } from 'lucide-react';
import { WorldRenderer } from '../renderer/worldRenderer.js';

export function WorldViewer({
  worldBuild,
  showColliders,
  collisionEnabled,
  status,
  selectedRoomId,
  calibrationTarget,
  onCaptureDoor,
  onStatus,
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const [frame, setFrame] = useState({ position: [0, 0, 0], floorY: 0, locked: false, colliders: 0 });

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const renderer = new WorldRenderer(canvasRef.current, {
      onStatus,
      onFrame: setFrame,
    });
    rendererRef.current = renderer;
    return () => {
      rendererRef.current = null;
      renderer.dispose();
    };
  }, [onStatus]);

  useEffect(() => {
    rendererRef.current?.setShowColliders(showColliders);
  }, [showColliders]);

  useEffect(() => {
    rendererRef.current?.setCollisionEnabled(collisionEnabled);
  }, [collisionEnabled]);

  useEffect(() => {
    if (!worldBuild?.nonce || !rendererRef.current) return;
    const renderer = rendererRef.current;
    void renderer.loadRooms(worldBuild.transforms, worldBuild.links).catch((error) => {
      if (rendererRef.current === renderer) {
        onStatus?.(`World load failed: ${error.message}`);
      }
    });
  }, [onStatus, worldBuild]);

  const pos = frame.position || [0, 0, 0];
  function captureDoorHere() {
    if (!calibrationTarget || !rendererRef.current) return;
    try {
      const anchor = rendererRef.current.captureDoorAnchor(calibrationTarget.roomId || selectedRoomId, calibrationTarget.doorId);
      onCaptureDoor?.({
        roomId: calibrationTarget.roomId || selectedRoomId,
        doorId: calibrationTarget.doorId,
        anchor,
      });
    } catch (error) {
      onStatus?.(`Door capture failed: ${error.message}`);
    }
  }

  return (
    <div className="world-panel">
      <canvas ref={canvasRef} className="world-canvas" />
      <div className="world-hud top-left">
        <div>
          <Crosshair size={14} />
          <span>{pos.map((value) => value.toFixed(2)).join(', ')}</span>
        </div>
        <div>
          <MousePointer2 size={14} />
          <span>{frame.locked ? 'Mouse locked' : 'Click canvas'}</span>
        </div>
      </div>
      <div className="world-status">{status}</div>
      {calibrationTarget && (
        <div className="world-calibration">
          <div>
            <DoorOpen size={14} />
            <span>{calibrationTarget.label || calibrationTarget.doorId}</span>
          </div>
          <button onClick={captureDoorHere}>
            <Crosshair size={14} />
            <span>Capture Here</span>
          </button>
        </div>
      )}
      <button className="floating-reset" onClick={() => rendererRef.current?.resetPlayer()}>
        <RotateCcw size={16} />
        <span>Reset</span>
      </button>
      {!worldBuild?.nonce && (
        <div className="world-empty">
          <h2>World Preview</h2>
          <p>Generate a stitch from the map to load the rooms here.</p>
        </div>
      )}
    </div>
  );
}
