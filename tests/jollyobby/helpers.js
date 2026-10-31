const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { DEFAULT_SEED, expectGameOverOverlay, sceneHelpers } = require('../helpers');

const WORKTREE_ROOT = path.resolve(__dirname, '../..');
const BASE_REPO_ROOT = path.resolve(WORKTREE_ROOT, '../../santa-tracker-web');
const SCENE_DIR = path.join(WORKTREE_ROOT, 'static/scenes/jollyobby');

const jollyobby = sceneHelpers('jollyobby', '#module-jollyobby');

const CAMERA_ORBIT_SENSITIVITY = 0.0055;

/** @type {!WeakMap<!import('@playwright/test').Page, { elapsed: number, paused: boolean }>} */
const pageSimClocks = new WeakMap();

/** @type {!Map<string, { status: number, headers: !Object<string, string>, body: !Buffer }>} */
const vendorModuleCache = new Map();

function getSimClock(page) {
  let c = pageSimClocks.get(page);
  if (!c) {
    c = { elapsed: 0, paused: false };
    pageSimClocks.set(page, c);
  }
  return c;
}

/**
 * Dynamically resolves prod and static VFS origins/ports from Playwright's `baseURL`
 * or `process.env.PORT` (defaulting to dedicated port 10300).
 * @param {string|undefined} baseURL
 */
function resolveServerUrls(baseURL) {
  const fallbackPort = Number(process.env.PORT) || 10300;
  const effectiveBase = baseURL || `http://localhost:${fallbackPort}`;
  const parsed = new URL(effectiveBase);
  const prodPort = Number(parsed.port) || fallbackPort;
  const staticPort = prodPort + 80;
  return {
    prodOrigin: parsed.origin,
    hostname: parsed.hostname,
    prodPort,
    staticPort,
    staticOrigin: `http://127.0.0.1:${staticPort}`,
    staticBase: `http://127.0.0.1:${staticPort}/st`,
  };
}

/**
 * Reads PNG width/height directly from the 24-byte IHDR header.
 * @param {string} filePath
 */
function readPngMetadata(filePath) {
  const buf = fs.readFileSync(filePath);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const validSignature = buf.length >= 24 && buf.subarray(0, 8).equals(pngSig);
  const ihdrChunk = buf.length >= 24 ? buf.subarray(12, 16).toString('ascii') : '';
  const width = buf.length >= 24 ? buf.readUInt32BE(16) : 0;
  const height = buf.length >= 24 ? buf.readUInt32BE(20) : 0;
  return {
    exists: true,
    sizeBytes: buf.length,
    validSignature: validSignature && ihdrChunk === 'IHDR',
    width,
    height,
  };
}

/**
 * Recursively lists files relative to `dirPath`.
 * @param {string} dirPath
 * @param {string=} prefix
 * @return {!Array<string>}
 */
function listRelativeFiles(dirPath, prefix = '') {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listRelativeFiles(full, rel));
    } else if (entry.isFile()) {
      results.push(rel);
    }
  }
  return results.sort();
}

/**
 * Installs passive, non-invasive init-script spies inside `/scenes/jollyobby/`
 * BEFORE any scene module runs, recording:
 *  - `window.__E2E_REGISTERED_EVENTS__`: array of `{ target, type }`
 *  - `window.__E2E_CANVAS_TEXT_CALLS__`: array of `{ method, text }`
 * Does NOT touch customElements, santa-gameloader, or service workers.
 * @param {import('@playwright/test').Page} page
 */
