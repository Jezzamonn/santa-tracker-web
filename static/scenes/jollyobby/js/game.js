/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Main game orchestrator, fixed-step loop, checkpoint/respawn/completion state
 * machine, and strictly read-only `window.__TEST_CONTROL__` telemetry bridge
 * for Santa Tracker: Jolly Obby.
 */

import * as THREE from 'three';
import {
  TOTAL_SECTIONS,
  PHYSICS_CONFIG,
  CAMERA_CONFIG,
  SOUND_EVENTS,
} from './constants.js';
import { createHostBridge } from './host-bridge.js';
import { createInputController } from './input.js';
import { createCameraController } from './camera.js';
import { createPhysicsController } from './physics.js';
import { loadElfPlayer } from './player.js';
import { createEnvironment } from './environment.js';
import { loadPropsLibrary } from './props.js';
import { createEffectsManager } from './effects.js';
import { createCourse } from './course.js';

const MANUAL_FRAME_DT = 1 / 60;

function deepFreeze(obj) {
  if (!obj || typeof obj !== 'object' || Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

function defaultRendererFactory(targetWindow) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const dpr = Math.min((targetWindow && targetWindow.devicePixelRatio) || 1, 2);
  renderer.setPixelRatio(dpr);
  return renderer;
}

export function createJollyObbyGame({
  container,
  targetWindow = globalThis.window,
  hostBridge = null,
  rendererFactory = defaultRendererFactory,
  gltfUrl = '../snowball/models/elf-animated.gltf',
  preloadedGltf = null,
  objBasePath = '../snowbox/models/',
  preloadedPropsLibrary = null,
  skyboxBasePath = '../snowbox/img/skybox_v09/',
  enableCubemapLoad,
} = {}) {
  const bridge = hostBridge || createHostBridge({ targetWindow });
  const scene = new THREE.Scene();

  const threeCamera = new THREE.PerspectiveCamera(
    CAMERA_CONFIG.FOV,
    16 / 9,
    0.2,
    900
  );

  const state = {
    ready: false,
    paused: false,
    completed: false,
    currentSection: 1,
    activeCheckpoint: 0,
    courseElapsed: 0,
    player: {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: true,
      facingYaw: 0,
      animState: 'idle',
    },
    camera: {
      yaw: CAMERA_CONFIG.DEFAULT_YAW,
      pitch: CAMERA_CONFIG.DEFAULT_PITCH,
      distance: CAMERA_CONFIG.DEFAULT_DISTANCE,
    },
    checkpoints: [],
    finishGoal: { position: { x: 82.0, y: 28.0, z: -56.0 }, radius: 5.5 },
    sectionWaypoints: [],
  };

  let renderer = null;
  let environment = null;
  let effects = null;
  let course = null;
  let playerAvatar = null;
  let input = null;
  let cameraCtrl = null;
  let physics = null;
  let rafId = null;
  let lastFrameMs = null;
  let disposed = false;

  function syncTelemetryFromSubsystems() {
    if (playerAvatar) {
      state.player.animState = playerAvatar.getAnimState();
    }
    if (cameraCtrl) {
      const cs = cameraCtrl.getState();
      state.camera.yaw = cs.yaw;
      state.camera.pitch = cs.pitch;
      state.camera.distance = cs.distance;
    }
  }

  function renderScene() {
    if (!renderer) return;
    syncTelemetryFromSubsystems();
    renderer.render(scene, threeCamera);
  }

  function handleResize() {
    if (!renderer) return;
    const width = Math.max(
      1,
      (container && container.clientWidth) || (targetWindow && targetWindow.innerWidth) || 800
    );
    const height = Math.max(
      1,
      (container && container.clientHeight) || (targetWindow && targetWindow.innerHeight) || 600
    );
    threeCamera.aspect = width / height;
    threeCamera.updateProjectionMatrix();
    if (typeof renderer.setPixelRatio === 'function') {
      renderer.setPixelRatio(Math.min((targetWindow && targetWindow.devicePixelRatio) || 1, 2));
    }
    renderer.setSize(width, height, false);
    if (state.ready) {
      renderScene();
    }
  }

  function placePlayerAtCheckpoint(cpIndex) {
    const cp = course.checkpoints[cpIndex] || course.checkpoints[0];
    physics.reset(cp.spawnPosition, cp.spawnYaw, course.colliders);
    state.player.position = { ...cp.spawnPosition };
    state.player.velocity = { x: 0, y: 0, z: 0 };
    state.player.grounded = true;
    state.player.facingYaw = cp.spawnYaw;
    cameraCtrl.setSpawnYaw(cp.spawnYaw);
    cameraCtrl.update(0, cp.spawnPosition);
  }

  function stepSimulation(rawDt) {
    if (!state.ready || state.paused) return;
    const dt = Math.min(PHYSICS_CONFIG.MAX_FRAME_DT, Math.max(0, Number(rawDt) || 0));
    if (dt <= 0) return;

    state.courseElapsed += dt;
    course.update(dt, state.courseElapsed);
    environment.update(dt, state.courseElapsed);

    if (state.completed) {
      // Controls are frozen after Section 10 completion while celebration continues
      state.player.velocity = { x: 0, y: 0, z: 0 };
      playerAvatar.update(dt, state.player, { celebrating: true }, course.colliders);
      cameraCtrl.update(dt, state.player.position);
      effects.update(dt);
      syncTelemetryFromSubsystems();
      return;
    }

    const inputState = input.getState();
    const cameraBasis = cameraCtrl.getMovementBasis();
    const res = physics.step(dt, inputState, cameraBasis, course.colliders);

    if (res.jumped) {
      bridge.playSound(SOUND_EVENTS.JUMP);
    }

    if (res.hitHazard || res.fellInVoid) {
      // Respawn at latest active checkpoint without resetting section progress
      placePlayerAtCheckpoint(state.activeCheckpoint);
      bridge.playSound(SOUND_EVENTS.RESPAWN);
      effects.emitRespawnPop(state.player.position);
      playerAvatar.update(dt, state.player, { celebrating: false }, course.colliders);
      effects.update(dt);
      syncTelemetryFromSubsystems();
      return;
    }

    state.player.position = res.position;
    state.player.velocity = res.velocity;
    state.player.grounded = res.grounded;
    state.player.facingYaw = res.facingYaw;

    if (res.touchedCheckpoint !== null && res.touchedCheckpoint > state.activeCheckpoint) {
      state.activeCheckpoint = res.touchedCheckpoint;
      state.currentSection = Math.max(state.currentSection, state.activeCheckpoint + 1);
      course.setActiveCheckpoint(state.activeCheckpoint);
      bridge.setSectionLevel(state.currentSection);
      bridge.playSound(SOUND_EVENTS.CHECKPOINT);
      const cp = course.checkpoints[state.activeCheckpoint];
      if (cp) {
        effects.emitCheckpointBurst(cp.spawnPosition);
        // Ease the camera around to face the next section's direction.
        cameraCtrl.turnToYaw(cp.spawnYaw);
      }
    }

    if (res.reachedGoal) {
      state.activeCheckpoint = TOTAL_SECTIONS - 1;
      state.currentSection = TOTAL_SECTIONS;
      state.completed = true;
      course.setActiveCheckpoint(TOTAL_SECTIONS - 1);
      input.clear();
      state.player.velocity = { x: 0, y: 0, z: 0 };
      state.player.grounded = true;
      playerAvatar.triggerCelebrate();
      effects.emitGoalCelebration(course.finishGoal.position);
      bridge.triggerCompletion();
    }

    playerAvatar.update(dt, state.player, { celebrating: state.completed }, course.colliders);
    cameraCtrl.update(dt, state.player.position);
    effects.update(dt);
    syncTelemetryFromSubsystems();
  }

  function advanceTime(seconds) {
    const duration = Number(seconds);
    if (!Number.isFinite(duration) || duration <= 0 || !state.ready) {
      return;
    }
    let remaining = duration;
    while (remaining > 1e-9 && !state.paused) {
      const dt = Math.min(MANUAL_FRAME_DT, remaining);
      stepSimulation(dt);
      remaining -= dt;
    }
    renderScene();
  }

  function getSnapshot() {
    syncTelemetryFromSubsystems();
    return deepFreeze({
      ready: Boolean(state.ready),
      paused: Boolean(state.paused),
      completed: Boolean(state.completed),
      currentSection: Number(state.currentSection),
      activeCheckpoint: Number(state.activeCheckpoint),
      player: {
        x: Number(state.player.position.x),
        y: Number(state.player.position.y),
        z: Number(state.player.position.z),
        vx: Number(state.player.velocity.x),
        vy: Number(state.player.velocity.y),
        vz: Number(state.player.velocity.z),
        grounded: Boolean(state.player.grounded),
        facingYaw: Number(state.player.facingYaw),
        animState: String(state.player.animState),
      },
      camera: {
        yaw: Number(state.camera.yaw),
        pitch: Number(state.camera.pitch),
        distance: Number(state.camera.distance),
      },
      checkpoints: state.checkpoints.map((cp) => ({
        index: Number(cp.index),
        x: Number(cp.spawnPosition.x),
        y: Number(cp.spawnPosition.y),
        z: Number(cp.spawnPosition.z),
        yaw: Number(cp.spawnYaw),
      })),
      finishGoal: {
        x: Number(state.finishGoal.position.x),
        y: Number(state.finishGoal.position.y),
        z: Number(state.finishGoal.position.z),
        radius: Number(state.finishGoal.radius),
      },
      sectionWaypoints: state.sectionWaypoints.map((wp) => ({
        section: Number(wp.section),
        x: Number(wp.x),
        y: Number(wp.y),
        z: Number(wp.z),
        kind: String(wp.kind),
      })),
    });
  }

  // Expose frozen read-only test control synchronously before api.ready resolves
  const testControl = Object.freeze({
    isReady: () => Boolean(state.ready),
    advanceTime,
    getSnapshot,
  });

  if (targetWindow && !Object.prototype.hasOwnProperty.call(targetWindow, '__TEST_CONTROL__')) {
    Object.defineProperty(targetWindow, '__TEST_CONTROL__', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: testControl,
    });
  }
  if (targetWindow && !Object.prototype.hasOwnProperty.call(targetWindow, '__JOLLYOBBY_STATE__')) {
    Object.defineProperty(targetWindow, '__JOLLYOBBY_STATE__', {
      configurable: false,
      enumerable: true,
      get: getSnapshot,
    });
  }

  // Register 3D asset preload with host interlude
  const assetPreloadPromise = Promise.all([
    loadElfPlayer({ scene, gltfUrl, gltf: preloadedGltf }),
    preloadedPropsLibrary
      ? Promise.resolve(preloadedPropsLibrary)
      : loadPropsLibrary({ objBasePath }),
  ]);
  bridge.waitPreload(assetPreloadPromise);

  function resetFullRun() {
    if (!state.ready) return;
    state.completed = false;
    state.paused = false;
    state.activeCheckpoint = 0;
    state.currentSection = 1;
    state.courseElapsed = 0;
    input.clear();
    cameraCtrl.clearDrag();
    course.resetCheckpoints();
    effects.reset();
    placePlayerAtCheckpoint(0);
    playerAvatar.resetPose();
    playerAvatar.update(0, state.player, { celebrating: false }, course.colliders);
    lastFrameMs = null;
    renderScene();
  }

  const offPause = bridge.onPause(() => {
    state.paused = true;
    if (input) input.clear();
    if (cameraCtrl) cameraCtrl.clearDrag();
  });

  const offResume = bridge.onResume(() => {
    if (!state.paused) {
      return;
    }
    state.paused = false;
    if (input) input.clear();
    lastFrameMs = null;
    if (state.ready) {
      renderScene();
    }
  });

  const offRestart = bridge.onRestart(() => {
    resetFullRun();
  });

  const offMute = bridge.onMuteChange(() => {
    // Klang audio mute state is managed by host kplay; focus is reclaimed by host-bridge
  });

  function onAnimationFrame(nowMs) {
    if (disposed) return;
    if (targetWindow && typeof targetWindow.requestAnimationFrame === 'function') {
      rafId = targetWindow.requestAnimationFrame(onAnimationFrame);
    }
    if (targetWindow && targetWindow.__MANUAL_TIME__) {
      lastFrameMs = nowMs;
      return;
    }
    if (lastFrameMs === null) {
      lastFrameMs = nowMs;
      return;
    }
    const dt = Math.min(PHYSICS_CONFIG.MAX_FRAME_DT, Math.max(0, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;
    if (!state.paused) {
      stepSimulation(dt);
      renderScene();
    }
  }

  bridge.onReady(async () => {
    if (disposed) return;
    const [loadedAvatar, loadedProps] = await assetPreloadPromise;
    playerAvatar = loadedAvatar;

    renderer = rendererFactory(targetWindow);
    if (container && renderer && renderer.domElement) {
      if (typeof container.replaceChildren === 'function') {
        container.replaceChildren(renderer.domElement);
      } else {
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
        container.appendChild(renderer.domElement);
      }
    }

    environment = createEnvironment({
      scene,
      skyboxBasePath,
      ...(enableCubemapLoad !== undefined ? { enableCubemapLoad } : {}),
    });
    course = createCourse({ scene, propsLibrary: loadedProps });
    effects = createEffectsManager({
      scene,
      goalPosition: course.finishGoal.position,
    });

    state.checkpoints = course.checkpoints;
    state.finishGoal = course.finishGoal;
    state.sectionWaypoints = course.sectionWaypoints;

    input = createInputController(targetWindow);
    cameraCtrl = createCameraController(
      threeCamera,
      (renderer && renderer.domElement) || container,
      CAMERA_CONFIG
    );
    physics = createPhysicsController(PHYSICS_CONFIG);

    handleResize();
    if (targetWindow && typeof targetWindow.addEventListener === 'function') {
      targetWindow.addEventListener('resize', handleResize);
    }

    placePlayerAtCheckpoint(0);
    playerAvatar.resetPose();
    playerAvatar.update(0, state.player, { celebrating: false }, course.colliders);
    bridge.setSectionLevel(1);

    state.ready = true;
    renderScene();

    if (
      targetWindow &&
      !targetWindow.__MANUAL_TIME__ &&
      typeof targetWindow.requestAnimationFrame === 'function'
    ) {
      rafId = targetWindow.requestAnimationFrame(onAnimationFrame);
    }
  });

  function dispose() {
    disposed = true;
    if (rafId !== null && targetWindow && typeof targetWindow.cancelAnimationFrame === 'function') {
      targetWindow.cancelAnimationFrame(rafId);
    }
    if (targetWindow && typeof targetWindow.removeEventListener === 'function') {
      targetWindow.removeEventListener('resize', handleResize);
    }
    offPause();
    offResume();
    offRestart();
    offMute();
    if (input) input.dispose();
    if (cameraCtrl) cameraCtrl.dispose();
    if (playerAvatar) playerAvatar.dispose();
    if (effects) effects.dispose();
    if (environment) environment.dispose();
    if (renderer && typeof renderer.dispose === 'function') {
      renderer.dispose();
    }
  }

  return Object.freeze({
    testControl,
    dispose,
  });
}
