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
 * Mouse-only spherical third-person orbit & scroll-wheel zoom camera controller (R4).
 */

import { CAMERA_CONFIG } from './constants.js';
import { createCoroutineRunner, tween } from './coroutine.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Wraps an angle difference into [-PI, PI) so turns take the shortest path. */
function shortestAngleDelta(from, to) {
  const twoPi = Math.PI * 2;
  let delta = (to - from) % twoPi;
  if (delta >= Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return delta;
}

export function createCameraController(threeCamera, domElement, config = CAMERA_CONFIG) {
  let yaw = config.DEFAULT_YAW;
  let pitch = config.DEFAULT_PITCH;
  let distance = config.DEFAULT_DISTANCE;
  let targetDistance = config.DEFAULT_DISTANCE;

  // Automatic camera motions (e.g. turning toward a new checkpoint) run as
  // coroutines on the simulation clock; any user camera input cancels them.
  const coroutines = createCoroutineRunner();
  let autoTurn = null;

  let initializedTarget = false;
  const target = { x: 0, y: config.TARGET_HEIGHT_OFFSET, z: 0 };

  let isDragging = false;
  let dragCheckButtons = false;
  let lastClientX = 0;
  let lastClientY = 0;

  const ownerWindow =
    (domElement && domElement.ownerDocument && domElement.ownerDocument.defaultView) ||
    globalThis.window ||
    null;
  const ownerDocument =
    (domElement &&
    domElement.ownerDocument &&
    typeof domElement.ownerDocument.addEventListener === 'function'
      ? domElement.ownerDocument
      : null) ||
    (ownerWindow &&
    ownerWindow.document &&
    typeof ownerWindow.document.addEventListener === 'function'
      ? ownerWindow.document
      : null);

  function applyCameraTransform() {
    if (!Number.isFinite(yaw)) yaw = config.DEFAULT_YAW;
    if (!Number.isFinite(pitch)) pitch = config.DEFAULT_PITCH;
    pitch = clamp(pitch, config.MIN_PITCH, config.MAX_PITCH);
    if (!Number.isFinite(distance)) distance = config.DEFAULT_DISTANCE;
    distance = clamp(distance, config.MIN_DISTANCE, config.MAX_DISTANCE);
    if (!Number.isFinite(targetDistance)) targetDistance = distance;
    targetDistance = clamp(targetDistance, config.MIN_DISTANCE, config.MAX_DISTANCE);

    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    const camX = target.x + distance * cosPitch * sinYaw;
    const camY = target.y + distance * sinPitch;
    const camZ = target.z + distance * cosPitch * cosYaw;

    if (
      threeCamera &&
      Number.isFinite(camX) &&
      Number.isFinite(camY) &&
      Number.isFinite(camZ) &&
      Number.isFinite(target.x) &&
      Number.isFinite(target.y) &&
      Number.isFinite(target.z)
    ) {
      threeCamera.position.set(camX, camY, camZ);
      threeCamera.lookAt(target.x, target.y, target.z);
    }
  }

  function clearDrag() {
    isDragging = false;
    dragCheckButtons = false;
  }

  function cancelAutoTurn() {
    if (autoTurn) {
      autoTurn.cancel();
      autoTurn = null;
    }
  }

  /**
   * Smoothly rotates the camera yaw to `goalYaw` over `duration` seconds along
   * the shortest arc. Replaces any in-flight automatic turn; cancelled by user
   * camera input (drag-orbit or scroll-zoom) or by `setSpawnYaw`.
   */
  function turnToYaw(goalYaw, duration = config.AUTO_TURN_DURATION) {
    if (!Number.isFinite(goalYaw)) return;
    cancelAutoTurn();
    const startYaw = Number.isFinite(yaw) ? yaw : config.DEFAULT_YAW;
    const delta = shortestAngleDelta(startYaw, goalYaw);
    if (Math.abs(delta) < 1e-6) return;
    const handle = coroutines.start(function* () {
      yield* tween(duration, (t) => {
        yaw = startYaw + delta * t;
      });
      if (autoTurn === handle) {
        autoTurn = null;
      }
    });
    autoTurn = handle;
  }

  function onMouseDown(event) {
    if (!event) return;
    if (event.button !== undefined && event.button !== 0 && event.button !== 2) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    cancelAutoTurn();
    isDragging = true;
    dragCheckButtons = typeof event.buttons !== 'number' || (event.buttons & 3) !== 0;
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    if (ownerWindow && typeof ownerWindow.focus === 'function') {
      try {
        ownerWindow.focus();
      } catch (_) {
        // Ignore focus errors in non-browser unit-test shims
      }
    }
  }

  function onMouseMove(event) {
    if (!isDragging || !event) return;
    if (typeof event.buttons === 'number') {
      if ((event.buttons & 3) !== 0) {
        dragCheckButtons = true;
      } else if (dragCheckButtons) {
        clearDrag();
        return;
      }
    }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const dx = event.clientX - lastClientX;
    const dy = event.clientY - lastClientY;
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (dx !== 0 || dy !== 0) {
      cancelAutoTurn();
    }

    const nextYaw = yaw - dx * config.ORBIT_SENSITIVITY;
    if (Number.isFinite(nextYaw)) {
      yaw = nextYaw;
    }
    const nextPitch = pitch + dy * config.ORBIT_SENSITIVITY;
    if (Number.isFinite(nextPitch)) {
      pitch = clamp(nextPitch, config.MIN_PITCH, config.MAX_PITCH);
    }
    applyCameraTransform();
  }

  function onVisibilityChange() {
    if (ownerDocument && (ownerDocument.hidden || ownerDocument.visibilityState === 'hidden')) {
      clearDrag();
    }
  }

  function onContextMenu(event) {
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  }

  function onWheel(event) {
    if (!event) return;
    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    const rawDelta = Number(event.deltaY);
    if (!Number.isFinite(rawDelta) || rawDelta === 0) return;
    cancelAutoTurn();

    let notches;
    if (event.deltaMode === 1) {
      notches = rawDelta / 3;
    } else if (Math.abs(rawDelta) < 10) {
      notches = Math.sign(rawDelta) * Math.max(0.25, Math.abs(rawDelta));
    } else {
      notches = rawDelta / 100;
    }

    const nextTargetDistance = targetDistance + notches * config.ZOOM_STEP;
    if (Number.isFinite(nextTargetDistance)) {
      targetDistance = clamp(nextTargetDistance, config.MIN_DISTANCE, config.MAX_DISTANCE);
    }
  }

  if (domElement && typeof domElement.addEventListener === 'function') {
    domElement.addEventListener('mousedown', onMouseDown);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('contextmenu', onContextMenu);
  }
  if (ownerWindow && typeof ownerWindow.addEventListener === 'function') {
    ownerWindow.addEventListener('mousemove', onMouseMove);
    ownerWindow.addEventListener('mouseup', clearDrag);
    ownerWindow.addEventListener('blur', clearDrag);
  }
  if (ownerDocument && typeof ownerDocument.addEventListener === 'function') {
    ownerDocument.addEventListener('visibilitychange', onVisibilityChange);
  }

  function setSpawnYaw(nextYaw) {
    cancelAutoTurn();
    yaw = Number.isFinite(nextYaw) ? nextYaw + 0 : config.DEFAULT_YAW;
    applyCameraTransform();
  }

  function getMovementBasis() {
    const safeYaw = Number.isFinite(yaw) ? yaw : config.DEFAULT_YAW;
    // At yaw = 0: forward = (0, -1) [North], right = (+1, 0) [East].
    return {
      forward: { x: -Math.sin(safeYaw) + 0, z: -Math.cos(safeYaw) + 0 },
      right: { x: Math.cos(safeYaw) + 0, z: -Math.sin(safeYaw) + 0 },
    };
  }

  function update(dt, playerPosition) {
    const numericDt = Number(dt);
    const safeDt = Number.isFinite(numericDt) && numericDt > 0 ? numericDt : 0;

    if (safeDt > 0) {
      coroutines.update(safeDt);
    }

    if (
      playerPosition &&
      Number.isFinite(playerPosition.x) &&
      Number.isFinite(playerPosition.y) &&
      Number.isFinite(playerPosition.z)
    ) {
      const goalX = playerPosition.x;
      const goalY = playerPosition.y + config.TARGET_HEIGHT_OFFSET;
      const goalZ = playerPosition.z;

      if (Number.isFinite(goalY)) {
        const jumpDistSq =
          (goalX - target.x) ** 2 + (goalY - target.y) ** 2 + (goalZ - target.z) ** 2;

        if (!initializedTarget || safeDt === 0 || !Number.isFinite(jumpDistSq) || jumpDistSq > 100) {
          target.x = goalX;
          target.y = goalY;
          target.z = goalZ;
          initializedTarget = true;
        } else {
          const xzAlpha = 1 - Math.exp(-28 * safeDt);
          const yAlpha = 1 - Math.exp(-20 * safeDt);
          target.x += (goalX - target.x) * xzAlpha;
          target.y += (goalY - target.y) * yAlpha;
          target.z += (goalZ - target.z) * xzAlpha;
        }
      }
    }

    if (safeDt > 0) {
      const zoomAlpha = 1 - Math.exp(-28 * safeDt);
      distance += (targetDistance - distance) * zoomAlpha;
      if (Math.abs(targetDistance - distance) < 0.005) {
        distance = targetDistance;
      }
    } else {
      distance = targetDistance;
    }
    distance = clamp(distance, config.MIN_DISTANCE, config.MAX_DISTANCE);
    pitch = clamp(pitch, config.MIN_PITCH, config.MAX_PITCH);

    applyCameraTransform();
  }

  function getState() {
    return {
      yaw,
      pitch,
      distance,
      target: { x: target.x, y: target.y, z: target.z },
      autoTurning: autoTurn !== null,
    };
  }

  function dispose() {
    clearDrag();
    coroutines.cancelAll();
    autoTurn = null;
    if (domElement && typeof domElement.removeEventListener === 'function') {
      domElement.removeEventListener('mousedown', onMouseDown);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('contextmenu', onContextMenu);
    }
    if (ownerWindow && typeof ownerWindow.removeEventListener === 'function') {
      ownerWindow.removeEventListener('mousemove', onMouseMove);
      ownerWindow.removeEventListener('mouseup', clearDrag);
      ownerWindow.removeEventListener('blur', clearDrag);
    }
    if (ownerDocument && typeof ownerDocument.removeEventListener === 'function') {
      ownerDocument.removeEventListener('visibilitychange', onVisibilityChange);
    }
  }

  applyCameraTransform();
  return Object.freeze({
    update,
    setSpawnYaw,
    turnToYaw,
    cancelAutoTurn,
    getMovementBasis,
    getState,
    clearDrag,
    dispose,
  });
}