async function installSceneForensicSpies(page) {
  await page.addInitScript(() => {
    if (!location.pathname.includes('/scenes/jollyobby/')) return;
    if (window.__E2E_REGISTERED_EVENTS__) return;
    const events = [];
    const textCalls = [];
    Object.defineProperty(window, '__E2E_REGISTERED_EVENTS__', {
      value: events,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(window, '__E2E_CANVAS_TEXT_CALLS__', {
      value: textCalls,
      writable: false,
      configurable: false,
    });

    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      events.push({
        target:
          this === window
            ? 'window'
            : this === document
            ? 'document'
            : this && this.tagName
            ? String(this.tagName)
            : 'EventTarget',
        type: String(type),
      });
      return origAdd.call(this, type, listener, options);
    };

    if (typeof CanvasRenderingContext2D !== 'undefined') {
      for (const method of ['fillText', 'strokeText']) {
        const orig = CanvasRenderingContext2D.prototype[method];
        if (typeof orig === 'function') {
          CanvasRenderingContext2D.prototype[method] = function(text, ...rest) {
            textCalls.push({ method, text: String(text) });
            return orig.call(this, text, ...rest);
          };
        }
      }
    }
  });
}

/**
 * Attaches strict console.error, pageerror, local HTTP 4xx/5xx, external CDN asset leak,
 * and retired Firebase Dynamic Links monitors to `page`, while fast-stubbing third-party
 * analytics/fonts/remote-config endpoints so local `remote-config-defaults.js` stays authoritative.
 * @param {import('@playwright/test').Page} page
 */
async function attachRuntimeMonitors(page) {
  const monitors = {
    pageErrors: [],
    consoleErrors: [],
    consoleWarnings: [],
    localHttpFailures: [],
    localAssetLoads: [],
    externalSceneAssetRequests: [],
    firebaseShortLinkCalls: 0,
  };

  // Memoize immutable third-party /node_modules/ Rollup responses after first real fetch from the active port
  await page.route(/\/node_modules\//, async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() !== 'GET') {
      return route.continue();
    }
    const cached = vendorModuleCache.get(url);
    if (cached) {
      return route.fulfill(cached);
    }
    const upstream = await route.fetch();
    const body = await upstream.body();
    const status = upstream.status();
    const headers = upstream.headers();
    if (status === 200) {
      vendorModuleCache.set(url, { status, headers, body });
    }
    return route.fulfill({ status, headers, body });
  });

  await page.route(
    /^https:\/\/(www\.googletagmanager\.com|www\.google-analytics\.com|analytics\.google\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|maps\.gstatic\.com|santa-api\.appspot\.com)\//,
    (route) => route.fulfill({ status: 204, body: '' })
  );

  // Stub Firebase Installations & Remote Config with valid schemas so initialize() resolves instantly using local defaults
  await page.route(/^https:\/\/firebaseinstallations\.googleapis\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        fid: 'c0ffee1234567890abcdef',
        refreshToken: 'e2e-refresh-token',
        authToken: {
          token: 'e2e-auth-token',
          expiresIn: '604800s',
        },
      }),
    })
  );

  await page.route(/^https:\/\/firebaseremoteconfig\.googleapis\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ state: 'NO_CHANGE' }),
    })
  );

  await page.route(/firebasedynamiclinks\.googleapis\.com/, (route) => {
    monitors.firebaseShortLinkCalls += 1;
    return route.abort('failed');
  });

  page.on('request', (req) => {
    const url = req.url();
    if (
      /^https?:\/\//.test(url) &&
      !url.includes('localhost:') &&
      !url.includes('127.0.0.1:') &&
      !/googletagmanager|google-analytics|analytics\.google|fonts\.googleapis|fonts\.gstatic|maps\.gstatic|santa-api\.appspot|firebaseremoteconfig|firebaseinstallations|firebasedynamiclinks/.test(
        url
      )
    ) {
      monitors.externalSceneAssetRequests.push(url);
    }
  });

  page.on('pageerror', (err) => {
    monitors.pageErrors.push(String((err && err.stack) || err));
  });

  page.on('console', (msg) => {
    const loc = msg.location ? msg.location() : null;
    const locUrl = (loc && loc.url) || '';
    if (msg.type() === 'error') {
      // Upstream santa-card.js uses img.onerror -> unknown.png when random overlay card picks legacy 'build' alias
      if (/\/img\/scenes\/build_[12]x\.png$/i.test(locUrl)) {
        return;
      }
      monitors.consoleErrors.push(locUrl ? `${msg.text()} @ ${locUrl}` : msg.text());
    } else if (msg.type() === 'warning') {
      monitors.consoleWarnings.push(msg.text());
    }
  });

  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('localhost:') || url.includes('127.0.0.1:')) {
      if (res.status() >= 400) {
        if (/\/img\/scenes\/build_[12]x\.png$/i.test(url)) {
          return;
        }
        monitors.localHttpFailures.push(`${res.status()} ${url}`);
      } else if (/\.(gltf|bin|obj|png|jpg|jpeg)(\?|$)/i.test(url)) {
        monitors.localAssetLoads.push({ status: res.status(), url });
      }
    }
  });

  return monitors;
}

/**
 * Loads `/jollyobby.html` (or localized/custom path) with forensic spies + monitors + `jollyobby.load()`.
 * @param {import('@playwright/test').Page} page
 * @param {string|undefined} baseURL
 * @param {{seed?: string, query?: string, timeout?: number, routePath?: string}=} options
 */
