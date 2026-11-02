import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SCENE_ROOT, '../../..');

// Minimal DOM globals required before importing host-bridge.js -> api.js in Node
globalThis.ProgressEvent ??= Event;
const baseWin = new EventTarget();
globalThis.window = Object.assign(baseWin, {
  location: new URL('http://127.0.0.1:10380/st/scenes/jollyobby/index.html'),
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  focus() {},
});
globalThis.window.parent = globalThis.window;
globalThis.window.top = globalThis.window;
globalThis.self = globalThis.window;
globalThis.document = Object.assign(new EventTarget(), {
  body: new EventTarget(),
  baseURI: 'http://127.0.0.1:10380/st/scenes/jollyobby/index.html',
});

const { CAMERA_CONFIG, COMPLETION_DELAY } = await import('../js/constants.js');
const { createHostBridge } = await import('../js/host-bridge.js');
const { parseSnowboxObjTemplates } = await import('../js/props.js');
const { createJollyObbyGame } = await import('../js/game.js');

async function loadTestAssetsFromDisk() {
  const gltfPath = path.join(REPO_ROOT, 'static/scenes/snowball/models/elf-animated.gltf');
  const binPath = path.join(REPO_ROOT, 'static/scenes/snowball/models/elf-animated.bin');
  const gltfJson = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  const binBuf = fs.readFileSync(binPath);
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
  const preloadedGltf = await new GLTFLoader().parseAsync(JSON.stringify(gltfJson), '');

  const snowboxDir = path.join(REPO_ROOT, 'static/scenes/snowbox/models');
  const preloadedPropsLibrary = parseSnowboxObjTemplates({
    pineTree: fs.readFileSync(path.join(snowboxDir, 'pine-tree.obj'), 'utf8'),
    gift: fs.readFileSync(path.join(snowboxDir, 'gift.obj'), 'utf8'),
    arch: fs.readFileSync(path.join(snowboxDir, 'arch.obj'), 'utf8'),
    snowman: fs.readFileSync(path.join(snowboxDir, 'snowman.obj'), 'utf8'),
    rock01: fs.readFileSync(path.join(snowboxDir, 'mountain/rock_01.obj'), 'utf8'),
    rock02: fs.readFileSync(path.join(snowboxDir, 'mountain/rock_02.obj'), 'utf8'),
  });

  return { preloadedGltf, preloadedPropsLibrary };
}

const SHARED_ASSETS = await loadTestAssetsFromDisk();

