import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, MousePointer2, RotateCcw } from 'lucide-react';
import { WorldRenderer } from '../renderer/worldRenderer.js';

export function WorldViewer({ worldBuild, showColliders, collisionEnabled, status, onStatus }) {
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