async function loadJollyObby(page, baseURL, options = {}) {
  const monitors = await attachRuntimeMonitors(page);
  await installSceneForensicSpies(page);

  if (options.routePath) {
    const seed = options.seed || DEFAULT_SEED;
    const timeout = options.timeout || 90000;
    await page.addInitScript((s) => {
      window.__MANUAL_TIME__ = true;
      window.__RANDOM_SEED__ = s;
    }, seed);
    const { prodOrigin } = resolveServerUrls(baseURL);
    await page.goto(`${prodOrigin}${options.routePath}`, { waitUntil: 'domcontentloaded' });
    await jollyobby.gameElem(page).waitFor({ state: 'attached', timeout });
    const f = await jollyobby.contentFrame(page);
    await f.evaluate(
      async ({ t }) => {
        const deadline = Date.now() + t;
        while (!(window.__TEST_CONTROL__ && window.__TEST_CONTROL__.isReady())) {
          if (Date.now() > deadline) {
            throw new Error('window.__TEST_CONTROL__.isReady() timed out');
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      },
      { t: timeout }
    );
    await page.waitForFunction(
      () => {
        const interlude = document.querySelector('santa-interlude');
        return !interlude || !interlude.hasAttribute('active');
      },
      null,
      { timeout }
    );
    await f.evaluate(async ({ s }) => {
      await new Promise((r) => setTimeout(r, 100));
      if (window.Random && window.Random.setSeed) {
        window.Random.setSeed(s);
      }
    }, { s: seed });
  } else {
    await jollyobby.load(page, baseURL, options);
  }

  pageSimClocks.set(page, { elapsed: 0, paused: false });
  return monitors;
}

function assertZeroRuntimeErrors(monitors) {
  expect(monitors.pageErrors, 'Uncaught pageerror exceptions').toEqual([]);
  expect(monitors.consoleErrors, 'Unexpected console.error messages').toEqual([]);
  expect(monitors.localHttpFailures, 'Local 4xx/5xx HTTP responses').toEqual([]);
  expect(
    monitors.firebaseShortLinkCalls,
    'Forbidden {share:true} Firebase Dynamic Links shortLinks POST'
  ).toBe(0);
  const missingClipWarnings = monitors.consoleWarnings.filter((w) =>
    /clip|animation|skinnedmesh/i.test(w)
  );
  expect(missingClipWarnings, 'Missing animation clip or SkinnedMesh warnings').toEqual([]);
}

/**
 * Advances manual simulation time and tracks cumulative courseElapsed for closed-loop phase timing.
 * @param {import('@playwright/test').Page} page
 * @param {number} seconds
 * @param {{step?: number}=} options
 */
async function advanceTime(page, seconds, options = {}) {
  const clock = getSimClock(page);
  await jollyobby.advanceTime(page, seconds, options);
  const numeric = Number(seconds);
  if (Number.isFinite(numeric) && numeric > 0 && !clock.paused) {
    clock.elapsed += numeric;
  }
}

/**
 * Reads frozen snapshot from `window.__TEST_CONTROL__.getSnapshot()`.
 * @param {import('@playwright/test').Page} page
 */
async function getSnapshot(page) {
  const f = await jollyobby.contentFrame(page);
  return f.evaluate(() => window.__TEST_CONTROL__.getSnapshot());
}

/**
 * Reads `<santa-badge>` properties and open Shadow DOM rendered level state.
 * Waits one LitElement update cycle so cross-frame `postMessage` updates have settled.
 * @param {import('@playwright/test').Page} page
 */
async function getBadgeState(page) {
  return page.evaluate(async () => {
    const badge = document.querySelector('santa-badge');
    if (!badge) return null;
    await new Promise((r) => setTimeout(r, 20));
    if (badge.updateComplete) {
      await badge.updateComplete;
    }
    const root = badge.shadowRoot;
    const item = root ? root.querySelector('.item.alt-active') : null;
    const alt = root ? root.querySelector('.data.alt') : null;
    const span = alt ? alt.querySelector('span') : null;
    const label = alt ? alt.querySelector('label') : null;
    const displayText = span ? span.textContent.replace(/\s+/g, '') : '';
    const labelText = label ? label.textContent.trim() : '';
    return {
      level: badge.level,
      maxLevel: badge.maxLevel,
      score: badge.score,
      time: badge.time,
      altActive: Boolean(item),
      altHidden: alt ? alt.hasAttribute('hidden') : true,
      displayText,
      labelText,
    };
  });
}

/**
 * Polls `<santa-badge>` until it reflects `expectedLevel·10` with `Level` label and `score === 0`.
 * @param {import('@playwright/test').Page} page
 * @param {number} expectedLevel
 */
async function expectBadgeLevel(page, expectedLevel) {
  await expect
    .poll(
      async () => {
        const b = await getBadgeState(page);
        return b
          ? {
              level: b.level,
              maxLevel: b.maxLevel,
              score: b.score,
              altActive: b.altActive,
              altHidden: b.altHidden,
              displayText: b.displayText,
              isLevelLabel: /^level$/i.test(b.labelText) && !/iced/i.test(b.labelText),
            }
          : null;
      },
      { timeout: 5000 }
    )
    .toEqual({
      level: expectedLevel,
      maxLevel: 10,
      score: 0,
      altActive: true,
      altHidden: false,
      displayText: `${expectedLevel}\u00b710`,
      isLevelLabel: true,
    });
}

/**
 * Computes safe viewport coordinates inside the `jollyobby` iframe below `<santa-chrome>`.
 * @param {import('@playwright/test').Page} page
 */
async function getCanvasSafeCenter(page) {
  const box = await jollyobby.iframe(page).boundingBox();
  if (!box) {
    throw new Error('jollyobby iframe has no boundingBox');
  }
  return {
    x: box.x + box.width * 0.5,
    y: box.y + box.height * 0.58,
    width: box.width,
    height: box.height,
    box,
  };
}

function shortestAngle(from, to) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

/**
 * Orbits the third-person camera via genuine Playwright `page.mouse` left-click drag gestures.
 * Splits wide drags into safe viewport-bounded strokes when `splitStrokes !== false`.
 * @param {import('@playwright/test').Page} page
 * @param {number} dxPx
 * @param {number} dyPx
 * @param {{steps?: number, settleSec?: number, button?: 'left'|'right', splitStrokes?: boolean}=} options
 */
async function orbitCameraByDrag(page, dxPx, dyPx, options = {}) {
  const steps = options.steps ?? 6;
  const settleSec = options.settleSec ?? 0.15;
  const button = options.button || 'left';
  const splitStrokes = options.splitStrokes !== false;
  const { x: cx, y: cy, width, height, box } =
    options.centerInfo || (await getCanvasSafeCenter(page));

  const maxHalfX = Math.max(60, Math.min(240, width * 0.34));
  const maxHalfY = Math.max(50, Math.min(160, height * 0.25));

  if (!splitStrokes || (Math.abs(dxPx) <= maxHalfX * 1.8 && Math.abs(dyPx) <= maxHalfY * 1.8)) {
    const startX = Math.max(box.x + 16, Math.min(box.x + width - 16, cx - dxPx * 0.5));
    const startY = Math.max(box.y + 92, Math.min(box.y + height - 16, cy - dyPx * 0.5));
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button });
    await page.mouse.move(startX + dxPx, startY + dyPx, { steps });
    await page.mouse.up({ button });
  } else {
    let remX = dxPx;
    let remY = dyPx;
    while (Math.abs(remX) > 0.5 || Math.abs(remY) > 0.5) {
      const segX = Math.max(-maxHalfX * 1.6, Math.min(maxHalfX * 1.6, remX));
      const segY = Math.max(-maxHalfY * 1.6, Math.min(maxHalfY * 1.6, remY));
      const startX = cx - segX * 0.5;
      const startY = Math.max(box.y + 96, cy - segY * 0.5);
      await page.mouse.move(startX, startY);
      await page.mouse.down({ button });
      await page.mouse.move(startX + segX, startY + segY, { steps: Math.max(1, Math.min(steps, 3)) });
      await page.mouse.up({ button });
      remX -= segX;
      remY -= segY;
    }
  }

  if (settleSec > 0) {
    await advanceTime(page, settleSec);
  }
}

/**
 * Aligns camera yaw to `desiredYaw` via native mouse click-drag on the canvas.
 * @param {import('@playwright/test').Page} page
 * @param {number} desiredYaw
 * @param {{currentYaw?: number, settleSec?: number, centerInfo?: Object}=} options
 */
async function orbitCameraToYaw(page, desiredYaw, options = {}) {
  const currentYaw =
    typeof options.currentYaw === 'number'
      ? options.currentYaw
      : (await getSnapshot(page)).camera.yaw;
  const deltaYaw = shortestAngle(currentYaw, desiredYaw);
  if (Math.abs(deltaYaw) < 0.008) return;
  const dxPx = -deltaYaw / CAMERA_ORBIT_SENSITIVITY;
  await orbitCameraByDrag(page, dxPx, 0, {
    steps: 1,
    settleSec: options.settleSec ?? 0,
    centerInfo: options.centerInfo,
  });
}

