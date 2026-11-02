import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { PHYSICS_CONFIG, CAMERA_CONFIG, COLLIDER_KIND } from '../js/constants.js';
import { createInputController } from '../js/input.js';
import { createCameraController } from '../js/camera.js';
import { createPhysicsController } from '../js/physics.js';
import { loadElfPlayer } from '../js/player.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function createTrackedEventTarget(extra = {}) {
  const target = new EventTarget();
  const registeredTypes = [];
  const origAdd = target.addEventListener.bind(target);
  target.addEventListener = (type, listener, options) => {
    registeredTypes.push(type);
    return origAdd(type, listener, options);
  };
  return Object.assign(target, extra, { registeredTypes });
}

test('input.js handles WASD, Arrows, Space, synthetic CustomEvents, diagonal norm, opposite cancel, blur, and registers 0 touch listeners', () => {
  const doc = createTrackedEventTarget({ hidden: false, visibilityState: 'visible' });
  const win = createTrackedEventTarget({ document: doc });

  const input = createInputController(win);
  for (const t of [...win.registeredTypes, ...doc.registeredTypes]) {
    assert.ok(!t.startsWith('touch') && !t.startsWith('pointer'), `Forbidden listener registered: ${t}`);
  }

  // Native KeyboardEvent-like dispatch with event.code
  const dispatchKey = (target, type, props) => {
    const ev = Object.assign(new Event(type, { bubbles: true, cancelable: true }), props);
    target.dispatchEvent(ev);
    return ev;
  };

  dispatchKey(win, 'keydown', { code: 'KeyW', key: 'w' });
  assert.equal(input.getState().moveZ, -1);
  assert.equal(input.getState().moveX, 0);

  // Diagonal normalization
  dispatchKey(win, 'keydown', { code: 'KeyD', key: 'd' });
  const diag = input.getState();
  assert.ok(Math.abs(Math.hypot(diag.moveX, diag.moveZ) - 1.0) < 1e-9);

  // Opposite-key cancellation (A + D => 0, releasing D => -1)
  dispatchKey(win, 'keyup', { code: 'KeyW', key: 'w' });
  dispatchKey(win, 'keydown', { code: 'KeyA', key: 'a' });
  assert.equal(input.getState().moveX, 0);
  dispatchKey(win, 'keyup', { code: 'KeyD', key: 'd' });
  assert.equal(input.getState().moveX, -1);

  input.clear();
  assert.equal(input.getState().moveX, 0);
  assert.equal(input.getState().moveZ, 0);

  // Host api.js synthetic CustomEvent (no event.code, keyup with repeat: true)
  dispatchKey(doc, 'keydown', { key: 'ArrowUp', keyCode: 38, repeat: false });
  assert.equal(input.getState().moveZ, -1);
  dispatchKey(doc, 'keyup', { key: 'ArrowUp', keyCode: 38, repeat: true });
  assert.equal(input.getState().moveZ, 0);

  // Discrete jump buffer consumption vs held Space
  dispatchKey(win, 'keydown', { code: 'Space', key: ' ', repeat: false });
  assert.equal(input.getState().jumpHeld, true);
  assert.equal(input.getState().consumeJumpPressed(), true);
  assert.equal(input.getState().consumeJumpPressed(), false);

  // Blur clears stuck keys
  win.dispatchEvent(new Event('blur'));
  assert.equal(input.getState().jumpHeld, false);

  input.dispose();
});

