import * as THREE from 'three';
import {
  DropInViewer,
  LogLevel,
  SceneRevealMode,
} from '@mkkellogg/gaussian-splats-3d';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';
import {
  directionForWall,
  inwardDirectionForWall,
  PLAYER_EYE_HEIGHT,
} from '../core/roomAligner.js';
import { PlayerController } from './playerController.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const SPLAT_ALPHA_REMOVAL_THRESHOLD = 5;
const _rayDirectionDown = new THREE.Vector3(0, -1, 0);

function objectUrlFor(source) {
  if (!source) return null;
  if (typeof source === 'string') return { url: source, revoke: null };
  const url = URL.createObjectURL(source);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

function disposeObject(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.geometry?.disposeBoundsTree?.();
    obj.geometry?.dispose?.();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((mat) => mat?.dispose?.());
  });
}

function makeLine(points, color = 0xc8a948) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78 });
  return new THREE.Line(geometry, material);
}

export class WorldRenderer {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080807);
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.05, 500);
    this.camera.position.set(0, 1.65, 7);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.clock = new THREE.Clock();
    this.dropIn = null;
    this.colliderRoots = [];
    this.colliderMeshes = [];
    this.roomDebugRoots = [];
    this.portalTransitions = [];
    this.lastPortalAt = 0;
    this.running = true;
    this.disposed = false;
    this.loadVersion = 0;
    this.showColliders = false;
    this.loader = new GLTFLoader();
    this.player = new PlayerController(this.camera, canvas);

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);

    this._setupScene();
    this.resize();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _setupScene() {
    const grid = new THREE.GridHelper(70, 70, 0x514830, 0x22221d);
    grid.name = 'world-grid';
    grid.material.transparent = true;
    grid.material.opacity = 0.38;
    this.scene.add(grid);

    const ambient = new THREE.HemisphereLight(0xfff2d2, 0x2e453f, 0.95);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 0.45);
    key.position.set(4, 7, 3);
    this.scene.add(key);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth || this.canvas.clientWidth || 1);
    const height = Math.max(1, parent?.clientHeight || this.canvas.clientHeight || 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  setShowColliders(value) {
    this.showColliders = Boolean(value);
    for (const mesh of this.colliderMeshes) {
      mesh.visible = this.showColliders;
    }
    for (const root of this.roomDebugRoots) {
      if (root.userData.debugOnly) root.visible = this.showColliders;
    }
  }

  setCollisionEnabled(value) {
    this.player.setCollisionEnabled(value);
  }

  async clear() {
    if (this.dropIn) {
      this.scene.remove(this.dropIn);
      await this.dropIn.dispose().catch(() => {});
      this.dropIn = null;
    }

    for (const root of [...this.colliderRoots, ...this.roomDebugRoots]) {
      this.scene.remove(root);
      disposeObject(root);
    }
    this.colliderRoots = [];
    this.colliderMeshes = [];
    this.roomDebugRoots = [];
    this.portalTransitions = [];
  }

  async loadRooms(roomTransforms, links = []) {
    const loadVersion = ++this.loadVersion;
    await this.clear();
    if (this.disposed || loadVersion !== this.loadVersion) return;
    this.callbacks.onStatus?.('Loading splat rooms...');

    this.dropIn = new DropInViewer({
      dynamicScene: true,
      gpuAcceleratedSort: false,
      integerBasedSort: false,
      sharedMemoryForWorkers: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
      sceneRevealMode: SceneRevealMode.Instant,
      logLevel: LogLevel.None,
      halfPrecisionCovariancesOnGPU: false,
      antialiased: false,
      maxScreenSpaceSplatSize: 96,
      kernel2DSize: 0.12,
      focalAdjustment: 1.12,
      inMemoryCompressionLevel: 1,
      freeIntermediateSplatData: true,
    });
    this.dropIn.name = 'splat-stitcher-dropin';
    this.scene.add(this.dropIn);

    const splatHandles = [];
    const splatScenes = [];
    const loadedSplatSources = [];
    const placeholderRooms = [];
    const meshRooms = [];

    for (const room of roomTransforms) {
      if (room.visualFormat === 'glb') {
        meshRooms.push(room);
        continue;
      }
      const source = room.splatFile || room.splatUrl;
      if (!source) {
        placeholderRooms.push(room);
        continue;
      }
      const handle = objectUrlFor(source);
      splatHandles.push(handle);
      loadedSplatSources.push({
        id: room.id,
        label: room.label,
        url: handle.url,
        format: room.visualFormat || 'spz',
        pointCount: room.sourceRoom?.analysis?.numPoints || room.sourceRoom?.demoMeta?.numPoints || null,
      });
      splatScenes.push({
        path: handle.url,
        splatAlphaRemovalThreshold: SPLAT_ALPHA_REMOVAL_THRESHOLD,
        position: room.position,
        rotation: room.splatQuaternion,
        scale: room.scale,
      });
    }

    if (splatScenes.length) {
      this.callbacks.onStatus?.(`Loading ${splatScenes.length} splat rooms as one tour...`);
      try {
        await this.dropIn.addSplatScenes(splatScenes, false, (percentComplete, percentLabel) => {
          if (this.disposed || loadVersion !== this.loadVersion) return;
          const percent = Number.isFinite(percentComplete) ? `${Math.round(percentComplete)}%` : percentLabel || '';
          this.callbacks.onStatus?.(`Loading full splat tour ${percent}`.trim());
        });
      } catch (error) {
        if (this.disposed || loadVersion !== this.loadVersion) return;
        throw error;
      } finally {
        splatHandles.forEach((handle) => handle?.revoke?.());
      }
    }
    if (this.disposed || loadVersion !== this.loadVersion) return;

    for (const room of meshRooms) {
      this.callbacks.onStatus?.(`Loading ${room.label} mesh...`);
      await this._loadVisibleGLB(room);
      if (this.disposed || loadVersion !== this.loadVersion) return;
    }

    for (const room of placeholderRooms) {
      this._addPlaceholder(room, 0x2b342d);
    }

    for (const [index, room] of roomTransforms.entries()) {
      this.callbacks.onStatus?.(`Preparing ${room.label} (${index + 1}/${roomTransforms.length})...`);
      if (room.useFloorProxy) {
        this._addProxyFloor(room);
      } else if (room.colliderUrl || room.colliderFile) {
        await this._loadCollider(room);
        if (this.disposed || loadVersion !== this.loadVersion) return;
        if (room.footprint) this._addProxyFloor(room);
      } else {
        this._addFallbackFloor(room);
      }
      this._addRoomDebug(room);
    }

    this._addDoorConnectors(links);
    this._addPortalVisuals(links);
    this._addPortalHandoffVisuals(links);
    this._addLinks(links);
    this._configurePortalTransitions(links);
    this.scene.updateMatrixWorld(true);
    const passabilityReport = this._simulateJoinedPath(roomTransforms, links);
    window.__splatStitcherActiveBuild = {
      roomCount: roomTransforms.length,
      splatCount: loadedSplatSources.length,
      fullSpzCount: loadedSplatSources.filter((source) => source.format === 'spz' && source.url.includes('.spz')).length,
      portalCount: links.filter((link) => link.type === 'portal-teleport').length,
      sources: loadedSplatSources,
      meshCount: meshRooms.length,
      placeholderCount: placeholderRooms.length,
    };
    window.__splatStitcherReport = passabilityReport;
    document.documentElement.dataset.splatStitcherReport = JSON.stringify(passabilityReport);
    document.documentElement.dataset.splatStitcherActiveBuild = JSON.stringify(window.__splatStitcherActiveBuild);
    const spawn = roomTransforms[0]?.spawnPoint || [0, 1.65, 4];
    this.player.teleportTo(spawn, roomTransforms[0]?.spawnYawDeg ?? 180);
    const routeStatus = links.length
      ? passabilityReport.passable
        ? passabilityReport.transitionMode === 'door_portals'
          ? `door portals ready (${passabilityReport.portalCount} links)`
          : `door path passable (${passabilityReport.samples} samples)`
        : `door path blocked near ${passabilityReport.failedAt?.map((value) => value.toFixed(2)).join(', ')}`
      : 'single room ready';
    this.callbacks.onStatus?.(`World ready: ${roomTransforms.length} rooms; ${routeStatus}`);
  }

  async _loadSplat(room) {
    const source = room.splatFile || room.splatUrl;
    if (!source) {
      this._addPlaceholder(room, 0x2b342d);
      return;
    }
    const handle = objectUrlFor(source);
    try {
      await this.dropIn.addSplatScene(handle.url, {
        splatAlphaRemovalThreshold: SPLAT_ALPHA_REMOVAL_THRESHOLD,
        showLoadingUI: false,
        progressiveLoad: false,
        position: room.position,
        rotation: room.splatQuaternion,
        scale: room.scale,
      });
    } finally {
      handle?.revoke?.();
    }
  }

  async _loadVisibleGLB(room) {
    const handle = objectUrlFor(room.splatFile || room.splatUrl);
    if (!handle) return;
    try {
      const gltf = await this.loader.loadAsync(handle.url);
      gltf.scene.position.fromArray(room.position);
      gltf.scene.quaternion.fromArray(room.splatQuaternion);
      gltf.scene.scale.fromArray(room.scale);
      gltf.scene.name = `visual-${room.id}`;
      this.scene.add(gltf.scene);
      this.roomDebugRoots.push(gltf.scene);
    } finally {
      handle.revoke?.();
    }
  }

  async _loadCollider(room) {
    const handle = objectUrlFor(room.colliderFile || room.colliderUrl);
    if (!handle) return;
    try {
      const gltf = await this.loader.loadAsync(handle.url);
      const root = gltf.scene;
      root.name = `collider-${room.id}`;
      root.position.fromArray(room.colliderPosition);
      root.quaternion.fromArray(room.colliderQuaternion);
      root.scale.fromArray(room.colliderScale);
      root.updateWorldMatrix(true, true);

      root.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry.computeBoundsTree?.();
        child.material = new THREE.MeshBasicMaterial({
          color: 0x28d890,
          wireframe: true,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
        });
        child.visible = this.showColliders;
        child.frustumCulled = false;
        this.colliderMeshes.push(child);
      });

      this.scene.add(root);
      this.colliderRoots.push(root);
    } finally {
      handle.revoke?.();
    }
  }

  _addFallbackFloor(room) {
    const root = new THREE.Group();
    root.name = `fallback-floor-${room.id}`;
    const geometry = new THREE.BoxGeometry(7, 0.08, 5);
    const material = new THREE.MeshBasicMaterial({
      color: 0x1fbf81,
      transparent: true,
      opacity: 0.08,
      visible: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(room.colliderPosition[0], 0, room.colliderPosition[2]);
    mesh.geometry.computeBoundsTree?.();
    root.add(mesh);
    this.scene.add(root);
    this.colliderRoots.push(root);
    this.colliderMeshes.push(mesh);
  }

  _addProxyFloor(room) {
    const root = new THREE.Group();
    root.name = `proxy-floor-${room.id}`;
    const footprint = room.footprint || {
      xMin: -Math.max(2, (room.sourceRoom?.realWidthM || 5) / 2),
      xMax: Math.max(2, (room.sourceRoom?.realWidthM || 5) / 2),
      zMin: -Math.max(2, (room.sourceRoom?.realDepthM || 4) / 2),
      zMax: Math.max(2, (room.sourceRoom?.realDepthM || 4) / 2),
    };
    const width = Math.max(0.5, footprint.xMax - footprint.xMin);
    const depth = Math.max(0.5, footprint.zMax - footprint.zMin);
    const geometry = new THREE.BoxGeometry(width, 0.08, depth);
    const material = new THREE.MeshBasicMaterial({
      color: 0x22d58e,
      wireframe: true,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `proxy-floor-mesh-${room.id}`;
    mesh.position.set(
      room.colliderPosition[0] + (footprint.xMin + footprint.xMax) / 2,
      -0.04,
      room.colliderPosition[2] + (footprint.zMin + footprint.zMax) / 2,
    );
    mesh.visible = this.showColliders;
    mesh.frustumCulled = false;
    mesh.geometry.computeBoundsTree?.();
    root.add(mesh);
    this.scene.add(root);
    this.colliderRoots.push(root);
    this.colliderMeshes.push(mesh);
  }

  _addPlaceholder(room, color) {
    const geometry = new THREE.BoxGeometry(5, 2.8, 4);
    const material = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(room.position[0], 1.4, room.position[2]);
    mesh.name = `placeholder-${room.id}`;
    this.scene.add(mesh);
    this.roomDebugRoots.push(mesh);
  }

  _addRoomDebug(room) {
    const root = new THREE.Group();
    root.name = `debug-${room.id}`;
    root.userData.debugOnly = true;
    root.visible = this.showColliders;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: 0xf2c84b, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(room.colliderPosition[0], 0.025, room.colliderPosition[2]);
    root.add(ring);

    for (const door of room.doors || []) {
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.35, door.width || 0.7), 0.05, 0.18),
        new THREE.MeshBasicMaterial({ color: 0x38dca2, transparent: true, opacity: 0.85 }),
      );
      marker.position.set(
        room.colliderPosition[0] + (door.worldX || 0),
        0.06,
        room.colliderPosition[2] + (door.worldZ || 0),
      );
      marker.rotation.y = THREE.MathUtils.degToRad(door.facingYaw || 0);
      root.add(marker);
    }

    for (const [doorName, door] of Object.entries(room.stitchDoorWorld || {})) {
      if (!door) continue;
      const marker = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.35, door.width || 0.8), 0.08, 0.22),
        new THREE.MeshBasicMaterial({
          color: doorName === 'entry' ? 0x56c7ff : 0xf5b94f,
          transparent: true,
          opacity: 0.9,
        }),
      );
      marker.position.set(door.x, 0.08, door.z);
      marker.name = `stitch-door-${room.id}-${doorName}`;
      root.add(marker);
    }

    this.scene.add(root);
    this.roomDebugRoots.push(root);
  }

  _addDoorConnectors(links) {
    const doorLinks = links.filter((link) => link.type === 'door-stitch');
    if (!doorLinks.length) return;

    const root = new THREE.Group();
    root.name = 'door-connector-floors';
    for (const link of doorLinks) {
      const a = new THREE.Vector3(link.a[0], 0, link.a[2]);
      const b = new THREE.Vector3(link.b[0], 0, link.b[2]);
      const direction = b.clone().sub(a);
      const length = Math.max(0.2, direction.length());
      const midpoint = a.clone().add(b).multiplyScalar(0.5);
      const geometry = new THREE.BoxGeometry(length + 0.16, 0.08, Math.max(0.7, link.width || 1.1));
      const material = new THREE.MeshBasicMaterial({
        color: 0xe0b640,
        wireframe: true,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `door-connector-${link.id}`;
      mesh.position.set(midpoint.x, -0.04, midpoint.z);
      mesh.rotation.y = -Math.atan2(direction.z, direction.x);
      mesh.visible = this.showColliders;
      mesh.frustumCulled = false;
      mesh.geometry.computeBoundsTree?.();
      root.add(mesh);
      this.colliderMeshes.push(mesh);
    }
    this.scene.add(root);
    this.colliderRoots.push(root);
  }

  _addPortalVisuals(links) {
    const doorLinks = links.filter((link) => link.type === 'door-stitch');
    if (!doorLinks.length) return;

    const root = new THREE.Group();
    root.name = 'portal-visuals';
    root.userData.debugOnly = true;
    root.visible = this.showColliders;
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a2616,
      roughness: 0.9,
      metalness: 0.05,
    });
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x191713,
      roughness: 0.95,
      metalness: 0.0,
    });
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a0908,
      transparent: true,
      opacity: 0.3,
      roughness: 1,
      depthWrite: false,
    });

    for (const link of doorLinks) {
      const a = new THREE.Vector3(link.a[0], 0, link.a[2]);
      const b = new THREE.Vector3(link.b[0], 0, link.b[2]);
      const direction = b.clone().sub(a);
      const length = Math.max(0.2, direction.length());
      const width = Math.max(0.9, link.width || 1.15);
      const yaw = -Math.atan2(direction.z, direction.x);
      const midpoint = a.clone().add(b).multiplyScalar(0.5);
      const dirUnit = direction.clone().normalize();
      const sideUnit = new THREE.Vector3(-dirUnit.z, 0, dirUnit.x);

      const floor = new THREE.Mesh(new THREE.BoxGeometry(length + 0.28, 0.04, width + 0.18), floorMaterial.clone());
      floor.name = `portal-threshold-${link.id}`;
      floor.position.set(midpoint.x, 0.012, midpoint.z);
      floor.rotation.y = yaw;
      root.add(floor);

      for (const side of [-1, 1]) {
        const sideWall = new THREE.Mesh(new THREE.BoxGeometry(length + 0.18, 1.15, 0.06), sideMaterial.clone());
        sideWall.name = `portal-side-${link.id}-${side}`;
        sideWall.position.set(
          midpoint.x + sideUnit.x * side * (width / 2 + 0.05),
          0.62,
          midpoint.z + sideUnit.z * side * (width / 2 + 0.05),
        );
        sideWall.rotation.y = yaw;
        root.add(sideWall);
      }

      this._addPortalFrame(root, a.clone().addScaledVector(dirUnit, 0.09), yaw, width, frameMaterial);
      this._addPortalFrame(root, b.clone().addScaledVector(dirUnit, -0.09), yaw, width, frameMaterial);
    }

    this.scene.add(root);
    this.roomDebugRoots.push(root);
  }

  _addPortalHandoffVisuals(links) {
    const portalLinks = links.filter((link) => link.type === 'portal-teleport');
    if (!portalLinks.length) return;

    const root = new THREE.Group();
    root.name = 'door-portal-handoffs';
    const thresholdMaterial = new THREE.MeshStandardMaterial({
      color: 0x18d89a,
      emissive: 0x073426,
      roughness: 0.8,
      metalness: 0.05,
      transparent: true,
      opacity: 0.72,
    });
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0xc8a948,
      emissive: 0x1d1602,
      roughness: 0.7,
      metalness: 0.15,
      transparent: true,
      opacity: 0.82,
    });

    for (const link of portalLinks) {
      this._addDoorPortalMarker(root, link.a, link.fromDoorMeta, link.width, thresholdMaterial, frameMaterial);
      this._addDoorPortalMarker(root, link.b, link.toDoorMeta, link.width, thresholdMaterial, frameMaterial);
    }

    this.scene.add(root);
    this.roomDebugRoots.push(root);
  }

  _addDoorPortalMarker(root, point, door, width, thresholdMaterial, frameMaterial) {
    if (!point || !door) return;
    const outward = directionForWall(door.wall);
    const inward = inwardDirectionForWall(door.wall);
    const yaw = -Math.atan2(outward.z, outward.x);
    const portalWidth = Math.max(0.85, width || door.width || 1.1);
    const center = new THREE.Vector3(point[0], 0, point[2]);

    const threshold = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.045, portalWidth),
      thresholdMaterial.clone(),
    );
    threshold.name = `portal-trigger-${door.label || door.wall}`;
    threshold.position.set(
      center.x + inward.x * 0.28,
      0.035,
      center.z + inward.z * 0.28,
    );
    threshold.rotation.y = yaw;
    threshold.frustumCulled = false;
    root.add(threshold);

    this._addPortalFrame(
      root,
      center.clone().add(new THREE.Vector3(inward.x * 0.06, 0, inward.z * 0.06)),
      yaw,
      portalWidth,
      frameMaterial,
    );
  }

  _addPortalFrame(root, center, yaw, width, material) {
    const height = 2.28;
    const jambThickness = 0.11;
    const depth = 0.22;
    const lintelHeight = 0.16;
    const pieces = [
      { name: 'left', size: [depth, height, jambThickness], pos: [0, height / 2, -width / 2] },
      { name: 'right', size: [depth, height, jambThickness], pos: [0, height / 2, width / 2] },
      { name: 'top', size: [depth, lintelHeight, width + jambThickness], pos: [0, height + lintelHeight / 2, 0] },
    ];

    for (const piece of pieces) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...piece.size), material.clone());
      mesh.name = `portal-frame-${piece.name}`;
      const localX = piece.pos[0];
      const localZ = piece.pos[2];
      mesh.position.set(
        center.x + Math.cos(yaw) * localX + Math.sin(yaw) * localZ,
        piece.pos[1],
        center.z - Math.sin(yaw) * localX + Math.cos(yaw) * localZ,
      );
      mesh.rotation.y = yaw;
      root.add(mesh);
    }
  }

  _addLinks(links) {
    const debugLinks = links.filter((link) => link.type !== 'door-stitch' && link.type !== 'portal-teleport');
    if (!debugLinks.length) return;
    const root = new THREE.Group();
    root.name = 'room-links';
    root.userData.debugOnly = true;
    root.visible = this.showColliders;
    for (const link of debugLinks) {
      const a = new THREE.Vector3(link.a[0], 0.08, link.a[2]);
      const b = new THREE.Vector3(link.b[0], 0.08, link.b[2]);
      root.add(makeLine([a, b]));
    }
    this.scene.add(root);
    this.roomDebugRoots.push(root);
  }

  _configurePortalTransitions(links) {
    const portalLinks = links.filter((link) => link.type === 'portal-teleport');
    this.portalTransitions = portalLinks.flatMap((link) => {
      const forward = this._makePortalTransition({
        id: `${link.id}:forward`,
        from: link.from,
        to: link.to,
        sourcePoint: link.a,
        sourceDoor: link.fromDoorMeta,
        targetPoint: link.b,
        targetDoor: link.toDoorMeta,
        radius: link.triggerRadius,
        label: link.label,
      });
      const backward = this._makePortalTransition({
        id: `${link.id}:backward`,
        from: link.to,
        to: link.from,
        sourcePoint: link.b,
        sourceDoor: link.toDoorMeta,
        targetPoint: link.a,
        targetDoor: link.fromDoorMeta,
        radius: link.triggerRadius,
        label: link.label,
      });
      return [forward, backward].filter(Boolean);
    });

    const publicTransitions = this.portalTransitions.map((transition) => ({
      id: transition.id,
      from: transition.from,
      to: transition.to,
      source: transition.source.toArray().map((value) => Number(value.toFixed(3))),
      target: transition.target.map((value) => Number(value.toFixed(3))),
      radius: Number(transition.radius.toFixed(3)),
      yawDeg: Number(transition.yawDeg.toFixed(1)),
    }));
    window.__splatStitcherPortalTransitions = publicTransitions;
    document.documentElement.dataset.splatStitcherPortalTransitions = JSON.stringify(publicTransitions);
  }

  _makePortalTransition({ id, from, to, sourcePoint, targetPoint, targetDoor, radius, label }) {
    if (!sourcePoint || !targetPoint || !targetDoor) return null;
    const targetInward = inwardDirectionForWall(targetDoor.wall);
    return {
      id,
      from,
      to,
      label,
      source: new THREE.Vector3(sourcePoint[0], PLAYER_EYE_HEIGHT, sourcePoint[2]),
      target: [
        targetPoint[0] + targetInward.x * 0.9,
        PLAYER_EYE_HEIGHT,
        targetPoint[2] + targetInward.z * 0.9,
      ],
      yawDeg: targetInward.yawDeg,
      radius: Math.max(0.55, radius || 0.75),
    };
  }

  _simulateJoinedPath(roomTransforms, links) {
    const portalLinks = links.filter((link) => link.type === 'portal-teleport');
    if (portalLinks.length) {
      return this._simulatePortalGraph(roomTransforms, portalLinks);
    }

    const doorLinks = links.filter((link) => link.type === 'door-stitch');
    if (!roomTransforms.length) {
      return { passable: false, reason: 'no_rooms', samples: 0, connectorCount: 0 };
    }
    if (!doorLinks.length) {
      return { passable: true, reason: 'single_or_unstitched', samples: 1, connectorCount: 0 };
    }

    const roomById = new Map(roomTransforms.map((room) => [room.id, room]));
    let samples = 0;
    const checkedLinks = [];

    for (const link of doorLinks) {
      const from = roomById.get(link.from);
      const to = roomById.get(link.to);
      if (!from || !to) {
        return {
          passable: false,
          reason: 'missing_link_room',
          samples,
          connectorCount: doorLinks.length,
          roomCount: roomTransforms.length,
        };
      }

      const waypoints = [
        new THREE.Vector3(from.colliderPosition[0], 0, from.colliderPosition[2]),
        new THREE.Vector3(link.a[0], 0, link.a[2]),
        new THREE.Vector3(link.b[0], 0, link.b[2]),
        new THREE.Vector3(to.colliderPosition[0], 0, to.colliderPosition[2]),
      ];

      for (let i = 1; i < waypoints.length; i += 1) {
        const start = waypoints[i - 1];
        const end = waypoints[i];
        const distance = start.distanceTo(end);
        const steps = Math.max(1, Math.ceil(distance / 0.45));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const point = start.clone().lerp(end, t);
          samples += 1;
          if (!this._hasFloorAt(point.x, point.z)) {
            return {
              passable: false,
              reason: 'missing_floor',
              failedAt: [point.x, 0, point.z],
              failedLink: { from: link.from, to: link.to },
              samples,
              connectorCount: doorLinks.length,
              roomCount: roomTransforms.length,
            };
          }
        }
      }
      checkedLinks.push(`${link.from}->${link.to}`);
    }

    return {
      passable: true,
      reason: 'sampled_floor_route',
      samples,
      checkedLinks,
      connectorCount: doorLinks.length,
      roomCount: roomTransforms.length,
      connectors: doorLinks.map((link) => ({
        from: link.from,
        to: link.to,
        distanceM: Number((link.distanceM || 0).toFixed(3)),
        widthM: Number((link.width || 0).toFixed(2)),
      })),
    };
  }

  _simulatePortalGraph(roomTransforms, portalLinks) {
    if (!roomTransforms.length) {
      return { passable: false, reason: 'no_rooms', samples: 0, connectorCount: 0 };
    }
    let samples = 0;
    const checkedLinks = [];

    for (const link of portalLinks) {
      const sourceInward = inwardDirectionForWall(link.fromDoorMeta?.wall);
      const targetInward = inwardDirectionForWall(link.toDoorMeta?.wall);
      const sourcePoint = {
        x: link.a[0] + sourceInward.x * 0.55,
        z: link.a[2] + sourceInward.z * 0.55,
      };
      const targetPoint = {
        x: link.b[0] + targetInward.x * 0.55,
        z: link.b[2] + targetInward.z * 0.55,
      };
      samples += 2;

      if (!this._hasFloorAt(sourcePoint.x, sourcePoint.z)) {
        return {
          passable: false,
          reason: 'missing_source_floor',
          failedAt: [sourcePoint.x, 0, sourcePoint.z],
          failedLink: { from: link.from, to: link.to, door: link.fromDoor },
          samples,
          portalCount: portalLinks.length,
          roomCount: roomTransforms.length,
          transitionMode: 'door_portals',
        };
      }
      if (!this._hasFloorAt(targetPoint.x, targetPoint.z)) {
        return {
          passable: false,
          reason: 'missing_target_floor',
          failedAt: [targetPoint.x, 0, targetPoint.z],
          failedLink: { from: link.from, to: link.to, door: link.toDoor },
          samples,
          portalCount: portalLinks.length,
          roomCount: roomTransforms.length,
          transitionMode: 'door_portals',
        };
      }
      checkedLinks.push(`${link.from}:${link.fromDoor}->${link.to}:${link.toDoor}`);
    }

    return {
      passable: true,
      reason: 'sampled_door_portals',
      samples,
      checkedLinks,
      portalCount: portalLinks.length,
      connectorCount: portalLinks.length,
      roomCount: roomTransforms.length,
      transitionMode: 'door_portals',
      connectors: portalLinks.map((link) => ({
        from: link.from,
        to: link.to,
        fromDoor: link.fromDoor,
        toDoor: link.toDoor,
        distanceM: Number((link.distanceM || 0).toFixed(3)),
        widthM: Number((link.width || 0).toFixed(2)),
      })),
    };
  }

  _hasFloorAt(x, z) {
    const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 4, z), _rayDirectionDown, 0, 8);
    for (const collider of this.colliderMeshes) {
      collider.updateWorldMatrix(true, false);
      const hits = raycaster.intersectObject(collider, true);
      if (hits.some((hit) => hit.point.y > -0.25 && hit.point.y < 0.25)) return true;
    }
    return false;
  }

  resetPlayer() {
    this.player.teleportTo([0, 1.65, 6], 180);
  }

  _checkPortalTransitions() {
    if (!this.portalTransitions.length) return;
    const now = performance.now();
    if (now - this.lastPortalAt < 950) return;
    const position = this.camera.position;

    for (const transition of this.portalTransitions) {
      const dx = position.x - transition.source.x;
      const dz = position.z - transition.source.z;
      if (dx * dx + dz * dz > transition.radius * transition.radius) continue;

      this.player.teleportTo(transition.target, transition.yawDeg);
      this.lastPortalAt = now;
      const payload = {
        id: transition.id,
        from: transition.from,
        to: transition.to,
        target: transition.target,
        yawDeg: transition.yawDeg,
        at: Date.now(),
      };
      window.__splatStitcherLastPortal = payload;
      document.documentElement.dataset.splatStitcherLastPortal = JSON.stringify(payload);
      this.callbacks.onStatus?.(`Door portal: ${transition.from} -> ${transition.to}`);
      break;
    }
  }

  _animate() {
    if (!this.running) return;
    requestAnimationFrame(this._animate);
    const delta = Math.min(0.05, this.clock.getDelta());
    this.player.update(delta, this.colliderMeshes);
    this._checkPortalTransitions();
    this.renderer.render(this.scene, this.camera);
    this.callbacks.onFrame?.({
      position: this.camera.position.toArray(),
      floorY: this.player.floorY,
      locked: this.player.isLocked,
      colliders: this.colliderMeshes.length,
    });
  }

  dispose() {
    this.running = false;
    this.disposed = true;
    this.loadVersion += 1;
    this.player.dispose();
    this._resizeObserver.disconnect();
    void this.clear();
    this.renderer.dispose();
  }
}
