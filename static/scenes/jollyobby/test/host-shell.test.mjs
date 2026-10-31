import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SCENE_ROOT, '../../..');

// Minimal DOM globals required by static/src/scene/api.js and static/global.js in Node
const winTarget = new EventTarget();
globalThis.window = Object.assign(winTarget, {
  location: new URL('http://127.0.0.1:10380/st/scenes/jollyobby/index.html'),
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  focus() {},
  matchMedia: () => ({
    matches: true,
    addListener() {},
    removeListener() {},
  }),
});
globalThis.window.parent = globalThis.window;
globalThis.window.top = globalThis.window;
globalThis.self = globalThis.window;
globalThis.document = Object.assign(new EventTarget(), {
  body: Object.assign(new EventTarget(), { tagName: 'BODY' }),
  activeElement: null,
  hidden: false,
  baseURI: 'http://127.0.0.1:10380/st/scenes/jollyobby/index.html',
});
globalThis.document.activeElement = globalThis.document.body;

await import('../../../third_party/lib/klang/config.js');
const { default: hostGlobal } = await import('../../../global.js');
const { default: configureCustomKeys } = await import('../../../src/core/keys.js');
const constants = await import('../js/constants.js');
const { createHostBridge, clampSectionLevel } = await import('../js/host-bridge.js');

