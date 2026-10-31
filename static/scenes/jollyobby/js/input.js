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
 * Keyboard-only input controller for Jolly Obby.
 * Supports WASD, Arrow keys, and Space (both native KeyboardEvents and
 * host-forwarded CustomEvents from `static/src/scene/api.js`).
 * Strictly zero touch handlers (R4).
 */

const VALID_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
  'Space',
]);

function resolveKeyToken(event) {
  if (!event) return null;
  if (typeof event.code === 'string' && VALID_CODES.has(event.code)) {
    return event.code;
  }
  const key = event.key;
  if (typeof key === 'string') {
    switch (key) {
      case 'w':
      case 'W':
        return 'KeyW';
      case 'a':
      case 'A':
        return 'KeyA';
      case 's':
      case 'S':
        return 'KeyS';
      case 'd':
      case 'D':
        return 'KeyD';
      case 'ArrowUp':
      case 'Up':
        return 'ArrowUp';
      case 'ArrowLeft':
      case 'Left':
        return 'ArrowLeft';
      case 'ArrowDown':
      case 'Down':
        return 'ArrowDown';
      case 'ArrowRight':
      case 'Right':
        return 'ArrowRight';
      case ' ':
      case 'Spacebar':
      case 'Space':
        return 'Space';
      default:
        break;
    }
  }
  switch (event.keyCode) {
    case 32:
      return 'Space';
    case 37:
      return 'ArrowLeft';
    case 38:
      return 'ArrowUp';
    case 39:
      return 'ArrowRight';
    case 40:
      return 'ArrowDown';
    case 65:
      return 'KeyA';
    case 68:
      return 'KeyD';
    case 83:
      return 'KeyS';
    case 87:
      return 'KeyW';
    default:
      return null;
  }
}

export function createInputController(targetWindow = globalThis.window) {
  const held = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false,
    Space: false,
  };
  let jumpPressedQueued = false;
  const processedEvents = new WeakSet();
  const doc = targetWindow && targetWindow.document ? targetWindow.document : null;

  function clear() {
    for (const k of Object.keys(held)) {
      held[k] = false;
    }
    jumpPressedQueued = false;
  }

  function onKeyDown(event) {
    if (!event || (typeof event === 'object' && processedEvents.has(event))) return;
    if (typeof event === 'object') processedEvents.add(event);
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const token = resolveKeyToken(event);
    if (!token) return;

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }

    if (token === 'Space') {
      if (!held.Space && !event.repeat) {
        jumpPressedQueued = true;
      }
      held.Space = true;
    } else {
      held[token] = true;
    }
  }

  function onKeyUp(event) {
    if (!event || (typeof event === 'object' && processedEvents.has(event))) return;
    if (typeof event === 'object') processedEvents.add(event);

    // NOTE: static/src/core/keys.js:173 dispatches synthetic gamepad keyup with repeat: true;
    // never ignore event.repeat on keyup.
    const token = resolveKeyToken(event);
    if (!token) return;

    if (typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    held[token] = false;
  }

  function onBlur() {
    clear();
  }

  function onVisibilityChange() {
    if (doc && (doc.hidden || doc.visibilityState === 'hidden')) {
      clear();
    }
  }

  if (targetWindow && typeof targetWindow.addEventListener === 'function') {
    targetWindow.addEventListener('keydown', onKeyDown);
    targetWindow.addEventListener('keyup', onKeyUp);
    targetWindow.addEventListener('blur', onBlur);
  }
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('keyup', onKeyUp);
    doc.addEventListener('visibilitychange', onVisibilityChange);
  }

  function consumeJumpPressed() {
    const wasQueued = jumpPressedQueued;
    jumpPressedQueued = false;
    return wasQueued;
  }

  function getState() {
    const left = held.KeyA || held.ArrowLeft;
    const right = held.KeyD || held.ArrowRight;
    const up = held.KeyW || held.ArrowUp;
    const down = held.KeyS || held.ArrowDown;

    let moveX = (right ? 1 : 0) - (left ? 1 : 0);
    let moveZ = (down ? 1 : 0) - (up ? 1 : 0);

    if (moveX !== 0 && moveZ !== 0) {
      moveX *= Math.SQRT1_2;
      moveZ *= Math.SQRT1_2;
    }

    return {
      moveX,
      moveZ,
      jumpHeld: held.Space,
      consumeJumpPressed,
    };
  }

  function dispose() {
    clear();
    if (targetWindow && typeof targetWindow.removeEventListener === 'function') {
      targetWindow.removeEventListener('keydown', onKeyDown);
      targetWindow.removeEventListener('keyup', onKeyUp);
      targetWindow.removeEventListener('blur', onBlur);
    }
    if (doc && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('keyup', onKeyUp);
      doc.removeEventListener('visibilitychange', onVisibilityChange);
    }
  }

  return Object.freeze({ getState, clear, dispose });
}
