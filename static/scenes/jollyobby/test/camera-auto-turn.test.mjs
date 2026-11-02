import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { CAMERA_CONFIG } from '../js/constants.js';
import { createCoroutineRunner, tween, easeInOutCubic } from '../js/coroutine.js';
import { createCameraController } from '../js/camera.js';

function createCameraHarness() {
  const win = new EventTarget();
  win.focus = () => {};
  const dom = new EventTarget();
  dom.ownerDocument = { defaultView: win };
  const cam = createCameraController(new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000), dom);
  cam.update(0, { x: 0, y: 0, z: 0 });
  return { win, dom, cam };
}

function stepCamera(cam, seconds, dt = 1 / 60) {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const step = Math.min(dt, remaining);
    cam.update(step, { x: 0, y: 0, z: 0 });
    remaining -= step;
  }
}

test('coroutine runner advances on update(dt), passes dt to yield, and supports cancel', () => {
  const runner = createCoroutineRunner();
  const seen = [];
  let finished = false;
  let cleanedUp = false;
  const handle = runner.start(function* () {
    try {
      seen.push(yield);
      seen.push(yield);
      finished = true;
    } finally {
      cleanedUp = true;
    }
  });

  // Body does not run synchronously on start.
  assert.deepEqual(seen, []);
  runner.update(0.1); // Runs to first yield.
  runner.update(0.2);
  assert.deepEqual(seen, [0.2]);
  assert.equal(handle.isDone(), false);
  runner.update(0.3);
  assert.deepEqual(seen, [0.2, 0.3]);
  assert.equal(finished, true);
  assert.equal(handle.isDone(), true);
  assert.equal(runner.isIdle(), true);
  assert.equal(cleanedUp, true);

  cleanedUp = false;
  const cancelled = runner.start(function* () {
    try {
      while (true) yield;
    } finally {
      cleanedUp = true;
    }
  });
  runner.update(0.1);
  cancelled.cancel();
  assert.equal(cancelled.isDone(), true);
  assert.equal(cleanedUp, true);
  runner.update(0.1);
  assert.equal(runner.isIdle(), true);
});

test('tween eases monotonically from 0 to exactly 1 over its duration', () => {
  const runner = createCoroutineRunner();
  const values = [];
  runner.start(function* () {
    yield* tween(0.5, (t) => values.push(t));
  });
  for (let i = 0; i < 60; i++) runner.update(1 / 60);
  assert.equal(values[values.length - 1], 1);
  for (let i = 1; i < values.length; i++) {
    assert.ok(values[i] >= values[i - 1]);
  }
  assert.ok(values.length === 30 || values.length === 31, `unexpected frame count ${values.length}`);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);
});

test('camera turnToYaw eases to the goal over AUTO_TURN_DURATION along the shortest arc', () => {
  const { cam } = createCameraHarness();
  cam.setSpawnYaw(0);
  cam.turnToYaw(-Math.PI / 2);

  assert.equal(cam.getState().autoTurning, true);
  assert.equal(cam.getState().yaw, 0, 'turn must not snap immediately');

  stepCamera(cam, CAMERA_CONFIG.AUTO_TURN_DURATION / 2);
  const mid = cam.getState().yaw;
  assert.ok(mid < -0.1 && mid > -Math.PI / 2 + 0.1, `mid-turn yaw ${mid} should be partway`);

  stepCamera(cam, CAMERA_CONFIG.AUTO_TURN_DURATION);
  assert.ok(Math.abs(cam.getState().yaw - -Math.PI / 2) < 1e-9);
  assert.equal(cam.getState().autoTurning, false);

  // Shortest arc: from just below +PI to -PI/2 wraps forward (+) rather than back.
  cam.setSpawnYaw(Math.PI * 0.9);
  cam.turnToYaw(-Math.PI * 0.9);
  stepCamera(cam, CAMERA_CONFIG.AUTO_TURN_DURATION * 2);
  assert.ok(Math.abs(cam.getState().yaw - Math.PI * 1.1) < 1e-9);
  cam.dispose();
});

test('camera auto-turn is cancelled by drag-orbit, scroll-zoom, and setSpawnYaw', () => {
  const half = CAMERA_CONFIG.AUTO_TURN_DURATION / 2;

  // Drag start cancels.
  {
    const { win, dom, cam } = createCameraHarness();
    cam.turnToYaw(Math.PI);
    stepCamera(cam, half);
    dom.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, buttons: 1, clientX: 10, clientY: 10 }));
    const frozen = cam.getState().yaw;
    assert.equal(cam.getState().autoTurning, false);
    stepCamera(cam, CAMERA_CONFIG.AUTO_TURN_DURATION);
    assert.equal(cam.getState().yaw, frozen);
    win.dispatchEvent(new Event('mouseup'));
    cam.dispose();
  }

  // Drag already in progress when the turn starts: first movement cancels.
  {
    const { win, dom, cam } = createCameraHarness();
    dom.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, buttons: 1, clientX: 10, clientY: 10 }));
    cam.turnToYaw(Math.PI);
    stepCamera(cam, half);
    win.dispatchEvent(Object.assign(new Event('mousemove'), { buttons: 1, clientX: 20, clientY: 10 }));
    assert.equal(cam.getState().autoTurning, false);
    const frozen = cam.getState().yaw;
    stepCamera(cam, CAMERA_CONFIG.AUTO_TURN_DURATION);
    assert.equal(cam.getState().yaw, frozen);
    win.dispatchEvent(new Event('mouseup'));
    cam.dispose();
  }

  // Scroll-zoom cancels.
  {
    const { dom, cam } = createCameraHarness();
    cam.turnToYaw(Math.PI);
    stepCamera(cam, half);
    dom.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 100 }));
    const frozen = cam.getState().yaw;
    stepCamera(cam, CAMERA_CONFIG.AUTO_TURN_DURATION);
    assert.equal(cam.getState().yaw, frozen);
    cam.dispose();
  }

  // Respawn snap cancels.
  {
    const { cam } = createCameraHarness();
    cam.turnToYaw(Math.PI);
    stepCamera(cam, half);
    cam.setSpawnYaw(0.25);
    stepCamera(cam, CAMERA_CONFIG.AUTO_TURN_DURATION);
    assert.equal(cam.getState().yaw, 0.25);
    cam.dispose();
  }
});