function createMockApi() {
  const calls = {
    preloadSounds: [],
    preloadWaits: [],
    configs: [],
    scores: [],
    plays: [],
    gameovers: [],
    readyCallbacks: [],
  };
  const listeners = new Map();
  const apiClient = {
    preload: {
      sounds(...banks) {
        calls.preloadSounds.push(banks);
      },
      wait(p) {
        calls.preloadWaits.push(p);
      },
    },
    config(cfg) {
      calls.configs.push(cfg);
    },
    score(payload) {
      calls.scores.push(payload);
    },
    play(eventName) {
      calls.plays.push(eventName);
    },
    gameover(...args) {
      calls.gameovers.push(args);
    },
    ready(cb) {
      calls.readyCallbacks.push(cb);
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    emit(type, detail) {
      for (const fn of listeners.get(type) || []) {
        fn(detail);
      }
    },
  };
  return { apiClient, calls };
}

test('constants.js exports deeply frozen contract objects and exact Roblox jump math', () => {
  const { TOTAL_SECTIONS, PHYSICS_CONFIG, CAMERA_CONFIG, COLLIDER_KIND, SOUND_EVENTS } = constants;
  assert.equal(TOTAL_SECTIONS, 10);
  assert.ok(Object.isFrozen(PHYSICS_CONFIG));
  assert.ok(Object.isFrozen(CAMERA_CONFIG));
  assert.ok(Object.isFrozen(COLLIDER_KIND));
  assert.ok(Object.isFrozen(SOUND_EVENTS));
  assert.ok(Object.isFrozen(SOUND_EVENTS.PRELOAD_BANKS));

  const analyticalJumpHeight = (PHYSICS_CONFIG.JUMP_VELOCITY ** 2) / (2 * Math.abs(PHYSICS_CONFIG.GRAVITY));
  const analyticalApexTime = PHYSICS_CONFIG.JUMP_VELOCITY / Math.abs(PHYSICS_CONFIG.GRAVITY);
  assert.ok(Math.abs(analyticalJumpHeight - 6.8909) < 0.005);
  assert.ok(Math.abs(analyticalApexTime - 0.265) < 0.005);
  assert.equal(PHYSICS_CONFIG.WALK_SPEED, 16.0);
  assert.equal(PHYSICS_CONFIG.PLAYER_RADIUS, 0.85);
  assert.equal(PHYSICS_CONFIG.PLAYER_HEIGHT, 5.0);
});

test('host-bridge configures Klang sound banks and pause/music config synchronously', () => {
  const { apiClient, calls } = createMockApi();
  createHostBridge({ apiClient });

  assert.equal(calls.preloadSounds.length, 1);
  assert.deepEqual(calls.preloadSounds[0], [
    'runner_load_sounds',
    'snowball_load_sounds',
    'generic_load_sounds',
    'pb_load_sounds',
    'codeboogie_load_sounds',
  ]);
  assert.equal(calls.configs.length, 1);
  assert.deepEqual(calls.configs[0], {
    pause: true,
    sound: ['music_start_ingame'],
  });
});

test('setSectionLevel clamps 1..10, passes maxLevel: 10, and strictly omits score', () => {
  const { apiClient, calls } = createMockApi();
  const bridge = createHostBridge({ apiClient });

  assert.equal(clampSectionLevel(0), 1);
  assert.equal(clampSectionLevel(-5), 1);
  assert.equal(clampSectionLevel(NaN), 1);
  assert.equal(clampSectionLevel(4.4), 4);
  assert.equal(clampSectionLevel(99), 10);

  bridge.setSectionLevel(1);
  bridge.setSectionLevel(6);
  bridge.setSectionLevel(15);

  assert.equal(calls.scores.length, 3);
  assert.deepEqual(calls.scores[0], { level: 1, maxLevel: 10 });
  assert.deepEqual(calls.scores[1], { level: 6, maxLevel: 10 });
  assert.deepEqual(calls.scores[2], { level: 10, maxLevel: 10 });
  for (const s of calls.scores) {
    assert.equal('score' in s, false, 'score must be omitted so .alt-active stays visible');
  }
});

test('triggerCompletion is idempotent, sets level 10, plays win audio, and calls gameover() with 0 args', () => {
  const { apiClient, calls } = createMockApi();
  const bridge = createHostBridge({ apiClient });

  assert.equal(bridge.triggerCompletion(), true);
  assert.equal(bridge.isCompleted(), true);
  assert.equal(bridge.triggerCompletion(), false, 'second call must be ignored until restart');

  assert.deepEqual(calls.scores, [{ level: 10, maxLevel: 10 }]);
  assert.deepEqual(calls.plays, ['cb_win', 'music_ingame_gameover']);
  assert.equal(calls.gameovers.length, 1);
  assert.equal(calls.gameovers[0].length, 0, 'gameover must NOT pass {share: true}');
});

test('lifecycle events relay pause/resume/restart/mute and reclaim window focus', async () => {
  const { apiClient, calls } = createMockApi();
  let focusCalls = 0;
  const mockWin = {
    focus() {
      focusCalls += 1;
    },
  };
  const bridge = createHostBridge({ apiClient, targetWindow: mockWin });

  const events = [];
  bridge.onPause(() => events.push('pause'));
  bridge.onResume(() => events.push('resume'));
  bridge.onRestart(() => events.push('restart'));
  bridge.onMuteChange((muted) => events.push(`mute:${muted}`));

  let readyRan = false;
  bridge.onReady(async () => {
    readyRan = true;
  });
  await calls.readyCallbacks[0]({});
  assert.equal(readyRan, true);
  assert.equal(focusCalls, 1);

  apiClient.emit('pause');
  assert.deepEqual(events, ['pause']);

  apiClient.emit('resume');
  assert.deepEqual(events, ['pause', 'resume']);
  assert.equal(focusCalls, 2);

  bridge.triggerCompletion();
  assert.equal(bridge.isCompleted(), true);

  apiClient.emit('restart');
  assert.equal(bridge.isCompleted(), false);
  assert.equal(bridge.getCurrentLevel(), 1);
  assert.deepEqual(events, ['pause', 'resume', 'restart']);
  assert.equal(focusCalls, 3);

  apiClient.emit('muted');
  apiClient.emit('unmuted');
  assert.deepEqual(events, ['pause', 'resume', 'restart', 'mute:true', 'mute:false']);
  assert.equal(focusCalls, 5);
});

test('scene index.html, host registration files, and generated PNG dimensions satisfy R2 and R5', () => {
  const html = fs.readFileSync(path.join(SCENE_ROOT, 'index.html'), 'utf8');
  assert.match(html, /id="module-jollyobby"/);
  assert.doesNotMatch(html, /<h1|<p|<button|<span|fonts\.googleapis/i);
  const bodyInner = html.split('<body>')[1].split('</body>')[0]
    .replace(/<div id="module-jollyobby"><\/div>/, '')
    .replace(/<script[^>]*><\/script>/, '')
    .trim();
  assert.equal(bodyInner, '', 'index.html body must contain zero text or extra HUD elements');

  const scenesJs = fs.readFileSync(path.join(REPO_ROOT, 'static/src/strings/scenes.js'), 'utf8');
  assert.match(scenesJs, /'jollyobby':\s*_msg`scene_jollyobby`,/);

  const enSrc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'en_src_messages.json'), 'utf8'));
  assert.equal(enSrc.scene_jollyobby?.message, 'Jolly Obby');

  const enMsg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '_messages/en.json'), 'utf8'));
  assert.equal(enMsg.scene_jollyobby?.message, 'Jolly Obby');

  const rcDefaults = fs.readFileSync(path.join(REPO_ROOT, 'prod/src/remote-config-defaults.js'), 'utf8');
  assert.match(rcDefaults, /'jollyobby'/);

  const santaCardJs = fs.readFileSync(path.join(REPO_ROOT, 'static/src/elements/santa-card.js'), 'utf8');
  assert.doesNotMatch(santaCardJs, /jollyobby/, 'jollyobby must not be added to scenesWithColor Lottie list');

  const pngSpecs = [
    ['static/img/scenes/jollyobby_1x.png', 475, 282],
    ['static/img/scenes/jollyobby_2x.png', 950, 564],
    ['prod/images/og/jollyobby.png', 1333, 1000],
  ];
  for (const [relPath, expectedW, expectedH] of pngSpecs) {
    const buf = fs.readFileSync(path.join(REPO_ROOT, relPath));
    assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(buf.readUInt32BE(16), expectedW, `${relPath} width`);
    assert.equal(buf.readUInt32BE(20), expectedH, `${relPath} height`);
  }
});