async function createTestHarness({ manualTime = true, echoHostLifecycleOnScore = false } = {}) {
  const doc = Object.assign(new EventTarget(), {
    hidden: false,
    visibilityState: 'visible',
  });
  let rafCounter = 1;
  const rafCallbacks = new Map();

  const win = Object.assign(new EventTarget(), {
    __MANUAL_TIME__: manualTime,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    document: doc,
    focus() {},
    requestAnimationFrame(cb) {
      const id = rafCounter++;
      rafCallbacks.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      rafCallbacks.delete(id);
    },
  });
  doc.defaultView = win;

  const canvas = Object.assign(new EventTarget(), {
    tagName: 'CANVAS',
    ownerDocument: doc,
  });
  const containerChildren = [];
  const container = {
    clientWidth: 1280,
    clientHeight: 720,
    replaceChildren(...els) {
      containerChildren.length = 0;
      containerChildren.push(...els);
    },
    get children() {
      return containerChildren;
    },
  };

  let renderCount = 0;
  const rendererFactory = () => ({
    domElement: canvas,
    setPixelRatio() {},
    setSize() {},
    render() {
      renderCount += 1;
    },
    dispose() {},
  });

  const apiCalls = {
    scores: [],
    plays: [],
    gameovers: [],
    readyCallbacks: [],
  };
  const apiListeners = new Map();
  let hostPaused = false;
  let hostGameover = false;
  let hostMuted = false;

  const apiClient = {
    preload: { sounds() {}, wait() {} },
    config() {},
    score(p) {
      apiCalls.scores.push(p);
      if (echoHostLifecycleOnScore) {
        // Mirrors static/entrypoint.js:588-591 -> global.subscribe (lines 342-358) over MessagePort
        setTimeout(() => {
          if (!hostGameover) {
            apiClient.emit(hostPaused ? 'pause' : 'resume');
          }
          apiClient.emit(hostMuted ? 'muted' : 'unmuted');
        }, 0);
      }
    },
    play(s) { apiCalls.plays.push(s); },
    gameover(...args) {
      hostGameover = true;
      apiCalls.gameovers.push(args);
    },
    ready(cb) { apiCalls.readyCallbacks.push(cb); },
    addEventListener(t, fn) {
      if (!apiListeners.has(t)) apiListeners.set(t, new Set());
      apiListeners.get(t).add(fn);
    },
    removeEventListener(t, fn) {
      apiListeners.get(t)?.delete(fn);
    },
    emit(t) {
      if (t === 'pause') hostPaused = true;
      if (t === 'resume') hostPaused = false;
      if (t === 'restart') {
        hostPaused = false;
        hostGameover = false;
      }
      if (t === 'muted') hostMuted = true;
      if (t === 'unmuted') hostMuted = false;
      for (const fn of apiListeners.get(t) || []) fn();
    },
  };

  const hostBridge = createHostBridge({ apiClient, targetWindow: win });
  const game = createJollyObbyGame({
    container,
    targetWindow: win,
    hostBridge,
    rendererFactory,
    preloadedGltf: SHARED_ASSETS.preloadedGltf,
    preloadedPropsLibrary: SHARED_ASSETS.preloadedPropsLibrary,
    enableCubemapLoad: false,
  });

  assert.equal(win.__TEST_CONTROL__.isReady(), false, 'isReady() is false before api.ready resolves');
  await apiCalls.readyCallbacks[0]({});
  assert.equal(win.__TEST_CONTROL__.isReady(), true, 'isReady() is true after api.ready resolves');

  return {
    win,
    doc,
    canvas,
    container,
    apiClient,
    apiCalls,
    rafCallbacks,
    getRenderCount: () => renderCount,
    game,
  };
}

function shortestAngle(from, to) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function orbitCameraToYaw(win, canvas, desiredYaw) {
  const currentYaw = win.__TEST_CONTROL__.getSnapshot().camera.yaw;
  const deltaYaw = shortestAngle(currentYaw, desiredYaw);
  if (Math.abs(deltaYaw) < 1e-4) return;
  // In camera.js: yaw -= dx * ORBIT_SENSITIVITY => dx = -deltaYaw / ORBIT_SENSITIVITY
  const dx = -deltaYaw / CAMERA_CONFIG.ORBIT_SENSITIVITY;
  canvas.dispatchEvent(Object.assign(new Event('mousedown'), { button: 0, clientX: 500, clientY: 360 }));
  win.dispatchEvent(Object.assign(new Event('mousemove'), { clientX: 500 + dx, clientY: 360 }));
  win.dispatchEvent(new Event('mouseup'));
}

function setKey(win, code, key, down) {
  win.dispatchEvent(
    Object.assign(new Event(down ? 'keydown' : 'keyup', { bubbles: true, cancelable: true }), {
      code,
      key,
      repeat: false,
    })
  );
}