test('camera.js enforces 360 yaw, [-15 deg, +80 deg] pitch clamp, [5.5, 45.0] zoom clamp, basis alignment, and 0 touch listeners', () => {
  const win = createTrackedEventTarget({ focus() {} });
  const dom = createTrackedEventTarget({ ownerDocument: { defaultView: win } });
  const threeCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);

  const cam = createCameraController(threeCam, dom);
  for (const t of [...dom.registeredTypes, ...win.registeredTypes]) {
    assert.ok(!t.startsWith('touch') && !t.startsWith('pointer'), `Forbidden camera listener: ${t}`);
  }

  cam.update(0, { x: 0, y: 0, z: 0 });
  const initial = cam.getState();
  assert.equal(initial.yaw, 0);
  assert.ok(Math.abs(initial.pitch - CAMERA_CONFIG.DEFAULT_PITCH) < 1e-9);
  assert.equal(initial.distance, CAMERA_CONFIG.DEFAULT_DISTANCE);

  // Verify basis across full 0..2PI sweep
  for (let i = 0; i < 16; i++) {
    const testYaw = (i * Math.PI) / 8;
    cam.setSpawnYaw(testYaw);
    cam.update(0, { x: 10, y: 2, z: -5 });
    const basis = cam.getMovementBasis();
    const toTargetX = 10 - threeCam.position.x;
    const toTargetZ = -5 - threeCam.position.z;
    const dotFwd = toTargetX * basis.forward.x + toTargetZ * basis.forward.z;
    assert.ok(dotFwd > 0, 'camera-to-target XZ must align strictly with forward');
    const crossY = basis.forward.z * basis.right.x - basis.forward.x * basis.right.z;
    assert.ok(Math.abs(crossY + 1) < 1e-6);
  }

  // Click + drag pitch clamping and unbounded yaw
  cam.setSpawnYaw(0);
  dom.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, clientX: 100, clientY: 100 }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 100 + 2000, clientY: 100 + 5000 }));
  assert.ok(Math.abs(cam.getState().pitch - CAMERA_CONFIG.MAX_PITCH) < 1e-9);
  assert.ok(Math.abs(cam.getState().yaw) > Math.PI * 2);

  win.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 100 + 2000, clientY: 100 - 10000 }));
  assert.ok(Math.abs(cam.getState().pitch - CAMERA_CONFIG.MIN_PITCH) < 1e-9);
  win.dispatchEvent(new Event('mouseup'));

  // Wheel zoom clamping [5.5, 45.0] with preventDefault
  let prevented = false;
  dom.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), {
    deltaY: -50000,
    preventDefault() { prevented = true; },
  }));
  assert.equal(prevented, true);
  cam.update(1.0, { x: 10, y: 2, z: -5 });
  assert.equal(cam.getState().distance, CAMERA_CONFIG.MIN_DISTANCE);

  dom.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 50000 }));
  cam.update(1.0, { x: 10, y: 2, z: -5 });
  assert.equal(cam.getState().distance, CAMERA_CONFIG.MAX_DISTANCE);

  cam.dispose();
});