/**
 * Zooms the camera via native `page.mouse.wheel(0, deltaY)` over the canvas center.
 * @param {import('@playwright/test').Page} page
 * @param {number} deltaY
 * @param {number=} settleSec
 */
async function zoomCameraByWheel(page, deltaY, settleSec = 0.35) {
  const { x, y } = await getCanvasSafeCenter(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, deltaY);
  if (settleSec > 0) {
    await advanceTime(page, settleSec);
  }
}

const ALL_GAME_KEYS = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowLeft',
  'ArrowDown',
  'ArrowRight',
  'Space',
];

async function releaseAllGameKeys(page) {
  for (const code of ALL_GAME_KEYS) {
    await page.keyboard.up(code);
  }
}

/**
 * Holds `keyCodes` via `page.keyboard.down`, advances simulation by `durationSec`, then releases.
 * @param {import('@playwright/test').Page} page
 * @param {!Array<string>} keyCodes
 * @param {number} durationSec
 * @param {number=} stepSec
 */
async function holdKeysAndAdvance(page, keyCodes, durationSec, stepSec = 0) {
  for (const code of keyCodes) {
    await page.keyboard.down(code);
  }
  try {
    await advanceTime(page, durationSec, stepSec ? { step: stepSec } : {});
  } finally {
    for (let i = keyCodes.length - 1; i >= 0; i--) {
      await page.keyboard.up(keyCodes[i]);
    }
  }
}

async function clickChromePauseOrPlay(page) {
  const before = await getSnapshot(page);
  const actionBtn = page.locator('santa-chrome header santa-button').nth(2);
  await actionBtn.click();
  if (before.completed) {
    await expect
      .poll(
        async () => {
          const s = await getSnapshot(page);
          return !s.completed && !s.paused && s.activeCheckpoint === 0;
        },
        { timeout: 5000 }
      )
      .toBe(true);
    pageSimClocks.set(page, { elapsed: 0, paused: false });
  } else {
    await expect
      .poll(async () => (await getSnapshot(page)).paused, { timeout: 5000 })
      .toBe(!before.paused);
    getSimClock(page).paused = !before.paused;
  }
  return getSnapshot(page);
}

async function clickChromeMuteToggle(page) {
  const audioBtn = page.locator('santa-chrome header santa-button').nth(1);
  await audioBtn.click();
  await page.waitForTimeout(30);
  return page.evaluate(() => Boolean(document.querySelector('santa-chrome').muted));
}

async function clickChromeHome(page) {
  const menuBtn = page.locator('santa-chrome header santa-button').nth(0);
  await menuBtn.click();
}

async function clickOverlayPlay(page) {
  const playBtn = page.locator('santa-overlay #playButton');
  await expect(playBtn).toBeVisible();
  await playBtn.click();
  await expect(page.locator('santa-overlay')).toHaveAttribute('hidden', '');
  await expect.poll(async () => (await getSnapshot(page)).paused, { timeout: 5000 }).toBe(false);
  getSimClock(page).paused = false;
}

async function clickOverlayPlayAgain(page) {
  const playAgainBtn = page.locator('santa-overlay #playagainButton');
  await expect(playAgainBtn).toBeVisible();
  await playAgainBtn.click();
  await expect(page.locator('santa-overlay')).toHaveAttribute('hidden', '');
  await expect
    .poll(
      async () => {
        const s = await getSnapshot(page);
        return (
          !s.paused &&
          !s.completed &&
          s.activeCheckpoint === 0 &&
          Math.hypot(s.player.x, s.player.z) < 0.05
        );
      },
      { timeout: 5000 }
    )
    .toBe(true);
  pageSimClocks.set(page, { elapsed: 0, paused: false });
}

async function clickOverlayHome(page) {
  const homeBtn = page.locator('santa-overlay santa-button[data-action="home"]');
  await expect(homeBtn).toBeVisible();
  await homeBtn.click();
}

/**
 * Renders 1 frame and samples a 7x7 grid of pixels from the WebGL framebuffer inside the same task.
 * @param {import('@playwright/test').Page} page
 */
async function sampleWebGLFrame(page) {
  const f = await jollyobby.contentFrame(page);
  const res = await f.evaluate(() => {
    window.__TEST_CONTROL__.advanceTime(1 / 60);
    const canvas = document.querySelector('#module-jollyobby canvas');
    if (!canvas) {
      throw new Error('Missing #module-jollyobby canvas');
    }
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      throw new Error('WebGL context unavailable');
    }
    const glError = gl.getError();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const pixel = new Uint8Array(4);
    const colorBuckets = new Set();
    const samples = [];
    let nonTransparent = 0;
    const gridN = 7;

    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        const px = Math.min(w - 1, Math.max(0, Math.floor(((gx + 0.5) / gridN) * w)));
        const py = Math.min(h - 1, Math.max(0, Math.floor(((gy + 0.5) / gridN) * h)));
        gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (pixel[3] > 0) nonTransparent += 1;
        const qKey = `${pixel[0] >> 3}_${pixel[1] >> 3}_${pixel[2] >> 3}`;
        colorBuckets.add(qKey);
        samples.push(`${pixel[0]},${pixel[1]},${pixel[2]}`);
      }
    }

    return {
      width: w,
      height: h,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      glError,
      distinctColors: colorBuckets.size,
      nonTransparentRatio: nonTransparent / (gridN * gridN),
      signature: samples.join('|'),
    };
  });
  const clock = getSimClock(page);
  if (!clock.paused) {
    clock.elapsed += 1 / 60;
  }
  return res;
}

/**
 * Forensic runtime audit verifying R4 (strict zero touch controls) and
 * R5 (strict zero in-scene UI/HUD and zero text in DOM, pseudo-elements, and 2D canvases).
 * @param {import('@playwright/test').Page} page
 */
