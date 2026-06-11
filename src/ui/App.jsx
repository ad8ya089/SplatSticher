import React, { useMemo, useState } from 'react';
import {
  Box,
  Building2,
  CheckCircle2,
  FileUp,
  Gauge,
  Layers,
  Map,
  Play,
  Plus,
  Route,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { DEMO_ROOMS, makeEmptyRoom } from '../core/demoRooms.js';
import { analyzeGLBCollider } from '../core/glbAnalyzer.js';
import { detectOrientation } from '../core/orientationDetector.js';
import {
  LUXURY_PENTHOUSE_PLAN,
  LUXURY_PENTHOUSE_PORTAL_LINKS,
  LUXURY_PENTHOUSE_ROOMS,
} from '../core/propertyPresets.js';
import {
  computeWorldTransforms,
  connectRoomCenters,
  DEFAULT_METERS_PER_PIXEL,
  stitchRoomsByDoor,
} from '../core/roomAligner.js';
import { parseSplatFile } from '../core/splatParser.js';
import { FloorPlanCanvas } from './FloorPlanCanvas.jsx';
import { RoomPanel } from './RoomPanel.jsx';
import { WorldViewer } from './WorldViewer.jsx';

function cloneDemoRooms() {
  return DEMO_ROOMS.map((room, index) => ({
    ...room,
    enabled: index < 2,
    splatYLift: room.demoMeta.splatYLift,
    colliderYLift: room.demoMeta.colliderYLift,
    analysis: {
      numPoints: room.demoMeta.numPoints,
      sampledPoints: Math.min(room.demoMeta.numPoints, 250000),
      floorY: room.demoMeta.splatFloorY,
      ceilY: room.demoMeta.splatCeilY,
      yLift: room.demoMeta.splatYLift,
      roomHeightM: room.demoMeta.splatCeilY - room.demoMeta.splatFloorY,
      meta: {
        fractionalBits: room.demoMeta.fractionalBits,
      },
    },
    status: 'ready',
  }));
}

function clonePresetRooms(sourceRooms) {
  return sourceRooms.map((room) => ({
    ...room,
    enabled: true,
    splatYLift: room.demoMeta?.splatYLift ?? 0,
    colliderYLift: room.demoMeta?.colliderYLift ?? room.demoMeta?.splatYLift ?? 0,
    analysis: room.demoMeta
      ? {
          numPoints: room.demoMeta.numPoints,
          sampledPoints: Math.min(room.demoMeta.numPoints, 250000),
          floorY: room.demoMeta.splatFloorY,
          ceilY: room.demoMeta.splatCeilY,
          yLift: room.demoMeta.splatYLift,
          roomHeightM: room.demoMeta.splatCeilY - room.demoMeta.splatFloorY,
          meta: {
            fractionalBits: room.demoMeta.fractionalBits,
          },
        }
      : room.analysis,
    status: 'ready',
  }));
}

export function App() {
  const [rooms, setRooms] = useState(() => cloneDemoRooms());
  const [selectedRoomId, setSelectedRoomId] = useState(DEMO_ROOMS[0].id);
  const [floorPlanUrl, setFloorPlanUrl] = useState(null);
  const [floorPlanMeta, setFloorPlanMeta] = useState(null);
  const [metersPerPixel, setMetersPerPixel] = useState(DEFAULT_METERS_PER_PIXEL);
  const [activeView, setActiveView] = useState('map');
  const [showColliders, setShowColliders] = useState(false);
  const [collisionEnabled, setCollisionEnabled] = useState(true);
  const [status, setStatus] = useState('Demo rooms loaded');
  const [worldBuild, setWorldBuild] = useState({ nonce: 0, transforms: [], links: [] });
  const [portalLinks, setPortalLinks] = useState([]);

  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) || rooms[0];
  const readyCount = rooms.filter((room) => room.splatUrl || room.splatFile).length;
  const includedCount = rooms.filter((room) => room.enabled !== false).length;
  const totalPoints = rooms.reduce((sum, room) => sum + Number(room.analysis?.numPoints || room.demoMeta?.numPoints || 0), 0);
  const computedScale = useMemo(() => Number(metersPerPixel) || DEFAULT_METERS_PER_PIXEL, [metersPerPixel]);

  function updateRoom(roomId, patch) {
    setRooms((current) => current.map((room) => (room.id === roomId ? { ...room, ...patch } : room)));
  }

  function addRoom() {
    const room = makeEmptyRoom(rooms.length);
    setRooms((current) => [...current, room]);
    setSelectedRoomId(room.id);
  }

  function removeRoom(roomId) {
    setRooms((current) => current.filter((room) => room.id !== roomId));
    if (selectedRoomId === roomId) {
      const next = rooms.find((room) => room.id !== roomId);
      if (next) setSelectedRoomId(next.id);
    }
  }

  function loadDemo() {
    const demo = cloneDemoRooms();
    setRooms(demo);
    setSelectedRoomId(demo[0].id);
    setFloorPlanUrl(null);
    setFloorPlanMeta(null);
    setMetersPerPixel(DEFAULT_METERS_PER_PIXEL);
    setPortalLinks([]);
    setStatus('Demo rooms restored');
    void hydrateDemoColliders(demo);
  }

  function loadLuxuryPenthouse() {
    const presetRooms = clonePresetRooms(LUXURY_PENTHOUSE_ROOMS);
    setRooms(presetRooms);
    setSelectedRoomId(presetRooms[0].id);
    setFloorPlanUrl(LUXURY_PENTHOUSE_PLAN.url);
    setFloorPlanMeta({ width: LUXURY_PENTHOUSE_PLAN.width, height: LUXURY_PENTHOUSE_PLAN.height });
    setMetersPerPixel(LUXURY_PENTHOUSE_PLAN.metersPerPixel);
    setPortalLinks(LUXURY_PENTHOUSE_PORTAL_LINKS);
    setActiveView('map');
    setStatus('Luxury penthouse plan loaded');
    void hydrateDemoColliders(presetRooms);
  }

  async function hydrateDemoColliders(demoRooms = rooms) {
    setStatus('Analyzing demo colliders...');
    const results = await Promise.allSettled(
      demoRooms.map(async (room) => ({
        id: room.id,
        analysis: await analyzeGLBCollider(room.colliderUrl, { maxVertices: 220000 }),
      })),
    );

    setRooms((current) =>
      current.map((room) => {
        const hit = results.find((result) => result.status === 'fulfilled' && result.value.id === room.id);
        if (!hit || hit.status !== 'fulfilled') return room;
        return {
          ...room,
          colliderAnalysis: hit.value.analysis,
          colliderYLift: hit.value.analysis.yLift,
        };
      }),
    );
    setStatus('Collider analysis complete');
  }

  async function handleSplatUpload(roomId, file) {
    if (!file) return;
    updateRoom(roomId, { status: 'analyzing', splatFile: file, splatUrl: null });
    try {
      const parsed = await parseSplatFile(file, { maxPoints: 250000 });
      const orientation = parsed.positions.length ? detectOrientation(parsed.positions, parsed.format) : null;
      updateRoom(roomId, {
        status: 'ready',
        format: parsed.format,
        visualFormat: parsed.format,
        analysis: orientation
          ? {
              ...orientation,
              numPoints: parsed.numPoints,
              sampledPoints: parsed.sampledPoints,
              meta: parsed.meta,
            }
          : {
              numPoints: parsed.numPoints,
              sampledPoints: parsed.sampledPoints,
              meta: parsed.meta,
            },
        splatYLift: orientation?.yLift ?? 0,
      });
      setStatus(`${file.name} analyzed`);
    } catch (error) {
      updateRoom(roomId, { status: 'error', error: error.message });
      setStatus(error.message);
    }
  }

  async function handleColliderUpload(roomId, file) {
    if (!file) return;
    updateRoom(roomId, { colliderStatus: 'analyzing', colliderFile: file, colliderUrl: null });
    try {
      const colliderAnalysis = await analyzeGLBCollider(file, { maxVertices: 250000 });
      updateRoom(roomId, {
        colliderStatus: 'ready',
        colliderAnalysis,
        colliderYLift: colliderAnalysis.yLift,
      });
      setStatus(`${file.name} collider analyzed`);
    } catch (error) {
      updateRoom(roomId, { colliderStatus: 'error', colliderError: error.message });
      setStatus(error.message);
    }
  }

  function autoSpreadRooms() {
    setRooms((current) =>
      current.map((room, index) => ({
        ...room,
        floorPlanX: 180 + index * 245,
        floorPlanY: 245 + (index % 2) * 20,
        worldX: index === 0 ? 0 : undefined,
        worldZ: 0,
      })),
    );
  }

  function buildWorldFromRooms(sourceRooms, nextStatus, options = {}) {
    const buildRooms = sourceRooms.filter((room) => room.enabled !== false && (room.splatUrl || room.splatFile));
    const transforms = computeWorldTransforms(buildRooms.length ? buildRooms : sourceRooms, computedScale);
    setWorldBuild({
      nonce: Date.now(),
      transforms,
      links: options.links || connectRoomCenters(transforms),
      report: options.report || null,
    });
    setActiveView('world');
    setStatus(nextStatus);
  }

  function generateWorld() {
    const normalRooms = rooms.map((room) => ({
      ...room,
      useFloorProxy: false,
    }));
    setRooms(normalRooms);
    buildWorldFromRooms(normalRooms, 'Generating continuous world...');
  }

  function generateJoinedMap() {
    const joinedRooms = rooms.map((room) => ({
      ...room,
      enabled: true,
      splatUrl: room.realSplatUrl || room.splatUrl,
      visualFormat: room.realSplatUrl ? 'spz' : room.visualFormat,
    }));
    const stitched = stitchRoomsByDoor(joinedRooms, { gap: 1.25, portalLinks });
    setRooms(stitched.rooms);
    buildWorldFromRooms(stitched.rooms, 'Loading full SPZ joined tour...', {
      links: stitched.links,
      report: stitched.report,
    });
  }

  function generateFullSelectedRoom() {
    const targetRoom = rooms.find((room) => room.id === selectedRoomId) || selectedRoom;
    if (!targetRoom) return;
    const fullRooms = rooms.map((room) => ({
      ...room,
      enabled: room.id === targetRoom.id,
      splatUrl: room.id === targetRoom.id && room.realSplatUrl ? room.realSplatUrl : room.splatUrl,
      visualFormat: room.id === targetRoom.id && room.realSplatUrl ? 'spz' : room.visualFormat,
      useFloorProxy: false,
    }));
    setRooms(fullRooms);
    buildWorldFromRooms(fullRooms, `Loading full SPZ for ${targetRoom.label}...`);
  }

  function handleFloorPlanUpload(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFloorPlanUrl((prev) => {
      if (prev?.startsWith?.('blob:')) URL.revokeObjectURL(prev);
      return url;
    });
    setFloorPlanMeta(null);
    setStatus(`${file.name} loaded`);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">SS</div>
          <div>
            <h1>Splat Stitcher</h1>
            <p>Multi-room Gaussian world builder</p>
          </div>
        </div>
        <div className="metric-strip">
          <div className="metric">
            <Layers size={16} />
            <span>{rooms.length} rooms</span>
          </div>
          <div className="metric">
            <CheckCircle2 size={16} />
            <span>{readyCount} ready</span>
          </div>
          <div className="metric">
            <Box size={16} />
            <span>{includedCount} included</span>
          </div>
          <div className="metric">
            <Gauge size={16} />
            <span>{(totalPoints / 1000000).toFixed(2)}M splats</span>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-rail">
          <button className={activeView === 'map' ? 'rail-button active' : 'rail-button'} onClick={() => setActiveView('map')}>
            <Map size={18} />
            <span>Map</span>
          </button>
          <button className={activeView === 'world' ? 'rail-button active' : 'rail-button'} onClick={() => setActiveView('world')}>
            <Box size={18} />
            <span>World</span>
          </button>
          <button className="rail-button" onClick={loadDemo}>
            <Sparkles size={18} />
            <span>Demo</span>
          </button>
          <button className="rail-button" onClick={loadLuxuryPenthouse}>
            <Building2 size={18} />
            <span>Estate</span>
          </button>
        </aside>

        <section className="main-stage">
          <div className="stage-toolbar">
            <div className="segmented">
              <button className={activeView === 'map' ? 'selected' : ''} onClick={() => setActiveView('map')}>
                <Map size={16} />
                Map
              </button>
              <button className={activeView === 'world' ? 'selected' : ''} onClick={() => setActiveView('world')}>
                <Box size={16} />
                World
              </button>
            </div>
            <div className="toolbar-actions">
              <label className="icon-button">
                <FileUp size={16} />
                <span>Plan</span>
                <input type="file" accept="image/*" onChange={(event) => handleFloorPlanUpload(event.target.files?.[0])} />
              </label>
              <button className="icon-button" onClick={addRoom}>
                <Plus size={16} />
                <span>Room</span>
              </button>
              <button className="icon-button" onClick={autoSpreadRooms}>
                <RotateCcw size={16} />
                <span>Spread</span>
              </button>
              <button className="icon-button" onClick={loadLuxuryPenthouse}>
                <Building2 size={16} />
                <span>Penthouse</span>
              </button>
              <button className="icon-button" onClick={generateJoinedMap}>
                <Route size={16} />
                <span>Build Tour</span>
              </button>
              <button className="icon-button" onClick={generateFullSelectedRoom}>
                <Sparkles size={16} />
                <span>Full Room</span>
              </button>
              <button className="primary-button" onClick={generateWorld}>
                <Play size={16} />
                <span>Generate</span>
              </button>
            </div>
          </div>

          {activeView === 'map' ? (
            <FloorPlanCanvas
              rooms={rooms}
              selectedRoomId={selectedRoomId}
              floorPlanUrl={floorPlanUrl}
              planSize={floorPlanMeta}
              metersPerPixel={computedScale}
              portalLinks={portalLinks}
              onSelectRoom={setSelectedRoomId}
              onUpdateRoom={updateRoom}
              setMetersPerPixel={setMetersPerPixel}
            />
          ) : (
            <WorldViewer
              worldBuild={worldBuild}
              showColliders={showColliders}
              collisionEnabled={collisionEnabled}
              status={status}
              onStatus={setStatus}
            />
          )}
        </section>

        <aside className="right-panel">
          <RoomPanel
            room={selectedRoom}
            rooms={rooms}
            metersPerPixel={computedScale}
            showColliders={showColliders}
            collisionEnabled={collisionEnabled}
            status={status}
            onUpdateRoom={updateRoom}
            onRemoveRoom={removeRoom}
            onSplatUpload={handleSplatUpload}
            onColliderUpload={handleColliderUpload}
            onToggleColliders={setShowColliders}
            onToggleCollision={setCollisionEnabled}
          />
        </aside>
      </main>
    </div>
  );
}