test('camera.js clears stuck drag on buttons===0 hover and visibilitychange, preserves synthetic MouseEvent(buttons:0) drags, and rejects non-finite inputs', () => {
  const removedFromDoc = [];
  const doc = createTrackedEventTarget({ hidden: false, visibilityState: 'visible' });
  const origDocRemove = doc.removeEventListener.bind(doc);
  doc.removeEventListener = (type, listener, options) => {
    removedFromDoc.push(type);
    return origDocRemove(type, listener, options);
  };
  const win = createTrackedEventTarget({ document: doc, focus() {} });
  doc.defaultView = win;
  const dom = createTrackedEventTarget({ ownerDocument: doc });
  const threeCam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);

  const cam = createCameraController(threeCam, dom);
  assert.ok(doc.registeredTypes.includes('visibilitychange'));
  for (const t of [...dom.registeredTypes, ...win.registeredTypes, ...doc.registeredTypes]) {
    assert.ok(!t.startsWith('touch') && !t.startsWith('pointer'), `Forbidden camera listener: ${t}`);
  }

  cam.update(0, { x: 0, y: 0, z: 0 });

  // 1. Swallowed mouseup: mousedown(buttons:1) -> active move(buttons:1) -> passive hover(buttons:0) clears drag
  dom.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, buttons: 1, clientX: 200, clientY: 200 }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: 260, clientY: 220 }));
  const afterActiveDrag = cam.getState();
  assert.notEqual(afterActiveDrag.yaw, 0);

  // Passive hover with buttons === 0 (without mouseup/blur) must NOT orbit AND must clear drag state
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 0, clientX: 450, clientY: 320 }));
  assert.equal(cam.getState().yaw, afterActiveDrag.yaw);
  assert.equal(cam.getState().pitch, afterActiveDrag.pitch);

  // Even a subsequent mousemove with buttons:1 must not orbit until a new mousedown occurs
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: 600, clientY: 360 }));
  assert.equal(cam.getState().yaw, afterActiveDrag.yaw);

  // 2. Synthetic browser MouseEvent compatibility (buttons:0 on BOTH mousedown and mousemove) still orbits until mouseup
  const beforeSynth = cam.getState().yaw;
  dom.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, buttons: 0, clientX: 300, clientY: 300 }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 0, clientX: 400, clientY: 300 }));
  assert.ok(Math.abs(cam.getState().yaw - (beforeSynth - 100 * CAMERA_CONFIG.ORBIT_SENSITIVITY)) < 1e-9);
  win.dispatchEvent(new Event('mouseup'));

  // 3. ownerDocument visibilitychange (hidden) clears active drag
  dom.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, buttons: 1, clientX: 100, clientY: 100 }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: 140, clientY: 110 }));
  const beforeHidden = cam.getState();
  doc.hidden = true;
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: 300, clientY: 250 }));
  assert.equal(cam.getState().yaw, beforeHidden.yaw);
  assert.equal(cam.getState().pitch, beforeHidden.pitch);
  doc.hidden = false;
  doc.visibilityState = 'visible';

  // 4. Non-finite coordinates & parameters across mousedown, mousemove, wheel, setSpawnYaw, and update
  dom.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, clientX: NaN, clientY: Infinity }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 250, clientY: 250 }));
  assert.equal(cam.getState().yaw, beforeHidden.yaw);

  dom.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, buttons: 1, clientX: 100, clientY: 100 }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: NaN, clientY: 120 }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: Infinity, clientY: -Infinity }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: undefined, clientY: null }));
  assert.equal(cam.getState().yaw, beforeHidden.yaw);
  // Valid move after ignored non-finite moves continues cleanly from (100, 100)
  win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: 200, clientY: 100 }));
  assert.ok(Math.abs(cam.getState().yaw - (beforeHidden.yaw - 100 * CAMERA_CONFIG.ORBIT_SENSITIVITY)) < 1e-9);
  win.dispatchEvent(new Event('mouseup'));

  const distBeforeWheel = cam.getState().distance;
  dom.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: NaN }));
  dom.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: Infinity }));
  dom.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: -Infinity }));
  cam.update(1.0, { x: 4, y: 2, z: -6 });
  assert.equal(cam.getState().distance, distBeforeWheel);

  cam.setSpawnYaw(NaN);
  assert.equal(cam.getState().yaw, CAMERA_CONFIG.DEFAULT_YAW);
  cam.setSpawnYaw(Infinity);
  assert.equal(cam.getState().yaw, CAMERA_CONFIG.DEFAULT_YAW);

  cam.update(NaN, { x: 4, y: 2, z: -6 });
  cam.update(Infinity, { x: 4, y: 2, z: -6 });
  cam.update(-0.5, { x: 4, y: 2, z: -6 });
  cam.update(1 / 60, null);
  cam.update(1 / 60, { x: NaN, y: Infinity, z: -Infinity });

  const finalState = cam.getState();
  const basis = cam.getMovementBasis();
  for (const v of [
    finalState.yaw,
    finalState.pitch,
    finalState.distance,
    finalState.target.x,
    finalState.target.y,
    finalState.target.z,
    threeCam.position.x,
    threeCam.position.y,
    threeCam.position.z,
    threeCam.quaternion.x,
    threeCam.quaternion.y,
    threeCam.quaternion.z,
    threeCam.quaternion.w,
    basis.forward.x,
    basis.forward.z,
    basis.right.x,
    basis.right.z,
  ]) {
    assert.ok(Number.isFinite(v), `Expected finite camera value, got ${v}`);
  }
  assert.equal(finalState.target.x, 4);
  assert.equal(finalState.target.z, -6);

  cam.dispose();
  assert.ok(removedFromDoc.includes('visibilitychange'));
});

