/**
 * Copyright 2020 Google LLC
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

import global from '../../global.js';

/**
 * Basic gamepad support is routed to games as synthetic keyboard events.
 * Arrow keys and space can be received via document keydown / keyup messages.
 * Example:
 *   document.addEventListener('keydown', (e) => {
 *     if (e.key == 'ArrowLeft')
 *       console.log('Left keyboard arrow or gamepad pressed.');
 *   }
 */

/**
 * Configures key and gamepad handlers for the host frame.
 */
export default function configureCustomKeys(loaderElement) {
  const keycodeMap = {
    ' ': 32,
    'PageUp': 33,
    'PageDown': 34,
    'End': 35,
    'Home': 36,
    'Left': 37,
    'Up': 38,
    'Right': 39,
    'Down': 40,
    'ArrowLeft': 37,
    'ArrowUp': 38,
    'ArrowRight': 39,
    'ArrowDown': 40,
    'w': 87,
    'W': 87,
    'a': 65,
    'A': 65,
    's': 83,
    'S': 83,
    'd': 68,
    'D': 68,
  };

  /**
   * Listen for deviceorientation events.
   */
  window.addEventListener('deviceorientation', (ev) => {
    const {sceneTilt, control} = global.getState();
    if (sceneTilt && control) {
      const payload = {
        absolute: ev.absolute,
        alpha: ev.alpha,
        beta: ev.beta,
        gamma: ev.gamma,
      };
      control.send({type: 'deviceorientation', payload});
    }
  });

  const hostHeldKeys = new Map();
  const getTrackId = (ev) => ev.code || (keycodeMap[ev.key] ? `kc_${keycodeMap[ev.key]}` : ev.key);

  const isEditableHostTarget = (ev) => {
    const el = (ev.composedPath && ev.composedPath()[0]) || ev.target;
    if (!el || !el.tagName) {
      return false;
    }
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(el.isContentEditable);
  };

  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || isEditableHostTarget(ev)) {
      return;
    }
    const code = keycodeMap[ev.key];
    if (!code) {
      return;
    }
    const {control, hidden} = global.getState();
    if (loaderElement.disabled || !control || hidden) {
      return;
    }

    ev.preventDefault();
    const trackId = getTrackId(ev);
    hostHeldKeys.set(trackId, {key: ev.key, code: ev.code || '', keyCode: code});
    control.send({
      type: 'keydown',
      payload: {
        key: ev.key,
        code: ev.code || '',
        keyCode: code,
        repeat: Boolean(ev.repeat),
      },
    });
  });

  window.addEventListener('keyup', (ev) => {
    const trackId = getTrackId(ev);
    const entry = hostHeldKeys.get(trackId);
    if (!entry) {
      return;
    }
    hostHeldKeys.delete(trackId);
    const {control, hidden} = global.getState();
    if (control && !hidden) {
      ev.preventDefault();
      control.send({
        type: 'keyup',
        payload: {
          key: ev.key || entry.key,
          code: ev.code || entry.code,
          keyCode: entry.keyCode,
          repeat: false,
        },
      });
    }
    if (hostHeldKeys.size === 0 && !loaderElement.disabled) {
      loaderElement.focus();
    }
  });

  window.addEventListener('blur', () => {
    if (hostHeldKeys.size > 0 && document.activeElement !== loaderElement) {
      const {control, hidden} = global.getState();
      if (control && !hidden) {
        for (const entry of hostHeldKeys.values()) {
          control.send({
            type: 'keyup',
            payload: {
              key: entry.key,
              code: entry.code,
              keyCode: entry.keyCode,
              repeat: false,
            },
          });
        }
      }
    }
    hostHeldKeys.clear();
  });

  // These are vague estimates (in ms) for gamepad emulation. We can't get the system's repeat rate
  // config, short of stealing it when a user presses a key.
  const initialRepeat = 400;
  const followingRepeat = 50;

  const gamepads = {};
  const buttonsActive = {};
  let lastTimestamp = 0;

  /**
   * Queued to trigger repeat keystrokes. Queues another stroke if the control is still active.
   *
   * @param {string} key to repeat send
   */
  function repeatKey(key) {
    const {control, hidden} = global.getState();
    if (!control || hidden) {
      return false;
    }

    // TODO: could be combined with a rAF.
    buttonsActive[key] = window.setTimeout(() => repeatKey(key), followingRepeat);
    const payload = {
      key,
      keyCode: keycodeMap[key],
      repeat: true,
    };
    control.send({type: 'keydown', payload});
  }

  function gamepadLoop() {
    const gamepads = navigator.getGamepads();
    const gp = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3] || null;
    if (!gp) {
      return;
    }
    window.requestAnimationFrame(gamepadLoop);

    // TODO(samthor): We only look at the 1st gamepad. What if we have multiplayer games?
    if (gp.timestamp === lastTimestamp) {
      return;
    }
    lastTimestamp = gp.timestamp;

    const buttonsDown = {};

    const buttonPressed = (index) => (gp.buttons[index] && gp.buttons[index].pressed);
    const enableIfPressed = (index, key) => {
      if (buttonPressed(index)) {
        buttonsDown[key] = true;
      }
    };

    const {control, hidden} = global.getState();
    if (control && !hidden) {
      const threshold = 0.2;

      // ... only look for events if there's something to control and page is visible
      const leftright = gp.axes[0];
      if (leftright < -threshold) {
        buttonsDown['ArrowLeft'] = true;
      } else if (leftright > +threshold) {
        buttonsDown['ArrowRight'] = true;
      }
      const updown = gp.axes[1];
      if (updown < -threshold) {
        buttonsDown['ArrowUp'] = true;
      } else if (updown > +threshold) {
        buttonsDown['ArrowDown'] = true;
      }

      enableIfPressed(0, ' ');
      enableIfPressed(12, 'ArrowUp');
      enableIfPressed(13, 'ArrowDown');
      enableIfPressed(14, 'ArrowLeft');
      enableIfPressed(15, 'ArrowRight');
    }

    for (const key in buttonsDown) {
      if (!(key in buttonsActive)) {
        // Wasn't previously pressed, dispatch keydown.
        const keyCode = keycodeMap[key] || 0;
        control && control.send({type: 'keydown', payload: {key, keyCode, repeat: false}});

        // ... and enqueue repeat
        buttonsActive[key] = window.setTimeout(() => repeatKey(key), initialRepeat);
      }
    }
    for (const key in buttonsActive) {
      if (key in buttonsDown) {
        continue;
      }
      // Was previously pressed, dispatch keyup!
      const keyCode = keycodeMap[key] || 0;
      control && control.send({type: 'keyup', payload: {key, keyCode, repeat: true}});

      // ... and clear repeat timer
      window.clearTimeout(buttonsActive[key]);
      delete buttonsActive[key];
    }
  }

  function gamepadHandler(event) {
    const connecting = event.type === 'gamepadconnected';
    const gamepad = event.gamepad;

    const count = Object.keys(gamepads).length;
    if (connecting) {
      gamepads[gamepad.index] = gamepad;
      if (count === 0) {
        gamepadLoop();  // kick off listener if there are any gamepads
      }
    } else {
      delete gamepads[gamepad.index];
    }
  }

  window.addEventListener('gamepadconnected', gamepadHandler);
  window.addEventListener('gamepaddisconnected', gamepadHandler);
}