async function assertZeroUiTextAndTouch(page) {
  const f = await jollyobby.contentFrame(page);
  const sceneAudit = await f.evaluate(() => {
    const root = document.querySelector('#module-jollyobby');
    if (!root) {
      return { ok: false, reason: 'Missing #module-jollyobby' };
    }
    const rootChildren = Array.from(root.children).map((el) => el.tagName);

    const forbiddenSelector = [
      'button',
      'input',
      'select',
      'textarea',
      'svg',
      'p',
      'span',
      'label',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      '[role="button"]',
      '[class*="hud" i]',
      '[class*="ui" i]',
      '[class*="score" i]',
      '[class*="level" i]',
      '[class*="banner" i]',
      '[class*="toast" i]',
      '[class*="touch" i]',
      '[class*="thumb" i]',
      '[class*="joy" i]',
      '[class*="dpad" i]',
      '[id*="jump" i]',
      '[id*="splash" i]',
      '[id*="hud" i]',
      '[id*="touch" i]',
    ].join(',');
    const forbiddenMatches = Array.from(document.querySelectorAll(forbiddenSelector)).map(
      (el) => `${el.tagName}#${el.id}.${el.className}`
    );

    const bodyInnerText = (document.body && document.body.innerText ? document.body.innerText : '').trim();

    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parentTag = node.parentElement ? node.parentElement.tagName : '';
      if (parentTag !== 'SCRIPT' && parentTag !== 'STYLE') {
        const trimmed = (node.nodeValue || '').trim();
        if (trimmed.length > 0) {
          textNodes.push(trimmed);
        }
      }
      node = walker.nextNode();
    }

    const pseudoTextViolations = [];
    const tooltipViolations = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      for (const pseudo of ['::before', '::after']) {
        const content = getComputedStyle(el, pseudo).content;
        if (
          content &&
          content !== 'none' &&
          content !== 'normal' &&
          content !== '""' &&
          content !== "''"
        ) {
          pseudoTextViolations.push(`${el.tagName}${pseudo}=${content}`);
        }
      }
      if (el.closest('#module-jollyobby')) {
        for (const attr of ['aria-label', 'title', 'alt']) {
          const val = el.getAttribute(attr);
          if (val && val.trim().length > 0) {
            tooltipViolations.push(`${el.tagName}[${attr}=${val}]`);
          }
        }
      }
    }

    const registeredEvents = Array.isArray(window.__E2E_REGISTERED_EVENTS__)
      ? window.__E2E_REGISTERED_EVENTS__
      : [];
    const touchRegistrations = registeredEvents.filter((e) => /^touch/i.test(e.type));
    const canvasTextCalls = Array.isArray(window.__E2E_CANVAS_TEXT_CALLS__)
      ? window.__E2E_CANVAS_TEXT_CALLS__
      : [];

    return {
      rootChildren,
      forbiddenMatches,
      bodyInnerText,
      textNodes,
      pseudoTextViolations,
      tooltipViolations,
      touchRegistrations,
      canvasTextCalls,
    };
  });

  expect(sceneAudit.rootChildren, '#module-jollyobby must contain only <canvas>').toEqual([
    'CANVAS',
  ]);
  expect(sceneAudit.forbiddenMatches, 'Forbidden UI/HUD/touch DOM elements').toEqual([]);
  expect(sceneAudit.bodyInnerText, 'Scene iframe innerText must be empty').toBe('');
  expect(sceneAudit.textNodes, 'Scene DOM non-whitespace text nodes').toEqual([]);
  expect(sceneAudit.pseudoTextViolations, 'CSS ::before/::after text content').toEqual([]);
  expect(sceneAudit.tooltipViolations, 'Visible tooltip/label attributes inside #module-jollyobby').toEqual([]);
  expect(sceneAudit.touchRegistrations, 'Registered touch* event listeners (R4)').toEqual([]);
  expect(sceneAudit.canvasTextCalls, '2D canvas fillText/strokeText calls (R5)').toEqual([]);

  const hostTutorialActive = await page.evaluate(() => {
    const tut = document.querySelector('santa-tutorial');
    return Boolean(tut && !tut.hidden && tut._activeNode);
  });
  expect(hostTutorialActive, 'Host <santa-tutorial> must not show tutorial cards').toBe(false);
}

/**
 * Computes deterministic wait time (in seconds) before jumping onto a moving/rotating/sweeping
 * platform so the platform is aligned at player arrival, using `pageSimClocks` elapsed time.
 */
function computeDynamicWindowWaitSec(wp, prevWp, currentSimElapsed, playerX) {
  const dt = 1 / 60;
  if (wp.section === 6 && wp.kind === 'moving') {
    const giftIndex = wp.z === -57.8 ? 0 : wp.z === -47.8 ? 1 : 2;
    const phase = giftIndex === 1 ? Math.PI : 0;
    const omega = (Math.PI * 2) / 4.2;
    for (let w = 0; w < 300; w++) {
      const arrivalT = currentSimElapsed + w * dt + 0.32;
      const predOffset = Math.abs(4.5 * Math.sin(omega * arrivalT + phase));
      if (predOffset < 1.05 && (Math.abs(playerX - 118.5) < 2.2 || w > 60)) {
        return w * dt;
      }
    }
  } else if (wp.section === 7 && wp.kind === 'rotating') {
    const omega = wp.x === 103.0 ? 0.55 : wp.x === 89.0 ? -0.55 : 0.65;
    const phase = wp.x === 89.0 ? Math.PI / 4 : 0;
    for (let w = 0; w < 260; w++) {
      const arrivalYaw = phase + omega * (currentSimElapsed + w * dt + 0.42);
      if (Math.cos(4 * arrivalYaw) > 0.65) {
        return w * dt;
      }
    }
  } else if (wp.section === 9 && wp.kind === 'sweeper_deck') {
    const isDrum1 = wp.z === -79.8;
    const omega = isDrum1 ? 1.3 : -1.3;
    const phase = isDrum1 ? 0 : Math.PI;
    for (let w = 0; w < 360; w++) {
      const thetaAtLanding = phase + omega * (currentSimElapsed + w * dt + 0.55);
      if (Math.cos(thetaAtLanding) < -0.45) {
        return w * dt;
      }
    }
  } else if (wp.section === 10 && (wp.kind === 'moving' || (prevWp && prevWp.kind === 'moving'))) {
    for (let w = 0; w < 300; w++) {
      const glideZ = -64.2 + 3.0 * Math.sin(1.45 * (currentSimElapsed + w * dt + 0.3));
      if (wp.kind === 'moving' && glideZ < -65.8) return w * dt;
      if (prevWp && prevWp.kind === 'moving' && glideZ > -62.4) return w * dt;
    }
  }
  return 0;
}