test('physics.js reproduces exact Roblox jump height (6.89 studs), WalkSpeed (16.0), Coyote time, step-up, sloped ramp, and platform carry', () => {
  const physics = createPhysicsController();
  const ground = {
    id: 'ground',
    kind: COLLIDER_KIND.SOLID,
    shape: 'box',
    position: { x: 0, y: -1, z: 0 },
    halfExtents: { hx: 100, hy: 1, hz: 100 },
  };

  physics.reset({ x: 0, y: 0, z: 0 }, 0, [ground]);
  assert.equal(physics.step(0, {}, null, [ground]).grounded, true);

  // Jump kinematics check
  let maxY = 0;
  let apexTime = 0;
  let landTime = 0;
  let jumpQueued = true;
  for (let f = 1; f <= 60; f++) {
    const res = physics.step(
      1 / 60,
      {
        moveX: 0,
        moveZ: 0,
        jumpHeld: false,
        consumeJumpPressed: () => {
          const q = jumpQueued;
          jumpQueued = false;
          return q;
        },
      },
      { forward: { x: 0, z: -1 }, right: { x: 1, z: 0 } },
      [ground]
    );
    if (res.position.y > maxY) {
      maxY = res.position.y;
      apexTime = f / 60;
    }
    if (f > 5 && res.grounded && landTime === 0) {
      landTime = f / 60;
      break;
    }
  }
  assert.ok(Math.abs(maxY - 6.8907) < 0.02, `Expected jump height ~6.89, got ${maxY}`);
  assert.ok(Math.abs(apexTime - 0.267) < 0.025, `Expected apex time ~0.265s, got ${apexTime}`);
  assert.ok(Math.abs(landTime - 0.533) < 0.025, `Expected total jump time ~0.53s, got ${landTime}`);

  // Diagonal WalkSpeed capped at 16.0 studs/s
  physics.reset({ x: 0, y: 0, z: 0 }, 0, [ground]);
  let walkRes;
  for (let i = 0; i < 30; i++) {
    walkRes = physics.step(
      1 / 60,
      { moveX: Math.SQRT1_2, moveZ: -Math.SQRT1_2, jumpHeld: false, consumeJumpPressed: () => false },
      { forward: { x: 0, z: -1 }, right: { x: 1, z: 0 } },
      [ground]
    );
  }
  const speedXZ = Math.hypot(walkRes.velocity.x, walkRes.velocity.z);
  assert.ok(Math.abs(speedXZ - 16.0) < 0.005);

  // Rotating +Y cross carry check against THREE.Object3D.matrixWorld
  const rotPad = {
    id: 'rot',
    kind: COLLIDER_KIND.SOLID,
    shape: 'box',
    position: { x: 10, y: -0.5, z: -20 },
    halfExtents: { hx: 8, hy: 0.5, hz: 8 },
    yaw: 0,
    deltaPosition: { x: 0, y: 0, z: 0 },
    deltaYaw: 0,
  };
  physics.reset({ x: 14, y: 0, z: -20 }, 0, [rotPad]);
  const omega = 0.65;
  const dt = 1 / 60;
  let resRot;
  for (let i = 0; i < 60; i++) {
    rotPad.yaw += omega * dt;
    rotPad.deltaYaw = omega * dt;
    resRot = physics.step(dt, {}, null, [rotPad]);
  }
  const refObj = new THREE.Object3D();
  refObj.position.set(10, 0, -20);
  refObj.rotation.y = omega * 1.0;
  refObj.updateMatrixWorld(true);
  const expectedWorld = new THREE.Vector3(4, 0, 0).applyMatrix4(refObj.matrixWorld);
  assert.ok(Math.hypot(resRot.position.x - expectedWorld.x, resRot.position.z - expectedWorld.z) < 1e-6);

  // Section 8 14-degree sloped ramp continuous grounded walk
  const slopePitch = Math.atan2(4.0, 16.0);
  const rampColliders = [
    { id: 'base', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 26, y: 15.5, z: -37.2 }, halfExtents: { hx: 2.2, hy: 0.5, hz: 1.7 } },
    { id: 'ramp', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 26, y: 17.5149, z: -46.9213 }, halfExtents: { hx: 1.6, hy: 0.5, hz: 8.2462 }, yaw: 0, slopePitch },
    { id: 'top', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 26, y: 19.5, z: -55.8 }, halfExtents: { hx: 1.6, hy: 0.5, hz: 1.1 } },
  ];
  physics.reset({ x: 26, y: 16.0, z: -37.2 }, 0, rampColliders);
  let lastRampRes;
  for (let i = 0; i < 90; i++) {
    lastRampRes = physics.step(
      1 / 60,
      { moveX: 0, moveZ: -1, jumpHeld: false, consumeJumpPressed: () => false },
      { forward: { x: 0, z: -1 }, right: { x: 1, z: 0 } },
      rampColliders
    );
    assert.equal(lastRampRes.grounded, true, `Should stay grounded on ramp at frame ${i}`);
    if (lastRampRes.position.z <= -55.5) break;
  }
  assert.ok(Math.abs(lastRampRes.position.y - 20.0) < 0.05);

  // Stationary player hit by moving hazard & hazard suppresses goal/checkpoint
  const sweep = {
    id: 'sweep',
    kind: COLLIDER_KIND.HAZARD,
    shape: 'box',
    position: { x: 0, y: 0.6, z: 0 },
    halfExtents: { hx: 2, hy: 0.4, hz: 0.4 },
  };
  const goal = {
    id: 'goal',
    kind: COLLIDER_KIND.GOAL,
    shape: 'cylinder',
    position: { x: 0, y: 2, z: 0 },
    radius: 4,
    hy: 2,
  };
  physics.reset({ x: 0, y: 0, z: 0 }, 0, [ground]);
  const hazRes = physics.step(1 / 60, {}, null, [ground, sweep, goal]);
  assert.equal(hazRes.hitHazard, true);
  assert.equal(hazRes.reachedGoal, false);
});

