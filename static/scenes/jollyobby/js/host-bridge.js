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
 * Santa Tracker host bridge (`api.js` adapter) for Jolly Obby.
 * Synchronously configures pause + background music on module load, reports
 * section levels 1..10 (`maxLevel: 10`, `score` omitted so `.alt-active` stays
 * permanently displayed), triggers completion via `api.gameover()` with no
 * arguments, and reclaims iframe keyboard focus across host lifecycle transitions.
 */

import defaultApi from '../../../src/scene/api.js';
import { TOTAL_SECTIONS, SOUND_EVENTS } from './constants.js';

function configureApiInstance(apiClient) {
  if (!apiClient) return;
  if (apiClient.preload && typeof apiClient.preload.sounds === 'function') {
    apiClient.preload.sounds(...SOUND_EVENTS.PRELOAD_BANKS);
  }
  if (typeof apiClient.config === 'function') {
    apiClient.config({
      pause: true,
      sound: [SOUND_EVENTS.MUSIC_INGAME],
    });
  }
}

// MUST execute synchronously on initial module evaluation (<100ms before api.js locks config())
configureApiInstance(defaultApi);

export function clampSectionLevel(sectionNumber) {
  const numeric = Number(sectionNumber);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.max(1, Math.min(TOTAL_SECTIONS, Math.round(numeric)));
}

export function createHostBridge({
  apiClient = defaultApi,
  targetWindow = globalThis.window,
} = {}) {
  if (apiClient !== defaultApi) {
    configureApiInstance(apiClient);
  }

  let currentLevel = 1;
  let completionTriggered = false;

  const reclaimFocus = () => {
    if (targetWindow && typeof targetWindow.focus === 'function') {
      try {
        targetWindow.focus();
      } catch (_) {
        // Ignore cross-environment focus errors in headless/unit-test shims
      }
    }
  };

  const playSound = (eventName) => {
    if (typeof eventName === 'string' && eventName.length > 0 && typeof apiClient.play === 'function') {
      apiClient.play(eventName);
    }
  };

  const setSectionLevel = (sectionNumber) => {
    const clamped = clampSectionLevel(sectionNumber);
    currentLevel = clamped;
    // Always pass maxLevel: 10 (so <santa-badge> shows "LEVEL", never "ICED")
    // and NEVER pass score (so .alt-active remains permanently visible).
    apiClient.score({
      level: clamped,
      maxLevel: TOTAL_SECTIONS,
    });
    return clamped;
  };

  const triggerCompletion = () => {
    if (completionTriggered) {
      return false;
    }
    completionTriggered = true;
    setSectionLevel(TOTAL_SECTIONS);
    playSound(SOUND_EVENTS.WIN);
    playSound(SOUND_EVENTS.MUSIC_GAMEOVER);
    // Call gameover() with NO {share: true} arg to avoid retired Firebase Dynamic Links POST error
    apiClient.gameover();
    return true;
  };

  const waitPreload = (promise) => {
    const safePromise = Promise.resolve(promise);
    if (apiClient.preload && typeof apiClient.preload.wait === 'function') {
      apiClient.preload.wait(safePromise);
    }
    return safePromise;
  };

  const onReady = (asyncCallback) => {
    return apiClient.ready(async (data) => {
      await asyncCallback(data);
      reclaimFocus();
    });
  };

  const subscribe = (eventName, handler) => {
    apiClient.addEventListener(eventName, handler);
    return () => {
      if (typeof apiClient.removeEventListener === 'function') {
        apiClient.removeEventListener(eventName, handler);
      }
    };
  };

  const onPause = (fn) => subscribe('pause', () => fn());

  const onResume = (fn) => subscribe('resume', () => {
    fn();
    reclaimFocus();
  });

  const onRestart = (fn) => subscribe('restart', () => {
    completionTriggered = false;
    playSound(SOUND_EVENTS.MUSIC_INGAME);
    setSectionLevel(1);
    fn();
    reclaimFocus();
  });

  const onMuteChange = (fn) => {
    const offMuted = subscribe('muted', () => {
      fn(true);
      reclaimFocus();
    });
    const offUnmuted = subscribe('unmuted', () => {
      fn(false);
      reclaimFocus();
    });
    return () => {
      offMuted();
      offUnmuted();
    };
  };

  return Object.freeze({
    waitPreload,
    onReady,
    setSectionLevel,
    triggerCompletion,
    playSound,
    reclaimFocus,
    onPause,
    onResume,
    onRestart,
    onMuteChange,
    getCurrentLevel: () => currentLevel,
    isCompleted: () => completionTriggered,
  });
}