test('__TEST_CONTROL__ & __JOLLYOBBY_STATE__ expose strictly read-only frozen telemetry and zero cheat mutators', async () => {
  const h = await createTestHarness({ manualTime: true });
  try {
    const tc = h.win.__TEST_CONTROL__;
    assert.deepEqual(Object.keys(tc).sort(), ['advanceTime', 'getSnapshot', 'isReady']);
    assert.ok(Object.isFrozen(tc));

    const snap = tc.getSnapshot();
    assert.ok(Object.isFrozen(snap));
    assert.ok(Object.isFrozen(snap.player));
    assert.ok(Object.isFrozen(snap.camera));
    assert.ok(Object.isFrozen(snap.checkpoints));
    assert.ok(Object.isFrozen(snap.finishGoal));
    assert.ok(Object.isFrozen(snap.sectionWaypoints));

    assert.equal(snap.ready, true);
    assert.equal(snap.paused, false);
    assert.equal(snap.completed, false);
    assert.equal(snap.currentSection, 1);
    assert.equal(snap.activeCheckpoint, 0);
    assert.equal(snap.player.grounded, true);
    assert.equal(snap.player.animState, 'idle');
    assert.equal(snap.checkpoints.length, 10);
    assert.equal(snap.sectionWaypoints.length, 60);
    assert.equal(h.container.children.length, 1);
    assert.equal(h.container.children[0], h.canvas);

    assert.throws(() => { snap.currentSection = 10; }, TypeError);
    assert.throws(() => { snap.player.x = 999; }, TypeError);
    assert.deepEqual(h.win.__JOLLYOBBY_STATE__, tc.getSnapshot());

    // 60s of passive waiting with zero player input must NOT advance sections or complete the game
    tc.advanceTime(60.0);
    const afterIdle = tc.getSnapshot();
    assert.equal(afterIdle.currentSection, 1);
    assert.equal(afterIdle.activeCheckpoint, 0);
    assert.equal(afterIdle.completed, false);
    assert.ok(Math.hypot(afterIdle.player.x, afterIdle.player.z) < 0.01);
  } finally {
    h.game.dispose();
  }
});