/**
 * Finds the waypoint index in `sectionWaypoints` corresponding to `checkpointIndex` (`0..9`).
 */
function findCheckpointWaypointIndex(waypoints, checkpoints, checkpointIndex) {
  const cp = checkpoints[checkpointIndex];
  if (!cp) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (wp.kind === 'checkpoint') {
      const d = Math.hypot(wp.x - cp.x, wp.z - cp.z);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

/**
 * Closed-loop pure-input navigation driver using strictly genuine Playwright `page.keyboard`
 * (`WASD` or `ARROWS` + `Space`) and `page.mouse` camera drag.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} targetCheckpointIndex (`1..9`, or `10` for FinishGoal)
 * @param {{
 *   keyScheme?: 'WASD'|'ARROWS',
 *   useCameraOrbit?: boolean,
 *   allowRespawn?: boolean,
 *   onCheckpoint?: function(number, Object): Promise<void>|void,
 * }=} opts
 */
async function navigateToTarget(page, targetCheckpointIndex, opts = {}) {
  const keyScheme = opts.keyScheme || 'WASD';
  const useCameraOrbit = opts.useCameraOrbit !== false;
  const allowRespawn = opts.allowRespawn !== false;

  const keyMap =
    keyScheme === 'ARROWS'
      ? { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
      : { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD' };

  const heldSet = new Set();
  const syncHeldKeys = async (desiredCodes) => {
    const nextSet = new Set(desiredCodes);
    for (const oldCode of Array.from(heldSet)) {
      if (!nextSet.has(oldCode)) {
        await page.keyboard.up(oldCode);
        heldSet.delete(oldCode);
      }
    }
    for (const newCode of nextSet) {
      if (!heldSet.has(newCode)) {
        await page.keyboard.down(newCode);
        heldSet.add(newCode);
      }
    }
  };

  const startElapsed = getSimClock(page).elapsed;
  let snap = await getSnapshot(page);
  const waypoints = snap.sectionWaypoints;
  const visitedLevels = [snap.currentSection];
  let lastReportedCp = snap.activeCheckpoint;
  let respawns = 0;

  let startWpIdx = findCheckpointWaypointIndex(waypoints, snap.checkpoints, snap.activeCheckpoint) + 1;
  // Also advance startWpIdx if player is already farther along the current section
  for (let i = startWpIdx; i < waypoints.length; i++) {
    if (
      Math.hypot(waypoints[i].x - snap.player.x, waypoints[i].z - snap.player.z) < 1.8 &&
      Math.abs(waypoints[i].y - snap.player.y) < 2.2
    ) {
      startWpIdx = i + 1;
    }
  }

  const endWpIdx =
    targetCheckpointIndex >= 10
      ? waypoints.length - 1
      : findCheckpointWaypointIndex(waypoints, snap.checkpoints, targetCheckpointIndex);

  const cachedCenterInfo = await getCanvasSafeCenter(page);

  try {
    let idx = startWpIdx;
    let safetyRetries = 0;

    while (idx <= endWpIdx) {
      const prevWp = waypoints[Math.max(0, idx - 1)];
      const wp = waypoints[idx];

      snap = await getSnapshot(page);
      if (snap.completed || (targetCheckpointIndex < 10 && snap.activeCheckpoint >= targetCheckpointIndex)) {
        break;
      }

      const waitSec = computeDynamicWindowWaitSec(wp, prevWp, getSimClock(page).elapsed, snap.player.x);
      if (waitSec > 0) {
        await syncHeldKeys([]);
        await advanceTime(page, waitSec);
        snap = await getSnapshot(page);
      }

      const legSpan = Math.hypot(wp.x - prevWp.x, wp.z - prevWp.z);
      const isRampWalk = wp.kind === 'ramp' || prevWp.kind === 'ramp';
      const isBeamHurdleJump = prevWp.kind === 'beam' && wp.kind === 'beam';
      const needsJump = !isRampWalk && (isBeamHurdleJump || wp.y > prevWp.y + 0.05 || legSpan > 4.2);

      let jumpTriggerDist;
      if (isBeamHurdleJump) {
        jumpTriggerDist = 8.6;
      } else if (wp.kind === 'goal') {
        jumpTriggerDist = 12.4;
      } else if (prevWp.kind === 'rotating') {
        jumpTriggerDist = legSpan - 1.35;
      } else if (prevWp.kind === 'checkpoint' && legSpan >= 14.5) {
        jumpTriggerDist = legSpan - 5.0;
      } else {
        jumpTriggerDist = Math.min(9.8, Math.max(5.8, legSpan - 1.6));
      }

      let jumpedForThisLeg = false;
      let reachedLeg = false;
      let respawnedOnLeg = false;
      let prevDistXZ = Infinity;
      const cpWpIdxForActive = findCheckpointWaypointIndex(
        waypoints,
        snap.checkpoints,
        snap.activeCheckpoint
      );
      const arriveRadius =
        wp.kind === 'goal'
          ? 3.5
          : wp.kind === 'checkpoint'
          ? 2.2
          : wp.kind === 'ramp'
          ? 1.5
          : 1.40;

      for (let iter = 0; iter < 150; iter++) {
        snap = await getSnapshot(page);

        if (snap.activeCheckpoint > lastReportedCp) {
          lastReportedCp = snap.activeCheckpoint;
          if (!visitedLevels.includes(snap.currentSection)) {
            visitedLevels.push(snap.currentSection);
          }
          if (typeof opts.onCheckpoint === 'function') {
            await syncHeldKeys([]);
            await opts.onCheckpoint(snap.activeCheckpoint, snap);
            snap = await getSnapshot(page);
          }
        }

        if (snap.completed) {
          if (!visitedLevels.includes(10)) visitedLevels.push(10);
          reachedLeg = true;
          break;
        }
        if (targetCheckpointIndex < 10 && snap.activeCheckpoint >= targetCheckpointIndex) {
          reachedLeg = true;
          break;
        }

        const dx = wp.x - snap.player.x;
        const dz = wp.z - snap.player.z;
        const distXZ = Math.hypot(dx, dz);

        if (distXZ <= arriveRadius && Math.abs(snap.player.y - wp.y) <= 2.4 && snap.player.grounded) {
          reachedLeg = true;
          break;
        }

        // Detect unexpected respawn back to active checkpoint (even across multi-frame chunks)
        const activeCpObj = snap.checkpoints[snap.activeCheckpoint];
        if (
          iter > 1 &&
          activeCpObj &&
          idx > cpWpIdxForActive + 1 &&
          (distXZ > prevDistXZ + 6.0 ||
            (Math.hypot(snap.player.x - activeCpObj.x, snap.player.z - activeCpObj.z) < 2.2 &&
              distXZ > 8.0))
        ) {
          respawns += 1;
          if (!allowRespawn) {
            throw new Error(
              `Unexpected respawn while navigating to waypoint #${idx} (${wp.kind}, section ${wp.section})`
            );
          }
          respawnedOnLeg = true;
          break;
        }
        prevDistXZ = distXZ;

        // Self-heal if browser focus transiently dropped a held key while grounded
        if (
          iter > 0 &&
          heldSet.size > 0 &&
          snap.player.grounded &&
          Math.hypot(snap.player.vx, snap.player.vz) < 0.25
        ) {
          await syncHeldKeys([]);
          await page.mouse.click(cachedCenterInfo.x, cachedCenterInfo.y);
        }

        const desiredYaw = Math.atan2(-dx, -dz);
        if (useCameraOrbit) {
          const yawTol =
            iter === 0 || (needsJump && !jumpedForThisLeg && distXZ <= jumpTriggerDist + 0.9)
              ? 0.025
              : 0.065;
          if (Math.abs(shortestAngle(snap.camera.yaw, desiredYaw)) > yawTol) {
            await syncHeldKeys([]);
            await orbitCameraToYaw(page, desiredYaw, {
              currentYaw: snap.camera.yaw,
              centerInfo: cachedCenterInfo,
            });
            snap = await getSnapshot(page);
          }
          if (!snap.player.grounded && distXZ < 0.95) {
            await syncHeldKeys([]);
          } else {
            await syncHeldKeys([keyMap.up]);
          }
        } else {
          if (!snap.player.grounded && distXZ < 0.95) {
            await syncHeldKeys([]);
          } else {
            const cy = snap.camera.yaw;
            const fwdX = -Math.sin(cy);
            const fwdZ = -Math.cos(cy);
            const rgtX = Math.cos(cy);
            const rgtZ = -Math.sin(cy);
            const ux = dx / Math.max(1e-6, distXZ);
            const uz = dz / Math.max(1e-6, distXZ);
            const fDot = ux * fwdX + uz * fwdZ;
            const rDot = ux * rgtX + uz * rgtZ;
            const keys = [];
            if (fDot > 0.35) keys.push(keyMap.up);
            else if (fDot < -0.35) keys.push(keyMap.down);
            if (rDot > 0.35) keys.push(keyMap.right);
            else if (rDot < -0.35) keys.push(keyMap.left);
            if (keys.length === 0) {
              keys.push(Math.abs(fDot) >= Math.abs(rDot) ? (fDot >= 0 ? keyMap.up : keyMap.down) : (rDot >= 0 ? keyMap.right : keyMap.left));
            }
            await syncHeldKeys(keys);
          }
        }

        if (needsJump && !jumpedForThisLeg && snap.player.grounded && distXZ <= jumpTriggerDist) {
          await page.keyboard.down('Space');
          await advanceTime(page, 1 / 60);
          await page.keyboard.up('Space');
          jumpedForThisLeg = true;
          // Consolidate early flight only while well outside throttle-cut zone (distXZ > 2.8)
          const flightChunk = Math.min(0.24, Math.max(1 / 60, (distXZ - 2.8) / 16.0));
          if (flightChunk > 1 / 60) {
            await advanceTime(page, flightChunk);
          }
          continue;
        }

        // Consolidated simulation step size preserving 1/60s-2/60s precision near jump thresholds and landings
        let stepSec = 1 / 60;
        if (snap.player.grounded) {
          if (needsJump && !jumpedForThisLeg) {
            const remToJump = distXZ - jumpTriggerDist;
            if (remToJump > 0.7) {
              stepSec = Math.min(0.15, Math.max(1 / 60, (remToJump - 0.3) / 16.0));
            }
          } else if (distXZ > arriveRadius + 0.7) {
            stepSec = Math.min(0.14, Math.max(1 / 60, (distXZ - arriveRadius - 0.25) / 16.0));
          }
        } else if (distXZ > 3.2) {
          stepSec = 3 / 60;
        } else if (distXZ > 1.4) {
          stepSec = 2 / 60;
        }

        await advanceTime(page, stepSec);
      }

      await syncHeldKeys([]);

      if (respawnedOnLeg) {
        safetyRetries += 1;
        if (safetyRetries > 6) {
          throw new Error(`Exceeded respawn recovery retries at waypoint #${idx}`);
        }
        snap = await getSnapshot(page);
        idx = findCheckpointWaypointIndex(waypoints, snap.checkpoints, snap.activeCheckpoint) + 1;
        continue;
      }

      if (!reachedLeg) {
        snap = await getSnapshot(page);
        const f = await jollyobby.contentFrame(page);
        const focusDiag = await f.evaluate(() => ({
          hasFocus: document.hasFocus(),
          activeTag: document.activeElement ? document.activeElement.tagName : null,
        }));
        throw new Error(
          `obbyDriver failed to reach waypoint #${idx} (section=${wp.section}, kind=${wp.kind}, target=(${wp.x},${wp.y},${wp.z}), player=(${snap.player.x.toFixed(
            2
          )},${snap.player.y.toFixed(2)},${snap.player.z.toFixed(2)}), vel=(${snap.player.vx.toFixed(2)},${snap.player.vy.toFixed(2)},${snap.player.vz.toFixed(2)}), grounded=${snap.player.grounded}, camYaw=${snap.camera.yaw.toFixed(3)}, activeCp=${snap.activeCheckpoint}, focus=${JSON.stringify(focusDiag)})`
        );
      }

      idx += 1;
    }
  } finally {
    await syncHeldKeys([]);
    await page.keyboard.up('Space');
  }

  snap = await getSnapshot(page);
  if (!visitedLevels.includes(snap.currentSection)) {
    visitedLevels.push(snap.currentSection);
  }
  return {
    reached:
      targetCheckpointIndex >= 10
        ? snap.completed
        : snap.activeCheckpoint >= targetCheckpointIndex,
    respawns,
    elapsedGameSec: getSimClock(page).elapsed - startElapsed,
    visitedLevels,
    snapshot: snap,
  };
}

function getCourseElapsed(page) {
  return getSimClock(page).elapsed;
}

/**
 * Steers into a target hazard at `(targetX, targetZ)` using real mouse orbit + `KeyW` (+ `Space` if needed)
 * and releases all keys on the exact frame the player respawns at the active checkpoint.
 * @param {import('@playwright/test').Page} page
 * @param {number} targetX
 * @param {number} targetZ
 * @param {{jump?: boolean, jumpTriggerDist?: number}=} opts
 */
async function triggerHazardRespawnAt(page, targetX, targetZ, opts = {}) {
  const startSnap = await getSnapshot(page);
  const cp = startSnap.checkpoints[startSnap.activeCheckpoint];
  const initialDist = Math.hypot(targetX - startSnap.player.x, targetZ - startSnap.player.z);
  const shouldJump = opts.jump !== undefined ? opts.jump : initialDist > 5.0;
  const jumpDist = opts.jumpTriggerDist || 8.6;

  const { x: cx, y: cy } = await getCanvasSafeCenter(page);
  await page.mouse.click(cx, cy);

  let jumped = false;
  let movedAway = Math.hypot(startSnap.player.x - cp.x, startSnap.player.z - cp.z) > 2.5;
  let holdingW = false;

  try {
    for (let step = 0; step < 140; step++) {
      const s = await getSnapshot(page);
      const distFromCp = Math.hypot(s.player.x - cp.x, s.player.z - cp.z);
      if (distFromCp > 2.5) {
        movedAway = true;
      }
      if (movedAway && distFromCp < 0.08 && s.player.vx === 0 && s.player.vy === 0 && s.player.vz === 0) {
        if (holdingW) {
          await page.keyboard.up('KeyW');
          holdingW = false;
        }
        return { respawned: true, snapshot: s };
      }

      const dx = targetX - s.player.x;
      const dz = targetZ - s.player.z;
      const distToHaz = Math.hypot(dx, dz);
      const desiredYaw = Math.atan2(-dx, -dz);

      if (Math.abs(shortestAngle(desiredYaw, s.camera.yaw)) > 0.05) {
        if (holdingW) {
          await page.keyboard.up('KeyW');
          holdingW = false;
        }
        await orbitCameraToYaw(page, desiredYaw, { currentYaw: s.camera.yaw });
      }

      if (!s.player.grounded && distToHaz < 0.75) {
        if (holdingW) {
          await page.keyboard.up('KeyW');
          holdingW = false;
        }
      } else if (!holdingW) {
        await page.keyboard.down('KeyW');
        holdingW = true;
      }

      if (shouldJump && !jumped && s.player.grounded && distToHaz <= jumpDist) {
        await page.keyboard.down('Space');
        await advanceTime(page, 1 / 60);
        await page.keyboard.up('Space');
        jumped = true;
        continue;
      }

      await advanceTime(page, 1 / 60);
    }
  } finally {
    if (holdingW) {
      await page.keyboard.up('KeyW');
    }
    await releaseAllGameKeys(page);
  }

  const finalSnap = await getSnapshot(page);
  return {
    respawned: Math.hypot(finalSnap.player.x - cp.x, finalSnap.player.z - cp.z) < 0.15,
    snapshot: finalSnap,
  };
}

async function navigateToCheckpoint(page, targetCheckpointIndex, opts = {}) {
  return navigateToTarget(page, targetCheckpointIndex, opts);
}

async function navigateCourseToGoal(page, opts = {}) {
  return navigateToTarget(page, 10, opts);
}

module.exports = {
  WORKTREE_ROOT,
  BASE_REPO_ROOT,
  SCENE_DIR,
  DEFAULT_SEED,
  jollyobby,
  expectGameOverOverlay,
  resolveServerUrls,
  readPngMetadata,
  listRelativeFiles,
  installSceneForensicSpies,
  attachRuntimeMonitors,
  loadJollyObby,
  assertZeroRuntimeErrors,
  advanceTime,
  getCourseElapsed,
  getSnapshot,
  getBadgeState,
  expectBadgeLevel,
  getCanvasSafeCenter,
  shortestAngle,
  orbitCameraByDrag,
  orbitCameraToYaw,
  zoomCameraByWheel,
  releaseAllGameKeys,
  holdKeysAndAdvance,
  triggerHazardRespawnAt,
  clickChromePauseOrPlay,
  clickChromeMuteToggle,
  clickChromeHome,
  clickOverlayPlay,
  clickOverlayPlayAgain,
  clickOverlayHome,
  sampleWebGLFrame,
  assertZeroUiTextAndTouch,
  navigateToCheckpoint,
  navigateCourseToGoal,
};