test('physics.js handles terminal-velocity drops (box, cylinder, sloped ramp) without side-wall top-snapping, blocks <5.0 low overhangs without floor-sinking, and steps up <=0.60 collider-order-independently', () => {
  const basisNorth = { forward: { x: 0, z: -1 }, right: { x: 1, z: 0 } };
  const wideGround = {
    id: 'wide_ground',
    kind: COLLIDER_KIND.SOLID,
    shape: 'box',
    position: { x: 0, y: -1, z: 0 },
    halfExtents: { hx: 500, hy: 1, hz: 500 },
  };

  // 1a. High-altitude drops (up to TERMINAL_VELOCITY = -120) onto box floors, cylinder drums, stacked cylinders, and 14-deg sloped ramp
  for (const dropHeight of [18.5, 20.0, 28.0, 40.0, 65.0]) {
    const physBox = createPhysicsController();
    physBox.reset({ x: 0, y: dropHeight, z: 0 }, 0, [wideGround]);
    let landedBox = false;
    for (let f = 0; f < 240; f++) {
      const r = physBox.step(1 / 60, {}, basisNorth, [wideGround]);
      assert.ok(Math.hypot(r.position.x, r.position.z) < 1e-6, `Sideways ejection on box drop h=${dropHeight}`);
      if (r.grounded && Math.abs(r.position.y) < 1e-4) {
        landedBox = true;
        break;
      }
    }
    assert.equal(landedBox, true, `Must land cleanly on box floor from h=${dropHeight}`);

    const drum = { id: 'drum', kind: COLLIDER_KIND.SOLID, shape: 'cylinder', position: { x: 0, y: 19.75, z: 0 }, radius: 5.5, hy: 0.75 };
    const hub = { id: 'hub', kind: COLLIDER_KIND.SOLID, shape: 'cylinder', position: { x: 0, y: 20.5, z: 0 }, radius: 0.85, hy: 0.45 };
    for (const cylCols of [[drum], [drum, hub], [hub, drum]]) {
      const targetY = cylCols.length === 1 ? 20.5 : 20.95;
      const physCyl = createPhysicsController();
      physCyl.reset({ x: 0, y: targetY + dropHeight, z: 0 }, 0, cylCols);
      let landedCyl = false;
      for (let f = 0; f < 240; f++) {
        const r = physCyl.step(1 / 60, {}, basisNorth, cylCols);
        assert.ok(Math.hypot(r.position.x, r.position.z) < 1e-6, `Sideways ejection on cylinder drop h=${dropHeight}`);
        if (r.grounded && Math.abs(r.position.y - targetY) < 1e-4) {
          landedCyl = true;
          break;
        }
      }
      assert.equal(landedCyl, true, `Must land cleanly on cylinder solid from h=${dropHeight}`);
    }
  }

  const slopePitch = Math.atan2(4.0, 16.0);
  const slopedRamp = {
    id: 'ramp',
    kind: COLLIDER_KIND.SOLID,
    shape: 'box',
    position: { x: 26, y: 17.5149, z: -46.9213 },
    halfExtents: { hx: 1.6, hy: 0.5, hz: 8.2462 },
    yaw: 0,
    slopePitch,
  };
  for (const dropH of [18.5, 28.0, 45.0]) {
    const physRamp = createPhysicsController();
    physRamp.reset({ x: 26, y: 18.0 + dropH, z: -46.8 }, 0, [slopedRamp]);
    let landedRamp = false;
    for (let f = 0; f < 240; f++) {
      const r = physRamp.step(1 / 60, {}, basisNorth, [slopedRamp]);
      assert.equal(r.fellInVoid, false, `Tunneled through sloped ramp at dropH=${dropH}`);
      if (r.grounded && Math.abs(r.position.y - 18.0) < 0.25) {
        landedRamp = true;
        break;
      }
    }
    assert.equal(landedRamp, true, `Must land cleanly on sloped ramp from dropH=${dropH}`);
  }

  // 1b. Falling rapidly or diagonally into the side of a tall wall (prevY < cMaxY) must NEVER snap upward onto roof
  const tallWall = { id: 'wall', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: 5, z: -4 }, halfExtents: { hx: 4, hy: 5, hz: 2 } };
  const physSide = createPhysicsController();
  physSide.reset({ x: 0, y: 25.0, z: 12.0 }, 0, [wideGround, tallWall]);
  for (let f = 0; f < 180; f++) {
    const before = physSide.step(0, {}, basisNorth, [wideGround, tallWall]);
    const r = physSide.step(1 / 60, { moveX: 0, moveZ: -1, jumpHeld: false, consumeJumpPressed: () => false }, basisNorth, [wideGround, tallWall]);
    if (before.position.y < 10.0) {
      assert.ok(!(r.grounded && Math.abs(r.position.y - 10.0) < 0.1), 'Must not snap onto top of 10-stud wall from side');
    }
    assert.ok(r.position.z >= -1.1501, 'Must block horizontally at tall wall face');
  }

  // Diagonal terminal-velocity side-wall contact sweep on BOTH box and cylinder colliders (Bug #2 regression)
  const diagBoxWall = { id: 'diag_box', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: 5.0, z: 0 }, halfExtents: { hx: 2.0, hy: 5.0, hz: 2.0 } };
  const diagCylWall = { id: 'diag_cyl', kind: COLLIDER_KIND.SOLID, shape: 'cylinder', position: { x: 0, y: 5.0, z: 0 }, radius: 2.0, hy: 5.0 };
  for (const [shapeLabel, col] of [['box', diagBoxWall], ['cylinder', diagCylWall]]) {
    for (let startX = -11.95; startX <= -11.75; startX += 0.02) {
      const ctrl = createPhysicsController();
      ctrl.reset({ x: startX, y: 46.22, z: 0 }, 0, []);
      let prev = { position: { x: startX, y: 46.22, z: 0 } };
      for (let f = 0; f < 100; f++) {
        const cur = ctrl.step(1 / 120, { moveX: 1, moveZ: 0, jumpHeld: false }, basisNorth, [col]);
        if (prev.position.x < -(2.0 + PHYSICS_CONFIG.PLAYER_RADIUS) && prev.position.y < 10.0) {
          assert.ok(
            !(cur.grounded && Math.abs(cur.position.y - 10.0) < 0.05),
            `Diagonal side-wall contact on ${shapeLabel} (startX=${startX.toFixed(2)}, prevY=${prev.position.y.toFixed(4)}) must not snap onto roof`
          );
        }
        prev = cur;
      }
    }
  }

  // Airborne jump into a 7.45-stud wall must NEVER step-up vault onto top (Bug #3 regression; maxY <= 7.05)
  const wall745 = { id: 'wall_745', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: 3.725, z: -8.0 }, halfExtents: { hx: 3.0, hy: 3.725, hz: 2.0 } };
  for (let startZ = -1.0; startZ >= -5.0; startZ -= 0.1) {
    const ctrl = createPhysicsController();
    ctrl.reset({ x: 0, y: 0, z: startZ }, 0, [wideGround, wall745]);
    let maxJumpY = 0;
    for (let f = 0; f < 60; f++) {
      const cur = ctrl.step(1 / 120, { moveX: 0, moveZ: -1, jumpHeld: f === 0 }, basisNorth, [wideGround, wall745]);
      maxJumpY = Math.max(maxJumpY, cur.position.y);
      assert.ok(
        !(cur.grounded && Math.abs(cur.position.y - 7.45) < 0.05),
        `Airborne jump from startZ=${startZ.toFixed(1)} must never vault onto 7.45-stud wall`
      );
    }
    assert.ok(maxJumpY <= 7.05, `Expected max jump Y <= 7.05 against 7.45-stud wall, got ${maxJumpY}`);
  }

  // 2. Low overhang (< 5.0 studs) blocks horizontal walk without floor sinking, >= 5.0 passes, and upward jump bonks cleanly
  for (const order of ['ground_first', 'roof_first']) {
    for (const cMinY of [4.88, 4.90, 4.95, 4.99, 5.00, 5.05]) {
      const roof = { id: 'roof', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: cMinY + 0.5, z: -4.0 }, halfExtents: { hx: 3, hy: 0.5, hz: 2 } };
      const cols = order === 'ground_first' ? [wideGround, roof] : [roof, wideGround];
      const phys = createPhysicsController();
      phys.reset({ x: 0, y: 0, z: 0 }, 0, cols);
      let minY = 0;
      let passedUnder = false;
      for (let f = 0; f < 60; f++) {
        const r = phys.step(1 / 60, { moveX: 0, moveZ: -1, jumpHeld: false, consumeJumpPressed: () => false }, basisNorth, cols);
        minY = Math.min(minY, r.position.y);
        if (r.position.z < -3.5) passedUnder = true;
      }
      assert.ok(minY >= -1e-6, `Must never sink below floor at cMinY=${cMinY} (${order}), got minY=${minY}`);
      assert.equal(passedUnder, cMinY >= 5.0, `Unexpected passage at cMinY=${cMinY} (${order})`);
    }
  }

  // Upward jump head-bonk against cMinY = 6.20 clamps head <= 6.20 and zeroes vy
  const ceiling = { id: 'ceil', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: 6.7, z: 0 }, halfExtents: { hx: 4, hy: 0.5, hz: 4 } };
  const physBonk = createPhysicsController();
  physBonk.reset({ x: 0, y: 0, z: 0 }, 0, [wideGround, ceiling]);
  let jumpOnce = true;
  let maxHeadY = 0;
  let returnedToGround = false;
  for (let f = 0; f < 60; f++) {
    const r = physBonk.step(
      1 / 60,
      { moveX: 0, moveZ: 0, jumpHeld: false, consumeJumpPressed: () => { const q = jumpOnce; jumpOnce = false; return q; } },
      basisNorth,
      [wideGround, ceiling]
    );
    maxHeadY = Math.max(maxHeadY, r.position.y + PHYSICS_CONFIG.PLAYER_HEIGHT);
    if (f > 5 && r.grounded && Math.abs(r.position.y) < 1e-4) {
      returnedToGround = true;
      break;
    }
  }
  assert.ok(maxHeadY <= 6.20 + 1e-5 && maxHeadY > 6.0, `Expected head bonk at 6.20, got ${maxHeadY}`);
  assert.equal(returnedToGround, true);

  // 3. Exact STEP_HEIGHT = 0.60 collider-order & elevation independence + headroom/stacked-wall block
  for (const baseY of [0.0, 2.5]) {
    const g = { id: 'g', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: baseY - 1, z: 0 }, halfExtents: { hx: 100, hy: 1, hz: 100 } };
    for (const h of [0.59, 0.595, 0.60, 0.605, 0.61]) {
      for (const order of ['ground_first', 'ledge_first']) {
        const ledge = { id: 'ledge', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: baseY + h / 2, z: -22.0 }, halfExtents: { hx: 6, hy: h / 2, hz: 20 } };
        const cols = order === 'ground_first' ? [g, ledge] : [ledge, g];
        const phys = createPhysicsController();
        phys.reset({ x: 0, y: baseY, z: 0 }, 0, cols);
        let r;
        for (let f = 0; f < 30; f++) {
          r = phys.step(1 / 60, { moveX: 0, moveZ: -1, jumpHeld: false, consumeJumpPressed: () => false }, basisNorth, cols);
        }
        const climbed = Math.abs(r.position.y - (baseY + h)) < 1e-4 && r.position.z < -2.5;
        assert.equal(climbed, h <= 0.60, `Step h=${h} at baseY=${baseY} (${order}): climbed=${climbed}`);
      }
    }
  }

  // Headroom-blocked step-up (4.80 roof over 0.50 step) must block in both collider orders
  const step05 = { id: 's05', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: 0.25, z: -10 }, halfExtents: { hx: 4, hy: 0.25, hz: 8 } };
  const lowRoof = { id: 'lr', kind: COLLIDER_KIND.SOLID, shape: 'box', position: { x: 0, y: 5.3, z: -10 }, halfExtents: { hx: 4, hy: 0.5, hz: 8 } };
  for (const cols of [[wideGround, step05, lowRoof], [lowRoof, step05, wideGround], [step05, lowRoof, wideGround]]) {
    const phys = createPhysicsController();
    phys.reset({ x: 0, y: 0, z: 0 }, 0, cols);
    let r;
    for (let f = 0; f < 30; f++) {
      r = phys.step(1 / 60, { moveX: 0, moveZ: -1, jumpHeld: false, consumeJumpPressed: () => false }, basisNorth, cols);
    }
    assert.ok(r.position.y < 0.01 && r.position.z >= -1.1501, `Step-up must abort when headroom < 5.0: ${JSON.stringify(r.position)}`);
  }
});