function runWaypoints(h, waypoints, startIdx, endIdx, simTimeRef, visitedCheckpoints = null) {
  const tc = h.win.__TEST_CONTROL__;
  const stepOneFrame = () => {
    tc.advanceTime(1 / 60);
    simTimeRef.t += 1 / 60;
  };

  for (let idx = startIdx; idx <= endIdx; idx++) {
    const prevWp = waypoints[idx - 1];
    const wp = waypoints[idx];

    // Dynamic timing windows before jumping onto moving/sweeping platforms
    if (wp.section === 6 && wp.kind === 'moving') {
      setKey(h.win, 'KeyW', 'w', false);
      setKey(h.win, 'Space', ' ', false);
      const giftIndex = wp.z === -57.8 ? 0 : wp.z === -47.8 ? 1 : 2;
      const phase = giftIndex === 1 ? Math.PI : 0;
      const omega = (Math.PI * 2) / 4.2;
      for (let w = 0; w < 300; w++) {
        const arrivalT = simTimeRef.t + 0.32;
        const predOffset = Math.abs(4.5 * Math.sin(omega * arrivalT + phase));
        const curSnap = tc.getSnapshot();
        const playerCentered = Math.abs(curSnap.player.x - 118.5) < 1.8;
        if (predOffset < 1.1 && playerCentered) break;
        stepOneFrame();
      }
    } else if (wp.section === 7 && wp.kind === 'rotating') {
      // Wait until target spinning cross has an arm aligned near East-West at landing
      setKey(h.win, 'KeyW', 'w', false);
      setKey(h.win, 'Space', ' ', false);
      const omega = wp.x === 103.0 ? 0.55 : wp.x === 89.0 ? -0.55 : 0.65;
      const phase = wp.x === 89.0 ? Math.PI / 4 : 0;
      for (let w = 0; w < 240; w++) {
        const arrivalYaw = phase + omega * (simTimeRef.t + 0.42);
        if (Math.cos(4 * arrivalYaw) > 0.65) break;
        stepOneFrame();
      }
    } else if (wp.section === 9 && wp.kind === 'sweeper_deck') {
      // Wait until radial sweeper arm on target drum is pointing West (away from East lane x=28.2)
      setKey(h.win, 'KeyW', 'w', false);
      setKey(h.win, 'Space', ' ', false);
      const isDrum1 = wp.z === -79.8;
      const omega = isDrum1 ? 1.30 : -1.30;
      const phase = isDrum1 ? 0 : Math.PI;
      for (let w = 0; w < 360; w++) {
        const thetaAtLanding = phase + omega * (simTimeRef.t + 0.55);
        if (Math.cos(thetaAtLanding) < -0.45) break;
        stepOneFrame();
      }
    } else if (wp.section === 10 && (wp.kind === 'moving' || prevWp.kind === 'moving')) {
      setKey(h.win, 'KeyW', 'w', false);
      setKey(h.win, 'Space', ' ', false);
      for (let w = 0; w < 300; w++) {
        const glideZ = -64.2 + 3.0 * Math.sin(1.45 * (simTimeRef.t + 0.30));
        if (wp.kind === 'moving' && glideZ < -65.8) break;
        if (prevWp.kind === 'moving' && glideZ > -62.4) break;
        stepOneFrame();
      }
    }

    let reached = false;
    let jumpedForThisLeg = false;
    const startActiveCp = tc.getSnapshot().activeCheckpoint;

    for (let frame = 0; frame < 260; frame++) {
      const snap = tc.getSnapshot();
      if (snap.completed) {
        reached = true;
        break;
      }
      if (visitedCheckpoints) visitedCheckpoints.add(snap.activeCheckpoint);

      const dx = wp.x - snap.player.x;
      const dz = wp.z - snap.player.z;
      const distXZ = Math.hypot(dx, dz);

      const arriveRadius = wp.kind === 'goal' ? 3.5 : wp.kind === 'ramp' ? 1.5 : 1.45;
      if (distXZ <= arriveRadius && Math.abs(snap.player.y - wp.y) <= 2.4 && snap.player.grounded) {
        reached = true;
        break;
      }

      const desiredYaw = Math.atan2(-dx, -dz);
      orbitCameraToYaw(h.win, h.canvas, desiredYaw);

      // Ease off throttle right over target center when airborne to avoid overshooting compact pads
      if (!snap.player.grounded && distXZ < 0.85) {
        setKey(h.win, 'KeyW', 'w', false);
      } else {
        setKey(h.win, 'KeyW', 'w', true);
      }

      const legSpan = Math.hypot(wp.x - prevWp.x, wp.z - prevWp.z);
      const isRampWalk = wp.kind === 'ramp' || prevWp.kind === 'ramp';
      const isBeamHurdleJump = prevWp.kind === 'beam' && wp.kind === 'beam';
      const needsJump = !isRampWalk && (isBeamHurdleJump || wp.y > prevWp.y + 0.05 || legSpan > 4.2);

      let jumpTriggerDist;
      if (isBeamHurdleJump) {
        jumpTriggerDist = 8.6;
      } else if (wp.kind === 'goal') {
        // Summit Dais (16x16, center x=82) starts at x=74, while sec10_disc2 (center 67.8, r=2.7) ends at x=70.5
        jumpTriggerDist = 12.4;
      } else if (prevWp.kind === 'rotating') {
        // Launch off the solid 1.9-stud central hub before stepping past its rim
        jumpTriggerDist = legSpan - 1.35;
      } else if (prevWp.kind === 'checkpoint' && legSpan >= 14.5) {
        // CP pads have 6.0-stud half-extent; jump near the pad edge (~5.0 studs from CP center)
        jumpTriggerDist = legSpan - 5.0;
      } else {
        jumpTriggerDist = Math.min(9.8, Math.max(5.8, legSpan - 1.6));
      }

      if (needsJump && !jumpedForThisLeg && snap.player.grounded && distXZ <= jumpTriggerDist) {
        setKey(h.win, 'Space', ' ', true);
        jumpedForThisLeg = true;
      } else {
        setKey(h.win, 'Space', ' ', false);
      }

      stepOneFrame();
    }

    setKey(h.win, 'KeyW', 'w', false);
    setKey(h.win, 'Space', ' ', false);

    const postSnap = tc.getSnapshot();
    if (visitedCheckpoints) visitedCheckpoints.add(postSnap.activeCheckpoint);
    assert.ok(
      reached,
      `Failed to reach waypoint #${idx} (section=${wp.section}, kind=${wp.kind}, target=(${wp.x},${wp.y},${wp.z}), player=(${postSnap.player.x.toFixed(2)},${postSnap.player.y.toFixed(2)},${postSnap.player.z.toFixed(2)}), activeCp=${startActiveCp}->${postSnap.activeCheckpoint})`
    );
  }
}

