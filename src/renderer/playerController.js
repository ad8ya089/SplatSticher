import * as THREE from 'three';

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _rayDirectionDown = new THREE.Vector3(0, -1, 0);
const _rayDirectionHorizontal = new THREE.Vector3();
const _hitNormal = new THREE.Vector3();

export class PlayerController {
  constructor(camera, domElement, options = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.eyeHeight = options.eyeHeight ?? 1.65;
    this.walkSpeed = options.walkSpeed ?? 3.0;
    this.sprintSpeed = options.sprintSpeed ?? 5.6;
    this.radius = options.radius ?? 0.28;
    this.maxStepHeight = options.maxStepHeight ?? 0.45;
    this.gravityFallbackY = options.gravityFallbackY ?? 0;
    this.yaw = options.yaw ?? 0;
    this.pitch = options.pitch ?? 0;
    this.keys = {};
    this.enabled = true;
    this.collisionEnabled = true;
    this.isLocked = false;
    this.floorY = 0;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onClick = this._onClick.bind(this);

    this.bind();
  }

  bind() {
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    this.domElement.addEventListener('click', this._onClick);
  }

  dispose() {
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this.domElement.removeEventListener('click', this._onClick);
  }

  _onClick() {
    if (!this.enabled) return;
    this.domElement.requestPointerLock?.();
  }

  _onPointerLockChange() {
    this.isLocked = document.pointerLockElement === this.domElement;
  }

  _onMouseMove(event) {
    if (!this.enabled || !this.isLocked) return;
    this.yaw -= event.movementX * 0.002;
    this.pitch -= event.movementY * 0.002;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  _onKeyDown(event) {
    this.keys[event.code] = true;
  }

  _onKeyUp(event) {
    this.keys[event.code] = false;
  }

  setCollisionEnabled(value) {
    this.collisionEnabled = Boolean(value);
  }

  update(deltaTime, colliders = []) {
    if (!this.enabled) return;

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.z = 0;

    const speed = this.keys.ShiftLeft || this.keys.ShiftRight ? this.sprintSpeed : this.walkSpeed;
    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _move.set(0, 0, 0);

    if (this.keys.KeyW || this.keys.ArrowUp) _move.addScaledVector(_forward, speed * deltaTime);
    if (this.keys.KeyS || this.keys.ArrowDown) _move.addScaledVector(_forward, -speed * deltaTime);
    if (this.keys.KeyA || this.keys.ArrowLeft) _move.addScaledVector(_right, -speed * deltaTime);
    if (this.keys.KeyD || this.keys.ArrowRight) _move.addScaledVector(_right, speed * deltaTime);

    if (_move.lengthSq() > 0) {
      const proposed = this.camera.position.clone().add(_move);
      if (!this.collisionEnabled || this._canMoveTo(proposed, colliders)) {
        this.camera.position.x = proposed.x;
        this.camera.position.z = proposed.z;
      }
    }

    const floor = this._findFloorY(this.camera.position, colliders);
    this.floorY = floor;
    this.camera.position.y = THREE.MathUtils.lerp(
      this.camera.position.y,
      floor + this.eyeHeight,
      Math.min(1, deltaTime * 14),
    );
  }

  _canMoveTo(proposed, colliders) {
    if (!colliders.length) return true;
    const delta = proposed.clone().sub(this.camera.position);
    delta.y = 0;
    const distance = delta.length();
    if (distance < 0.0001) return true;

    _rayDirectionHorizontal.copy(delta).normalize();
    const raycaster = new THREE.Raycaster(
      this.camera.position.clone().setY(this.floorY + 0.9),
      _rayDirectionHorizontal,
      0,
      distance + this.radius,
    );

    for (const collider of colliders) {
      const hits = raycaster.intersectObject(collider, true);
      const blockingHit = hits.find((hit) => hit.distance <= distance + this.radius);
      if (blockingHit) return false;
    }
    return true;
  }

  _findFloorY(position, colliders) {
    if (!this.collisionEnabled || !colliders.length) return this.gravityFallbackY;
    const origin = position.clone();
    origin.y += 4;
    const raycaster = new THREE.Raycaster(origin, _rayDirectionDown, 0, 12);
    let best = -Infinity;

    for (const collider of colliders) {
      const hits = raycaster.intersectObject(collider, true);
      for (const hit of hits) {
        if (!this._isWalkableFloorHit(hit)) continue;
        if (hit.point.y > this.floorY + this.maxStepHeight) continue;
        if (hit.point.y <= position.y + 0.25 && hit.point.y > best) {
          best = hit.point.y;
        }
      }
    }

    return Number.isFinite(best) ? best : this.floorY || this.gravityFallbackY;
  }

  _isWalkableFloorHit(hit) {
    if (!hit.face) return true;
    _hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    return _hitNormal.y > 0.45;
  }

  teleportTo(position, yawDeg = 0) {
    const [x, y, z] = Array.isArray(position) ? position : [position.x, position.y, position.z];
    this.camera.position.set(x, y, z);
    this.floorY = y - this.eyeHeight;
    this.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.pitch = 0;
  }
}