test('player.js loads real Snowball elf-animated.gltf with 0 warnings across idle, run, jump, celebrate, and contact shadow', async () => {
  const gltfPath = path.join(REPO_ROOT, 'static/scenes/snowball/models/elf-animated.gltf');
  const binPath = path.join(REPO_ROOT, 'static/scenes/snowball/models/elf-animated.bin');
  const gltfJson = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  const binBuf = fs.readFileSync(binPath);

  globalThis.ProgressEvent ??= Event;
  // Embed .bin as data URI and strip image URI so GLTFLoader.parseAsync runs purely in Node without DOM Image
  gltfJson.buffers[0].uri = `data:application/octet-stream;base64,${binBuf.toString('base64')}`;
  delete gltfJson.images;
  delete gltfJson.textures;
  if (gltfJson.materials) {
    for (const mat of gltfJson.materials) {
      if (mat.pbrMetallicRoughness) {
        delete mat.pbrMetallicRoughness.baseColorTexture;
      }
    }
  }

  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(JSON.stringify(gltfJson), '');
    const scene = new THREE.Scene();
    const elf = await loadElfPlayer({ scene, gltf });

    const pad = {
      id: 'pad',
      kind: COLLIDER_KIND.SOLID,
      shape: 'box',
      position: { x: 0, y: -0.6, z: 0 },
      halfExtents: { hx: 6, hy: 0.6, hz: 6 },
    };

    elf.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, facingYaw: 0 }, {}, [pad]);
    assert.equal(elf.getAnimState(), 'idle');
    assert.equal(elf.shadowMesh.visible, true);

    elf.update(1 / 60, { position: { x: 0, y: 0, z: -1 }, velocity: { x: 0, y: 0, z: -16 }, grounded: true, facingYaw: 0 }, {}, [pad]);
    assert.equal(elf.getAnimState(), 'run');

    elf.update(1 / 60, { position: { x: 0, y: 4, z: -2 }, velocity: { x: 0, y: 30, z: -16 }, grounded: false, facingYaw: 0 }, {}, [pad]);
    assert.equal(elf.getAnimState(), 'jump');
    // Idempotent dt === 0 render-only update check
    elf.update(0, { position: { x: 0, y: 4, z: -2 }, velocity: { x: 0, y: 30, z: -16 }, grounded: false, facingYaw: 0 }, {}, [pad]);
    assert.equal(elf.getAnimState(), 'jump');

    // Over open void: shadow hides cleanly
    elf.update(1 / 60, { position: { x: 50, y: 4, z: 50 }, velocity: { x: 0, y: -10, z: 0 }, grounded: false, facingYaw: 0 }, {}, [pad]);
    assert.equal(elf.shadowMesh.visible, false);

    elf.triggerCelebrate();
    elf.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, facingYaw: 0 }, { celebrating: true }, [pad]);
    assert.equal(elf.getAnimState(), 'celebrate');

    elf.resetPose();
    assert.equal(elf.getAnimState(), 'idle');
    elf.dispose();
  } finally {
    console.warn = origWarn;
  }
  assert.deepEqual(warnings, [], 'loadElfPlayer must emit zero console warnings');
});