test('pause/resume, void fall respawn, hazard respawn, and restart preserve/reset state accurately', async () => {
  const h = await createTestHarness({ manualTime: true });
  try {
    const tc = h.win.__TEST_CONTROL__;
    const waypoints = tc.getSnapshot().sectionWaypoints;

    // 1. Walk North while paused => zero motion
    h.apiClient.emit('pause');
    assert.equal(tc.getSnapshot().paused, true);
    setKey(h.win, 'KeyW', 'w', true);
    tc.advanceTime(1.0);
    assert.equal(tc.getSnapshot().player.z, 0);

    // 2. Resume clears previously pressed keys cleanly; walk off CP0 West edge (x < -8) and release KeyA while falling
    h.apiClient.emit('resume');
    assert.equal(tc.getSnapshot().paused, false);
    setKey(h.win, 'KeyA', 'a', true);
    tc.advanceTime(0.65);
    setKey(h.win, 'KeyA', 'a', false);
    tc.advanceTime(1.0);

    // Player fell below VOID_KILL_Y (-20) and respawned cleanly at CP0 (0, 0, 0) with zeroed velocity
    const postVoid = tc.getSnapshot();
    assert.equal(postVoid.activeCheckpoint, 0);
    assert.equal(postVoid.currentSection, 1);
    assert.ok(Math.hypot(postVoid.player.x, postVoid.player.z) < 0.05);
    assert.equal(postVoid.player.y, 0);
    assert.equal(postVoid.player.vx, 0);
    assert.equal(postVoid.player.vy, 0);
    assert.equal(postVoid.player.vz, 0);
    assert.equal(postVoid.player.grounded, true);
    assert.ok(h.apiCalls.plays.includes('snowball_hit'));

    // 3. Traverse genuinely to CP2 (waypoint #13, Section 3 start at (0, 11.5, -125.8)), then jump onto red hazard tile sec3_c1_R (12.2, 11.55, -122.8)
    const simTimeRef = { t: 1.65 };
    runWaypoints(h, waypoints, 1, 13, simTimeRef);
    const atCp2 = tc.getSnapshot();
    assert.equal(atCp2.activeCheckpoint, 2);
    assert.equal(atCp2.currentSection, 3);

    const playsBeforeHazard = h.apiCalls.plays.length;
    const hazX = 12.2;
    const hazZ = -122.8;
    let jumpedTowardHazard = false;
    for (let f = 0; f < 90; f++) {
      const s = tc.getSnapshot();
      const dx = hazX - s.player.x;
      const dz = hazZ - s.player.z;
      orbitCameraToYaw(h.win, h.canvas, Math.atan2(-dx, -dz));
      setKey(h.win, 'KeyW', 'w', true);
      if (!jumpedTowardHazard && s.player.grounded && Math.hypot(dx, dz) <= 8.5) {
        setKey(h.win, 'Space', ' ', true);
        jumpedTowardHazard = true;
      } else {
        setKey(h.win, 'Space', ' ', false);
      }
      tc.advanceTime(1 / 60);
      if (h.apiCalls.plays.slice(playsBeforeHazard).includes('snowball_hit')) {
        break;
      }
    }
    setKey(h.win, 'KeyW', 'w', false);
    setKey(h.win, 'Space', ' ', false);

    const postHazard = tc.getSnapshot();
    assert.ok(h.apiCalls.plays.slice(playsBeforeHazard).includes('snowball_hit'), 'Touching red hazard tile must trigger respawn sound');
    assert.equal(postHazard.activeCheckpoint, 2, 'Hazard respawn must preserve latest activeCheckpoint');
    assert.equal(postHazard.currentSection, 3, 'Hazard respawn must preserve currentSection');
    assert.ok(Math.hypot(postHazard.player.x - 0, postHazard.player.z - -125.8) < 0.1, 'Must respawn at CP2 coordinates');
    assert.equal(postHazard.player.y, 11.5);

    // 4. Host restart resets back to CP0 (section 1)
    h.apiClient.emit('restart');
    const postRestart = tc.getSnapshot();
    assert.equal(postRestart.activeCheckpoint, 0);
    assert.equal(postRestart.currentSection, 1);
    assert.ok(Math.hypot(postRestart.player.x, postRestart.player.z) < 0.01);
    assert.equal(postRestart.player.y, 0);
  } finally {
    h.game.dispose();
  }
});