test('SOUND_EVENTS.PRELOAD_BANKS includes codeboogie_load_sounds and preloads every SOUND_EVENTS trigger in KLANG_CONFIG', () => {
  const { SOUND_EVENTS } = constants;
  const cfg = globalThis.window.KLANG_CONFIG;
  assert.ok(cfg && cfg.events && cfg.processes && cfg.audio && Array.isArray(cfg.files));
  assert.ok(SOUND_EVENTS.PRELOAD_BANKS.includes('codeboogie_load_sounds'));
  assert.equal(SOUND_EVENTS.PRELOAD_BANKS.includes('cb_load_sounds'), false);

  const loadedGroups = new Set();
  for (const bank of SOUND_EVENTS.PRELOAD_BANKS) {
    const pid = cfg.events[bank];
    assert.ok(pid && cfg.processes[pid], `PRELOAD_BANKS entry ${bank} must exist in KLANG_CONFIG.events`);
    const actionSrc = String(cfg.processes[pid].action || '');
    const match = actionSrc.match(/Klang\.load\(\[([^\]]+)\]/);
    if (match) {
      for (const raw of match[1].split(',')) {
        const g = raw.trim().replace(/^['"]|['"]$/g, '');
        if (g) loadedGroups.add(g);
      }
    }
  }
  assert.ok(loadedGroups.has('codeboogie'), 'codeboogie load_group must be preloaded for WIN cb_win');

  function traceFiles(id, visited = new Set()) {
    if (!id || visited.has(id)) return [];
    visited.add(id);
    const out = [];
    const ao = cfg.audio[id];
    const proc = cfg.processes[id];
    if (ao) {
      if (ao.file_id !== undefined) {
        const f = cfg.files.find((x) => String(x.id) === String(ao.file_id));
        out.push({ fileId: String(ao.file_id), loadGroup: f ? f.load_group : null });
      }
      for (const v of Object.values(ao)) {
        if (typeof v === 'string' && (cfg.audio[v] || cfg.processes[v])) {
          out.push(...traceFiles(v, visited));
        } else if (Array.isArray(v)) {
          for (const c of v) {
            if (typeof c === 'string') out.push(...traceFiles(c, visited));
          }
        }
      }
    }
    if (proc && Array.isArray(proc.vars)) {
      for (const vid of proc.vars) {
        out.push(...traceFiles(vid, visited));
      }
    }
    return out;
  }

  for (const [key, eventName] of Object.entries(SOUND_EVENTS)) {
    if (Array.isArray(eventName)) continue;
    const eid = cfg.events[eventName];
    assert.ok(eid, `SOUND_EVENTS.${key} (${eventName}) must exist in KLANG_CONFIG.events`);
    const files = traceFiles(eid);
    assert.ok(files.length > 0, `SOUND_EVENTS.${key} (${eventName}) must resolve to >= 1 audio file`);
    for (const f of files) {
      assert.ok(
        loadedGroups.has(f.loadGroup),
        `SOUND_EVENTS.${key} (${eventName}) file ${f.fileId} requires load_group ${f.loadGroup} to be preloaded`
      );
    }
  }
});

test('keys.js releases held keys on host window blur when activeElement !== loaderElement and handles Shift+W empty-code case change', () => {
  const sent = [];
  let loaderFocusCalls = 0;
  const loaderElement = {
    tagName: 'SANTA-GAMELOADER',
    disabled: false,
    focus() {
      loaderFocusCalls += 1;
      globalThis.document.activeElement = loaderElement;
    },
  };
  hostGlobal.setState({
    control: {
      send(msg) {
        sent.push(msg);
      },
    },
    hidden: false,
  });

  configureCustomKeys(loaderElement);

  const dispatchHostKey = (type, props) => {
    const ev = Object.assign(new Event(type, { bubbles: true, cancelable: true }), props);
    globalThis.window.dispatchEvent(ev);
    return ev;
  };

  // Bug A: Host window blur while focus is on document.body (activeElement !== loaderElement) emits synthetic keyup
  globalThis.document.activeElement = globalThis.document.body;
  dispatchHostKey('keydown', { key: 'w', code: 'KeyW', repeat: false });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    type: 'keydown',
    payload: { key: 'w', code: 'KeyW', keyCode: 87, repeat: false },
  });

  globalThis.window.dispatchEvent(new Event('blur'));
  assert.equal(sent.length, 2, 'Host blur outside loaderElement must emit synthetic keyup');
  assert.deepEqual(sent[1], {
    type: 'keyup',
    payload: { key: 'w', code: 'KeyW', keyCode: 87, repeat: false },
  });

  // Canvas focus handoff: when activeElement === loaderElement at host blur time, do NOT emit premature keyup
  sent.length = 0;
  globalThis.document.activeElement = globalThis.document.body;
  dispatchHostKey('keydown', { key: 's', code: 'KeyS', repeat: false });
  assert.equal(sent.length, 1);
  globalThis.document.activeElement = loaderElement;
  globalThis.window.dispatchEvent(new Event('blur'));
  assert.equal(sent.length, 1, 'Canvas focus handoff (activeElement === loaderElement) must not emit premature keyup');

  // Bug B: Shift+W ('W') -> Shift up -> 'w' up with empty ev.code === '' releases cleanly and focuses loaderElement
  sent.length = 0;
  loaderFocusCalls = 0;
  globalThis.document.activeElement = globalThis.document.body;
  dispatchHostKey('keydown', { key: 'W', code: '', repeat: false });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'keydown');
  assert.equal(sent[0].payload.keyCode, 87);

  dispatchHostKey('keyup', { key: 'w', code: '', repeat: false });
  assert.equal(sent.length, 2, 'Lowercase keyup after uppercase keydown with empty code must emit keyup');
  assert.deepEqual(sent[1], {
    type: 'keyup',
    payload: { key: 'w', code: '', keyCode: 87, repeat: false },
  });
  assert.equal(loaderFocusCalls, 1);
});