test('player.js airborne pose stays stable across a full jump (no compounding leg spin)', async () => {
  const gltfJson = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'static/scenes/snowball/models/elf-animated.gltf'), 'utf8')
  );
  const binBuf = fs.readFileSync(path.join(REPO_ROOT, 'static/scenes/snowball/models/elf-animated.bin'));
  globalThis.ProgressEvent ??= Event;
  gltfJson.buffers[0].uri = `data:application/octet-stream;base64,${binBuf.toString('base64')}`;
  delete gltfJson.images;
  delete gltfJson.textures;
  for (const mat of gltfJson.materials || []) {
    if (mat.pbrMetallicRoughness) delete mat.pbrMetallicRoughness.baseColorTexture;
  }
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(gltfJson), '');
  const elf = await loadElfPlayer({ scene: new THREE.Scene(), gltf });
  const bones = {};
  elf.root.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
  });
  const legBones = ['elf_rig_thighL', 'elf_rig_thighR', 'elf_rig_shinL', 'elf_rig_shinR'];

  for (let i = 0; i < 20; i++) {
    elf.update(1 / 60, { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: -16 }, grounded: true, facingYaw: 0 });
  }
  let vy = PHYSICS_CONFIG.JUMP_VELOCITY;
  const settled = {};
  for (let i = 0; i < 60; i++) {
    vy = Math.max(PHYSICS_CONFIG.TERMINAL_VELOCITY, vy + PHYSICS_CONFIG.GRAVITY / 60);
    elf.update(1 / 60, { position: { x: 0, y: 2, z: 0 }, velocity: { x: 0, y: vy, z: -16 }, grounded: false, facingYaw: 0 });
    if (i === 10) {
      for (const name of legBones) settled[name] = bones[name].quaternion.clone();
    }
    if (i > 10) {
      for (const name of legBones) {
        const angle = bones[name].quaternion.angleTo(settled[name]);
        assert.ok(angle < 1.0, `${name} drifted ${angle.toFixed(3)} rad at airborne frame ${i}`);
      }
    }
  }
  elf.dispose();
});