test('full 10-section genuine keyboard + mouse-orbit waypoint runner traverses CP0 -> CP1..CP9 -> FinishGoal and restarts cleanly', async () => {
  const h = await createTestHarness({ manualTime: true });
  try {
    const tc = h.win.__TEST_CONTROL__;
    const waypoints = tc.getSnapshot().sectionWaypoints;
    const visitedCheckpoints = new Set([0]);
    const simTimeRef = { t: 0 };

    runWaypoints(h, waypoints, 1, waypoints.length - 1, simTimeRef, visitedCheckpoints);

    const finalSnap = tc.getSnapshot();
    assert.equal(finalSnap.completed, true, 'Reaching Section 10 FinishGoal must complete the game');
    assert.equal(finalSnap.currentSection, 10);
    assert.equal(finalSnap.activeCheckpoint, 9);
    assert.equal(finalSnap.player.animState, 'celebrate');
    assert.deepEqual([...visitedCheckpoints].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Verify monotonic level badge progression 1..10 with score omitted, and 1 gameover() call with 0 args
    const reportedLevels = h.apiCalls.scores.map((s) => s.level);
    for (let lvl = 1; lvl <= 10; lvl++) {
      assert.ok(reportedLevels.includes(lvl), `Expected level ${lvl} in ${JSON.stringify(reportedLevels)}`);
    }
    for (const s of h.apiCalls.scores) {
      assert.equal(s.maxLevel, 10);
      assert.equal('score' in s, false);
    }
    // The host game-over screen waits COMPLETION_DELAY seconds after the finish
    // while held controls stay frozen and the elf settles on the summit dais.
    assert.equal(h.apiCalls.gameovers.length, 0, 'gameover() must be delayed after reaching the goal');
    setKey(h.win, 'KeyW', 'w', true);
    setKey(h.win, 'Space', ' ', true);
    tc.advanceTime(0.5);
    const settledSnap = tc.getSnapshot();
    assert.equal(settledSnap.player.grounded, true, 'player must land on the summit after finishing');
    const startToFinish = Math.hypot(settledSnap.player.x - finalSnap.player.x, settledSnap.player.z - finalSnap.player.z);
    assert.ok(startToFinish < 2.0, `player drifted ${startToFinish.toFixed(3)} studs after finishing`);
    tc.advanceTime(COMPLETION_DELAY - 0.5 - 0.1);
    assert.equal(h.apiCalls.gameovers.length, 0, 'gameover() must not fire before COMPLETION_DELAY');
    const beforeGameOver = tc.getSnapshot();
    assert.ok(
      Math.hypot(beforeGameOver.player.x - settledSnap.player.x, beforeGameOver.player.z - settledSnap.player.z) < 1e-6,
      'held movement keys must not move the player after finishing'
    );
    tc.advanceTime(0.2);
    setKey(h.win, 'KeyW', 'w', false);
    setKey(h.win, 'Space', ' ', false);
    assert.equal(h.apiCalls.gameovers.length, 1);
    assert.equal(h.apiCalls.gameovers[0].length, 0);

    // Post-completion control freeze check: holding KeyW + Space must NOT move the celebrating player
    const frozenPos = { ...tc.getSnapshot().player };
    setKey(h.win, 'KeyW', 'w', true);
    setKey(h.win, 'Space', ' ', true);
    tc.advanceTime(1.0);
    setKey(h.win, 'KeyW', 'w', false);
    setKey(h.win, 'Space', ' ', false);
    const afterFreeze = tc.getSnapshot();
    assert.ok(Math.hypot(afterFreeze.player.x - frozenPos.x, afterFreeze.player.z - frozenPos.z) < 1e-6);
    assert.equal(afterFreeze.player.animState, 'celebrate');

    // Host Play Again ('restart') resets back to CP0 (1·10) and restores movement immediately
    h.apiClient.emit('restart');
    const restarted = tc.getSnapshot();
    assert.equal(restarted.completed, false);
    assert.equal(restarted.currentSection, 1);
    assert.equal(restarted.activeCheckpoint, 0);
    assert.equal(restarted.player.animState, 'idle');
    assert.ok(Math.hypot(restarted.player.x, restarted.player.z) < 1e-6);

    setKey(h.win, 'KeyW', 'w', true);
    tc.advanceTime(0.5);
    setKey(h.win, 'KeyW', 'w', false);
    assert.ok(tc.getSnapshot().player.z < -5.0, 'WASD must move player North immediately after restart');
  } finally {
    h.game.dispose();
  }
});

test('spurious host score->resume+unmuted echoes preserve single-keydown KeyW hold across CP1, 0ms restart, and rAF pacing', async () => {
  const h = await createTestHarness({ manualTime: true, echoHostLifecycleOnScore: true });
  try {
    // Flush initial boot setSectionLevel(1) -> score -> resume+unmuted macrotask
    await new Promise((r) => setTimeout(r, 10));

    const tc = h.win.__TEST_CONTROL__;
    const waypoints = tc.getSnapshot().sectionWaypoints;

    // 1. (1C.2) Dispatch KeyW keydown ONCE (0 repeat keydowns) and traverse Section 1 -> CP1
    setKey(h.win, 'KeyW', 'w', true);

    let reachedCp1 = false;
    for (let wpIdx = 1; wpIdx <= 6; wpIdx++) {
      const prevWp = waypoints[wpIdx - 1];
      const wp = waypoints[wpIdx];
      const legSpan = Math.hypot(wp.x - prevWp.x, wp.z - prevWp.z);
      const jumpDist = Math.min(9.8, Math.max(5.8, legSpan - 1.6));
      let jumped = false;

      for (let step = 0; step < 220; step++) {
        const snap = tc.getSnapshot();
        if (wpIdx === 6 && snap.activeCheckpoint >= 1 && snap.player.grounded) {
          reachedCp1 = true;
          break;
        }
        const dx = wp.x - snap.player.x;
        const dz = wp.z - snap.player.z;
        const distXZ = Math.hypot(dx, dz);
        if (wpIdx < 6 && distXZ <= 1.45 && snap.player.grounded) break;

        orbitCameraToYaw(h.win, h.canvas, Math.atan2(-dx, -dz));
        if (!jumped && snap.player.grounded && distXZ <= jumpDist) {
          setKey(h.win, 'Space', ' ', true);
          jumped = true;
        } else {
          setKey(h.win, 'Space', ' ', false);
        }
        tc.advanceTime(1 / 60);
      }
    }
    setKey(h.win, 'Space', ' ', false);

    assert.equal(reachedCp1, true, 'Must reach CP1 with single initial KeyW keydown');
    const onCp1 = tc.getSnapshot();
    assert.equal(onCp1.activeCheckpoint, 1);
    assert.equal(onCp1.currentSection, 2);

    // Let async setSectionLevel(2) -> score -> resume + unmuted echo arrive while KeyW stays held
    await new Promise((r) => setTimeout(r, 10));
    orbitCameraToYaw(h.win, h.canvas, 0);
    tc.advanceTime(0.35);
    const afterCp1Echo = tc.getSnapshot();
    assert.ok(
      afterCp1Echo.player.z < onCp1.player.z - 3.5,
      `Held KeyW must keep moving North after CP1 score->resume echo (zOnCp1=${onCp1.player.z}, zAfter=${afterCp1Echo.player.z})`
    );
    assert.ok(afterCp1Echo.player.vz < -12.0, `Expected vz < -12, got ${afterCp1Echo.player.vz}`);
    assert.equal(afterCp1Echo.player.animState, 'run');

    // Releasing KeyW cleanly decelerates to 0
    setKey(h.win, 'KeyW', 'w', false);
    tc.advanceTime(0.35);
    assert.ok(Math.abs(tc.getSnapshot().player.vz) < 1e-4);

    // 2. (6A) Pause -> #playagainButton ('restart' + 'resume' + 'unmuted') -> 0ms KeyW hold before async score->resume echo
    h.apiClient.emit('pause');
    assert.equal(tc.getSnapshot().paused, true);
    h.apiClient.emit('restart');
    h.apiClient.emit('resume');
    h.apiClient.emit('unmuted');

    // 0ms immediate single KeyW keydown BEFORE setSectionLevel(1)'s async score->resume echo fires!
    setKey(h.win, 'KeyW', 'w', true);
    await new Promise((r) => setTimeout(r, 10));
    tc.advanceTime(0.40);
    const afterZeroMsRestart = tc.getSnapshot();
    assert.ok(
      afterZeroMsRestart.player.z < -4.0 && afterZeroMsRestart.player.vz < -12.0,
      `0ms KeyW hold after restart must survive async score->resume echo (z=${afterZeroMsRestart.player.z}, vz=${afterZeroMsRestart.player.vz})`
    );
    setKey(h.win, 'KeyW', 'w', false);
    tc.advanceTime(0.35);
    assert.ok(Math.abs(tc.getSnapshot().player.vz) < 1e-4);
  } finally {
    h.game.dispose();
  }

  // 3. Real-time rAF (manualTime: false): unpaused 'resume' + 'muted' echo must NOT null lastFrameMs or force extra render
  const rt = await createTestHarness({ manualTime: false, echoHostLifecycleOnScore: true });
  try {
    await new Promise((r) => setTimeout(r, 10));
    const stepRaf = (nowMs) => {
      const [, cb] = [...rt.rafCallbacks.entries()][0];
      rt.rafCallbacks.clear();
      cb(nowMs);
    };

    setKey(rt.win, 'KeyW', 'w', true);
    stepRaf(1000);       // seeds lastFrameMs = 1000
    stepRaf(1016.6667);  // frame 1 (vz = -3.0)
    stepRaf(1033.3334);  // frame 2 (vz = -6.0)
    const zBeforeSpuriousResume = rt.win.__TEST_CONTROL__.getSnapshot().player.z;
    const rendersBefore = rt.getRenderCount();

    // Simulate unpaused mute toggle in entrypoint.js (emits 'resume' + 'muted')
    rt.apiClient.emit('resume');
    rt.apiClient.emit('muted');
    assert.equal(rt.getRenderCount(), rendersBefore, 'Spurious unpaused resume must not trigger extra renderScene()');

    // Very next rAF tick must advance simulation (proving lastFrameMs was NOT reset to null and KeyW was NOT cleared)
    stepRaf(1050.0001);
    const snapAfterNextRaf = rt.win.__TEST_CONTROL__.getSnapshot();
    assert.ok(snapAfterNextRaf.player.z < zBeforeSpuriousResume - 0.1, 'Next rAF frame must step simulation without dropping dt');
    assert.ok(snapAfterNextRaf.player.vz < -8.5, `Expected continued acceleration vz < -8.5, got ${snapAfterNextRaf.player.vz}`);
    setKey(rt.win, 'KeyW', 'w', false);
  } finally {
    rt.game.dispose();
  }
});
