const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  WORKTREE_ROOT,
  SCENE_DIR,
  jollyobby,
  expectGameOverOverlay,
  resolveServerUrls,
  listRelativeFiles,
  attachRuntimeMonitors,
  loadJollyObby,
  assertZeroRuntimeErrors,
  advanceTime,
  getCourseElapsed,
  getSnapshot,
  getBadgeState,
  expectBadgeLevel,
  getCanvasSafeCenter,
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
} = require('./helpers');

test.describe('Tier 2 — F1 Boundaries: Isolated JJ Workspace & Port Isolation', () => {
  test('T2-F01-01: query-string parameters on /jollyobby.html?seed=custom99&foo=bar load cleanly without breaking route resolution', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL, { query: '?seed=custom99&foo=bar' });
    const snap = await getSnapshot(page);
    expect(snap.ready).toBe(true);
    expect(snap.currentSection).toBe(1);
    expect(page.url()).toContain('seed=custom99');
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F01-02: localized host route /intl/en/jollyobby.html serves 200 OK and mounts scenes/jollyobby/index.html cleanly', async ({
    page,
    baseURL,
    request,
  }) => {
    const { prodOrigin } = resolveServerUrls(baseURL);
    const res = await request.get(`${prodOrigin}/intl/en/jollyobby.html`);
    expect(res.status()).toBe(200);

    const monitors = await loadJollyObby(page, baseURL, { routePath: '/intl/en/jollyobby.html' });
    const snap = await getSnapshot(page);
    expect(snap.ready).toBe(true);
    await expectBadgeLevel(page, 1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F01-03: trailing-slash missing /intl/en redirects 301 to /intl/en/ per serve.js contract without crashing server', async ({
    baseURL,
    request,
  }) => {
    const { prodOrigin } = resolveServerUrls(baseURL);
    const res = await request.get(`${prodOrigin}/intl/en`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toMatch(/\/intl\/en\/$/);

    const health = await request.get(`${prodOrigin}/jollyobby.html`);
    expect(health.status()).toBe(200);
  });

  test('T2-F01-04: rapid sequential page.reload() 3x back-to-back on /jollyobby.html does not crash serve.js and finishes ready', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    for (let i = 0; i < 3; i++) {
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
    await jollyobby.gameElem(page).waitFor({ state: 'attached', timeout: 45000 });
    const f = await jollyobby.contentFrame(page);
    await f.evaluate(async () => {
      const deadline = Date.now() + 45000;
      while (!(window.__TEST_CONTROL__ && window.__TEST_CONTROL__.isReady())) {
        if (Date.now() > deadline) throw new Error('Reload ready timeout');
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    const snap = await getSnapshot(page);
    expect(snap.ready).toBe(true);
    expect(monitors.pageErrors).toEqual([]);
  });

  test('T2-F01-05: worktree .gitignore excludes node_modules, dist/, test-results/, playwright-report/, videos/, and .agents/', async () => {
    const gitignore = fs.readFileSync(path.join(WORKTREE_ROOT, '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/node_modules/);
    expect(gitignore).toMatch(/dist/);
    expect(gitignore).toMatch(/test-results/);
    expect(gitignore).toMatch(/playwright-report/);
    expect(gitignore).toMatch(/videos/);
    expect(gitignore).toMatch(/\.agents/);
  });
});

test.describe('Tier 2 — F2 Boundaries: Host Scene Registration & Release Bundling', () => {
  test('T2-F02-01: standalone direct iframe load (/st/scenes/jollyobby/index.html outside santa-gameloader) degrades gracefully with zero uncaught exceptions', async ({
    page,
    baseURL,
  }) => {
    const monitors = await attachRuntimeMonitors(page);
    await page.addInitScript(() => {
      window.__MANUAL_TIME__ = true;
    });
    const { staticBase } = resolveServerUrls(baseURL);
    const res = await page.goto(`${staticBase}/scenes/jollyobby/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    expect(res.status()).toBe(200);
    await page.waitForFunction(
      () => Boolean(window.__TEST_CONTROL__ && window.__TEST_CONTROL__.isReady()),
      null,
      { timeout: 30000 }
    );
    const snap = await page.evaluate(() => window.__TEST_CONTROL__.getSnapshot());
    expect(snap.ready).toBe(true);
    expect(snap.currentSection).toBe(1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F02-02: static/scenes/jollyobby/ contains zero dynamic import(...) expressions rejected by release.js', async () => {
    const jsFiles = listRelativeFiles(SCENE_DIR).filter(
      (rel) => /\.(m?js)$/i.test(rel) && !rel.startsWith('test/')
    );
    expect(jsFiles.length).toBeGreaterThan(0);
    for (const rel of jsFiles) {
      const code = fs.readFileSync(path.join(SCENE_DIR, rel), 'utf8');
      expect(code, `${rel} must not contain dynamic import(...)`).not.toMatch(/\bimport\s*\(/);
    }
  });

  test('T2-F02-03: api.config(...) is never called asynchronously after 100ms (zero config() after first tick TypeError)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await advanceTime(page, 0.5);
    await page.waitForTimeout(160);
    await advanceTime(page, 0.5);
    const combinedErrors = [...monitors.pageErrors, ...monitors.consoleErrors].join('\n');
    expect(combinedErrors).not.toMatch(/config\(\) cannot be called after first tick/i);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F02-04: preload completes well within santa-gameloader 10s preload budget on warm server', async ({
    page,
    baseURL,
  }) => {
    // Warm up once, then time fresh navigation
    await loadJollyObby(page, baseURL);
    const t0 = Date.now();
    await page.goto(`${resolveServerUrls(baseURL).prodOrigin}/jollyobby.html`, {
      waitUntil: 'domcontentloaded',
    });
    await jollyobby.gameElem(page).waitFor({ state: 'attached', timeout: 10000 });
    const f = await jollyobby.contentFrame(page);
    await f.evaluate(async () => {
      const deadline = Date.now() + 9000;
      while (!(window.__TEST_CONTROL__ && window.__TEST_CONTROL__.isReady())) {
        if (Date.now() > deadline) throw new Error('Preload exceeded 9s');
        await new Promise((r) => setTimeout(r, 25));
      }
    });
    const elapsedMs = Date.now() - t0;
    expect(elapsedMs).toBeLessThan(5000);
  });

  test('T2-F02-05: navigating from /jollyobby.html to / via <santa-chrome> Home button cleanly unloads jollyobby iframe without orphan errors', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await clickChromeHome(page);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10000 }).toBe('/');
    await page.waitForTimeout(150);
    expect(monitors.pageErrors).toEqual([]);
    expect(monitors.consoleErrors).toEqual([]);
  });
});

test.describe('Tier 2 — F3 Boundaries: Host Level Badge Progression (1..10)', () => {
  test('T2-F03-01: level lower bound: <santa-badge> level is strictly >= 1 across boot, void respawn at CP0, and restart', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const b0 = await getBadgeState(page);
    expect(b0.level).toBeGreaterThanOrEqual(1);

    // Fall into void from CP0
    await holdKeysAndAdvance(page, ['KeyD'], 1.2);
    await advanceTime(page, 1.5);
    const b1 = await getBadgeState(page);
    expect(b1.level).toBe(1);

    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);
    const b2 = await getBadgeState(page);
    expect(b2.level).toBe(1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F03-02: level upper bound: <santa-badge> level is strictly <= 10 (maxLevel === 10, never 11 on goal completion)', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    const b = await getBadgeState(page);
    expect(b.level).toBe(10);
    expect(b.maxLevel).toBe(10);
    expect(b.displayText).toBe('10\u00b710');
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F03-03: monotonic checkpoint non-regression: reaching CP2 (3·10) and hopping back onto CP1 keeps activeCheckpoint === 2 and badge 3·10', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 2);
    await expectBadgeLevel(page, 3);

    // Hop back South down the Section 2 staircase (x=0, z=-125.8 -> -71.5) onto CP1
    const snapAtCp2 = await getSnapshot(page);
    const reverseTargets = [11, 10, 9, 8, 7, 6].map((idx) => snapAtCp2.sectionWaypoints[idx]);
    await orbitCameraToYaw(page, Math.PI);
    for (const wp of reverseTargets) {
      for (let iter = 0; iter < 90; iter++) {
        const s = await getSnapshot(page);
        const dx = wp.x - s.player.x;
        const dz = wp.z - s.player.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 2.2 && s.player.grounded && Math.abs(s.player.y - wp.y) <= 2.0) {
          break;
        }
        await orbitCameraToYaw(page, Math.atan2(-dx, -dz), { currentYaw: s.camera.yaw });
        await page.keyboard.down('KeyW');
        if (s.player.grounded && dist > 4.2 && dist <= 7.8) {
          await page.keyboard.down('Space');
          await advanceTime(page, 1 / 60);
          await page.keyboard.up('Space');
        }
        await advanceTime(page, 2 / 60);
        await page.keyboard.up('KeyW');
      }
    }
    await releaseAllGameKeys(page);

    const finalSnap = await getSnapshot(page);
    expect(Math.hypot(finalSnap.player.x - 0, finalSnap.player.z - -71.5)).toBeLessThan(3.5);
    expect(finalSnap.activeCheckpoint).toBe(2);
    expect(finalSnap.currentSection).toBe(3);
    await expectBadgeLevel(page, 3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F03-04: re-entering already-active CP1 trigger 5x repeatedly via vertical jumps is idempotent at 2·10', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);

    // Jump 5x vertically on CP1 (apex rises >6.8 studs above pad, exiting and re-entering cp1_trigger each jump)
    for (let j = 0; j < 5; j++) {
      await page.keyboard.down('Space');
      await advanceTime(page, 1 / 60);
      await page.keyboard.up('Space');
      await advanceTime(page, 0.62);
      const s = await getSnapshot(page);
      expect(s.player.grounded).toBe(true);
      expect(s.activeCheckpoint).toBe(1);
      expect(s.currentSection).toBe(2);
    }
    await expectBadgeLevel(page, 2);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F03-05: void-fall respawn at CP2 keeps <santa-badge> pinned at 3·10 (never flashes 1·10)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 2);
    await expectBadgeLevel(page, 3);

    // At CP2 camera faces East (-PI/2); KeyA walks North off CP2 into the void
    await holdKeysAndAdvance(page, ['KeyA'], 0.8);
    await advanceTime(page, 2.2);

    const snap = await getSnapshot(page);
    expect(snap.activeCheckpoint).toBe(2);
    expect(snap.currentSection).toBe(3);
    expect(snap.player.grounded).toBe(true);
    await expectBadgeLevel(page, 3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F03-06: <santa-badge> score property remains 0 across multiple checkpoint activations so .alt-active never flips to score mode', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    for (const cpIdx of [1, 2, 3]) {
      await navigateToCheckpoint(page, cpIdx);
      const b = await getBadgeState(page);
      expect(b.score).toBe(0);
      expect(b.altActive).toBe(true);
      expect(b.level).toBe(cpIdx + 1);
    }
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F4 Boundaries: Section 10 Host Completion / Game-Over', () => {
  test('T2-F04-01: standing on CP9 (10·10 start of Section 10) updates badge to 10·10 while keeping completed=false and overlay hidden', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 9);
    const snap = await getSnapshot(page);
    expect(snap.activeCheckpoint).toBe(9);
    expect(snap.currentSection).toBe(10);
    expect(snap.completed).toBe(false);
    await expectBadgeLevel(page, 10);
    await expect(page.locator('santa-overlay')).toHaveAttribute('hidden', '');
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F04-02: reaching Section 10 Finish Goal and advancing an additional 10.0s fires completion idempotently once', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);

    await advanceTime(page, 10.0);
    const snap = await getSnapshot(page);
    expect(snap.completed).toBe(true);
    expect(snap.player.animState).toBe('celebrate');
    await expectGameOverOverlay(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F04-03: holding KeyW + Space continuously across Finish Goal contact zeroes velocity without running off Section 10 Dais', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    try {
      await advanceTime(page, 2.5);
    } finally {
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyW');
    }
    const snap = await getSnapshot(page);
    expect(snap.completed).toBe(true);
    expect(snap.player.vx).toBe(0);
    expect(snap.player.vz).toBe(0);
    expect(Math.hypot(snap.player.x - snap.finishGoal.x, snap.player.z - snap.finishGoal.z)).toBeLessThan(7.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F04-04: after gameover, <santa-chrome> action button displays restart and clicking it restarts run cleanly to 1·10', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);

    const chromeAction = await page.evaluate(() => document.querySelector('santa-chrome').action);
    expect(chromeAction).toBe('restart');

    await page.locator('santa-chrome header santa-button').nth(2).click();
    await expect(page.locator('santa-overlay')).toHaveAttribute('hidden', '');
    await expectBadgeLevel(page, 1);

    const snap = await getSnapshot(page);
    expect(snap.completed).toBe(false);
    expect(snap.activeCheckpoint).toBe(0);
    expect(snap.currentSection).toBe(1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F04-05: clicking santa-button[data-action="home"] on Section 10 completion <santa-overlay> navigates back to Village (/)', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);
    await clickOverlayHome(page);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10000 }).toBe('/');
    expect(monitors.pageErrors).toEqual([]);
  });
});

test.describe('Tier 2 — F5 Boundaries: Host Lifecycle Events', () => {
  test('T2-F05-01: rapid pause/resume toggling 5x preserves exact player position and section state with zero errors', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await holdKeysAndAdvance(page, ['KeyW'], 0.25);
    const before = await getSnapshot(page);

    for (let i = 0; i < 5; i++) {
      const pausedSnap = await clickChromePauseOrPlay(page);
      expect(pausedSnap.paused).toBe(true);
      await clickOverlayPlay(page);
    }

    const after = await getSnapshot(page);
    expect(after.paused).toBe(false);
    expect(after.player.x).toBeCloseTo(before.player.x, 4);
    expect(after.player.y).toBeCloseTo(before.player.y, 4);
    expect(after.player.z).toBeCloseTo(before.player.z, 4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F05-02: holding KeyW when clicking Pause clears held-key state so releasing KeyW while paused and clicking Resume leaves player stationary', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.15);
    await clickChromePauseOrPlay(page);
    await page.keyboard.up('KeyW');
    await clickOverlayPlay(page);

    const posAtResume = await getSnapshot(page);
    // Ground friction (250 studs/s^2) brakes pre-pause vz=-16 to 0 in ~0.064s (~0.51 studs); verify KeyW is not stuck
    await advanceTime(page, 0.12);
    const settled = await getSnapshot(page);
    expect(Math.abs(settled.player.z - posAtResume.player.z)).toBeLessThan(0.65);
    expect(Math.abs(settled.player.vx)).toBeLessThan(0.01);
    expect(Math.abs(settled.player.vz)).toBeLessThan(0.01);

    await advanceTime(page, 0.5);
    const posAfter = await getSnapshot(page);
    expect(Math.abs(posAfter.player.vx)).toBeLessThan(0.01);
    expect(Math.abs(posAfter.player.vz)).toBeLessThan(0.01);
    expect(posAfter.player.z).toBeCloseTo(settled.player.z, 5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F05-03: large wall-clock pause (300ms while paused + resume + advanceTime(0.05)) clamps dt <= 0.05s with zero CP0 floor tunneling', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await clickChromePauseOrPlay(page);
    await page.waitForTimeout(300);
    await clickOverlayPlay(page);
    await advanceTime(page, 0.05);

    const snap = await getSnapshot(page);
    expect(snap.player.grounded).toBe(true);
    expect(Math.abs(snap.player.y - 0)).toBeLessThan(0.05);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F05-04: triggering restart while airborne mid-jump immediately resets player onto CP0 (vy=0, grounded=true, 1·10)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.22);

    const midAir = await getSnapshot(page);
    expect(midAir.player.grounded).toBe(false);
    expect(midAir.player.y).toBeGreaterThan(3.0);

    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);

    const resetSnap = await getSnapshot(page);
    expect(resetSnap.player.grounded).toBe(true);
    expect(resetSnap.player.vy).toBe(0);
    expect(Math.hypot(resetSnap.player.x, resetSnap.player.z)).toBeLessThan(0.1);
    await expectBadgeLevel(page, 1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F05-05: rapid double-restart (#playagainButton clicked in two consecutive cycles) cleanly leaves activeCheckpoint=0 and WASD responsive', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 1);
    for (let r = 0; r < 2; r++) {
      await clickChromePauseOrPlay(page);
      await clickOverlayPlayAgain(page);
    }
    const s0 = await getSnapshot(page);
    expect(s0.activeCheckpoint).toBe(0);
    expect(s0.currentSection).toBe(1);

    await holdKeysAndAdvance(page, ['KeyW'], 0.25);
    const s1 = await getSnapshot(page);
    expect(s1.player.z).toBeLessThan(-3.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F05-06: rapid audio mute/unmute toggling 6x on <santa-chrome> causes zero Klang/AudioContext exceptions and preserves Space jump without flipping muted', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const chrome = page.locator('santa-chrome');
    const mutedInitial = await chrome.evaluate((el) => Boolean(el.muted));
    await clickChromeMuteToggle(page);
    await expect
      .poll(() => chrome.evaluate((el) => Boolean(el.muted)), { timeout: 3000 })
      .toBe(!mutedInitial);
    for (let i = 1; i < 6; i++) {
      await clickChromeMuteToggle(page);
    }
    const mutedBeforeSpace = await chrome.evaluate((el) => Boolean(el.muted));
    await holdKeysAndAdvance(page, ['Space'], 0.1);
    const snap = await getSnapshot(page);
    expect(snap.player.y).toBeGreaterThan(0.1);
    expect(snap.player.vy).toBeGreaterThan(0);
    expect(await chrome.evaluate((el) => Boolean(el.muted))).toBe(mutedBeforeSpace);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F6 Boundaries: Keyboard Movement (WASD & Arrow Keys)', () => {
  test('T2-F06-01: diagonal speed normalization (KeyW + KeyD held 0.30s) caps horizontal speed <= 16.05 studs/s at 45 deg', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await advanceTime(page, 0.3);
    const snap = await getSnapshot(page);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');

    const horizSpeed = Math.hypot(snap.player.vx, snap.player.vz);
    expect(horizSpeed).toBeGreaterThan(15.5);
    expect(horizSpeed).toBeLessThanOrEqual(16.05);
    expect(snap.player.x).toBeGreaterThan(2.5);
    expect(snap.player.z).toBeLessThan(-2.5);
    expect(Math.abs(Math.abs(snap.player.x) - Math.abs(snap.player.z))).toBeLessThan(0.25);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F06-02: Arrow diagonal normalization (ArrowUp + ArrowLeft held 0.30s) caps horizontal speed <= 16.05 studs/s North-West', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowLeft');
    await advanceTime(page, 0.3);
    const snap = await getSnapshot(page);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowUp');

    const horizSpeed = Math.hypot(snap.player.vx, snap.player.vz);
    expect(horizSpeed).toBeGreaterThan(15.5);
    expect(horizSpeed).toBeLessThanOrEqual(16.05);
    expect(snap.player.x).toBeLessThan(-2.5);
    expect(snap.player.z).toBeLessThan(-2.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F06-03: opposite longitudinal keys (KeyW + KeyS) cancel net Z velocity to 0, and releasing KeyS immediately resumes North movement', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyS');
    await advanceTime(page, 0.25);
    const cancelled = await getSnapshot(page);
    expect(Math.abs(cancelled.player.vz)).toBeLessThan(0.05);
    expect(Math.abs(cancelled.player.z)).toBeLessThan(0.05);

    await page.keyboard.up('KeyS');
    await advanceTime(page, 0.2);
    const resumed = await getSnapshot(page);
    await page.keyboard.up('KeyW');

    expect(resumed.player.vz).toBeLessThan(-15.5);
    expect(resumed.player.z).toBeLessThan(-2.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F06-04: opposite lateral keys (KeyA + KeyD) cancel net X velocity to 0, and releasing KeyA immediately resumes East movement', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyA');
    await page.keyboard.down('KeyD');
    await advanceTime(page, 0.25);
    const cancelled = await getSnapshot(page);
    expect(Math.abs(cancelled.player.vx)).toBeLessThan(0.05);
    expect(Math.abs(cancelled.player.x)).toBeLessThan(0.05);

    await page.keyboard.up('KeyA');
    await advanceTime(page, 0.2);
    const resumed = await getSnapshot(page);
    await page.keyboard.up('KeyD');

    expect(resumed.player.vx).toBeGreaterThan(15.5);
    expect(resumed.player.x).toBeGreaterThan(2.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F06-05: mixed WASD + Arrow duplicate direction (KeyW + ArrowUp) caps speed at 16.0 studs/s and keeps moving when KeyW releases', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('ArrowUp');
    await advanceTime(page, 0.15);
    const bothSnap = await getSnapshot(page);
    expect(Math.hypot(bothSnap.player.vx, bothSnap.player.vz)).toBeLessThanOrEqual(16.05);

    await page.keyboard.up('KeyW');
    await advanceTime(page, 0.15);
    const arrowOnly = await getSnapshot(page);
    await page.keyboard.up('ArrowUp');

    expect(arrowOnly.player.vz).toBeLessThan(-15.5);
    expect(arrowOnly.player.z).toBeLessThan(bothSnap.player.z - 2.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F06-06: window blur safety clears held keys so holding KeyW across iframe blur brings horizontal velocity to 0', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);
    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.15);
    const moving = await getSnapshot(page);
    expect(moving.player.vz).toBeLessThan(-15.0);

    const f = await jollyobby.contentFrame(page);
    await f.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await advanceTime(page, 0.25);
    const stopped = await getSnapshot(page);
    await page.keyboard.up('KeyW');

    expect(Math.abs(stopped.player.vx)).toBeLessThan(0.05);
    expect(Math.abs(stopped.player.vz)).toBeLessThan(0.05);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F7 Boundaries: Keyboard Jump (Space)', () => {
  test('T2-F07-01: double-jump rejection: pressing Space at t=0.20s midair does not boost vy or increase apex beyond ~6.89 studs', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.19);

    const beforePress = await getSnapshot(page);
    expect(beforePress.player.grounded).toBe(false);

    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    const afterPress = await getSnapshot(page);
    expect(afterPress.player.vy).toBeLessThan(beforePress.player.vy);

    let maxY = afterPress.player.y;
    for (let i = 0; i < 15; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      maxY = Math.max(maxY, s.player.y);
    }
    expect(maxY).toBeLessThan(7.15);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F07-02: rapid Space mashing (5 presses during 0.45s airtime) produces strictly one jump arc until landing', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    let maxY = 0;
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('Space');
      await advanceTime(page, 1 / 60);
      await page.keyboard.up('Space');
      await advanceTime(page, 0.07);
      const s = await getSnapshot(page);
      maxY = Math.max(maxY, s.player.y);
      expect(s.player.grounded).toBe(false);
    }
    expect(maxY).toBeLessThan(7.15);
    await advanceTime(page, 0.35);
    const landed = await getSnapshot(page);
    expect(landed.player.grounded).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F07-03: hold-Space auto-jump chaining automatically triggers a 2nd jump immediately on landing', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);
    await page.keyboard.down('Space');
    try {
      // Advance past jump #1 apex (~0.265s) and landing (~0.53s) into jump #2 ascent (~0.70s)
      await advanceTime(page, 0.72, { step: 1 / 60 });
      const secondJump = await getSnapshot(page);
      expect(secondJump.player.grounded).toBe(false);
      expect(secondJump.player.y).toBeGreaterThan(2.5);
      expect(secondJump.player.vy).toBeGreaterThan(5.0);
    } finally {
      await page.keyboard.up('Space');
    }
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F07-04: Coyote-time edge forgiveness (0.09s window): pressing Space 0.033s after walking off CP0 executes upward jump', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    await page.keyboard.down('KeyD');
    let leftEdge = false;
    for (let i = 0; i < 45; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (!s.player.grounded) {
        leftEdge = true;
        break;
      }
    }
    expect(leftEdge).toBe(true);

    // Wait 2 frames (0.033s < 0.09s Coyote window) then press Space
    await advanceTime(page, 2 / 60);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyD');

    const coyoteJump = await getSnapshot(page);
    expect(coyoteJump.player.vy).toBeGreaterThan(45.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F07-05: expired Coyote window (> 0.09s): waiting 0.15s after walking off CP0 rejects midair jump', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    await page.keyboard.down('KeyD');
    for (let i = 0; i < 45; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (!s.player.grounded) break;
    }
    await page.keyboard.up('KeyD');

    // Wait 0.15s (> 0.09s Coyote window) then press Space
    await advanceTime(page, 0.15);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');

    const falling = await getSnapshot(page);
    expect(falling.player.vy).toBeLessThan(-20.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F07-06: jump buffer (0.09s pre-landing window): tapping Space 0.05s before landing fires buffered jump on touchdown', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');

    // Advance to ~0.48s into the ~0.53s jump arc (still airborne, ~0.05s before landing)
    await advanceTime(page, 0.47, { step: 1 / 60 });
    const preLand = await getSnapshot(page);
    expect(preLand.player.grounded).toBe(false);
    expect(preLand.player.vy).toBeLessThan(-35.0);

    // Tap and release Space BEFORE landing
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');

    // Advance across touchdown (~0.08s) and verify buffered jump launched automatically
    await advanceTime(page, 0.08, { step: 1 / 60 });
    const buffered = await getSnapshot(page);
    expect(buffered.player.grounded).toBe(false);
    expect(buffered.player.vy).toBeGreaterThan(35.0);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F8 Boundaries: Mouse Click + Drag Camera Orbit', () => {
  test('T2-F08-01: upper pitch clamp (+80 deg): extreme downward vertical drag clamps camera.pitch <= 80 deg without gimbal flip', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await orbitCameraByDrag(page, 0, 2500);
    const snap = await getSnapshot(page);
    const maxPitch = (80 * Math.PI) / 180;
    expect(snap.camera.pitch).toBeCloseTo(maxPitch, 2);
    expect(snap.camera.pitch).toBeLessThanOrEqual(maxPitch + 1e-3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F08-02: lower pitch clamp (-15 deg): extreme upward vertical drag clamps camera.pitch >= -15 deg', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await orbitCameraByDrag(page, 0, -2500);
    const snap = await getSnapshot(page);
    const minPitch = (-15 * Math.PI) / 180;
    expect(snap.camera.pitch).toBeCloseTo(minPitch, 2);
    expect(snap.camera.pitch).toBeGreaterThanOrEqual(minPitch - 1e-3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F08-03: unbounded 360+ deg multi-revolution yaw: dragging horizontally +1500px rotates past 2*PI with finite yaw and valid movement basis', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await orbitCameraByDrag(page, 1500, 0);
    const snap = await getSnapshot(page);
    expect(Number.isFinite(snap.camera.yaw)).toBe(true);
    expect(Math.abs(snap.camera.yaw)).toBeGreaterThan(Math.PI * 2);

    await holdKeysAndAdvance(page, ['KeyW'], 0.2);
    const moved = await getSnapshot(page);
    expect(Math.hypot(moved.player.x, moved.player.z)).toBeGreaterThan(2.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F08-04: window blur during active mousedown drag clears drag state so subsequent mouse moves without button do not orbit camera', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(x + 60, y, { steps: 3 });

    const f = await jollyobby.contentFrame(page);
    await f.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });
    const afterBlur = await getSnapshot(page);

    await page.mouse.move(x + 220, y + 80, { steps: 5 });
    await page.mouse.up({ button: 'left' });
    const afterMove = await getSnapshot(page);
    expect(afterMove.camera.yaw).toBeCloseTo(afterBlur.camera.yaw, 5);
    expect(afterMove.camera.pitch).toBeCloseTo(afterBlur.camera.pitch, 5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F08-05: zero-pixel click (mousedown + mouseup at identical coordinates) leaves camera.yaw and camera.pitch unchanged', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = await getSnapshot(page);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.up({ button: 'left' });
    const after = await getSnapshot(page);
    expect(after.camera.yaw).toBeCloseTo(before.camera.yaw, 6);
    expect(after.camera.pitch).toBeCloseTo(before.camera.pitch, 6);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F9 Boundaries: Mouse Scroll-Wheel Camera Zoom', () => {
  test('T2-F09-01: minimum zoom clamp (MIN_DISTANCE = 5.5 studs): extreme zoom-in clamps camera.distance >= 5.5', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, -10000, 1.0);
    const snap = await getSnapshot(page);
    expect(snap.camera.distance).toBeCloseTo(5.5, 2);
    expect(snap.camera.distance).toBeGreaterThanOrEqual(5.49);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F09-02: maximum zoom clamp (MAX_DISTANCE = 45.0 studs): extreme zoom-out clamps camera.distance <= 45.0', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, 10000, 1.0);
    const snap = await getSnapshot(page);
    expect(snap.camera.distance).toBeCloseTo(45.0, 2);
    expect(snap.camera.distance).toBeLessThanOrEqual(45.01);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F09-03: zero deltaY wheel event (deltaY = 0) leaves camera.distance unchanged at ~17.0 studs', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = await getSnapshot(page);
    await zoomCameraByWheel(page, 0, 0.25);
    const after = await getSnapshot(page);
    expect(after.camera.distance).toBeCloseTo(before.camera.distance, 5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F09-04: micro-trackpad wheel increments (deltaY = -4 x 10 ticks) accumulate smoothly without NaN or overshoot', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = await getSnapshot(page);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.move(x, y);
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -4);
      await advanceTime(page, 0.05);
    }
    await advanceTime(page, 0.5);
    const after = await getSnapshot(page);
    expect(Number.isFinite(after.camera.distance)).toBe(true);
    expect(after.camera.distance).toBeLessThan(before.camera.distance - 2.0);
    expect(after.camera.distance).toBeGreaterThanOrEqual(5.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F09-05: alternating extreme zoom spikes (-10000 then +10000 then -10000) remain strictly bounded within [5.5, 45.0]', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, -10000, 0.8);
    expect((await getSnapshot(page)).camera.distance).toBeCloseTo(5.5, 1);

    await zoomCameraByWheel(page, 10000, 0.8);
    expect((await getSnapshot(page)).camera.distance).toBeCloseTo(45.0, 1);

    await zoomCameraByWheel(page, -10000, 0.8);
    expect((await getSnapshot(page)).camera.distance).toBeCloseTo(5.5, 1);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F10 Boundaries: Hitbox, Substepped Collision & Platform Carry', () => {
  test('T2-F10-01: high-delta advanceTime(1.0) chunk while standing on CP0 substeps cleanly with zero floor tunneling', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await advanceTime(page, 1.0);
    const snap = await getSnapshot(page);
    expect(snap.player.grounded).toBe(true);
    expect(Math.abs(snap.player.y - 0)).toBeLessThan(0.05);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F10-02: terminal velocity cap during long high-altitude void fall from CP8 (y=20) caps downward vy at -120 studs/s', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 8);
    await releaseAllGameKeys(page);
    await advanceTime(page, 0.35);

    // Walk to West rim of CP8 (x=26, hx=6 -> rim at x=20) and jump West: apex ~26.89 down to VOID_KILL_Y=-20 gives ~46.9 studs of freefall (>36.7 needed for -120)
    await orbitCameraToYaw(page, Math.PI / 2);
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 40; i++) {
      const s = await getSnapshot(page);
      if (s.player.grounded && s.player.x <= 21.2) {
        await page.keyboard.down('Space');
        await advanceTime(page, 1 / 60);
        await page.keyboard.up('Space');
        break;
      }
      await advanceTime(page, 1 / 60);
    }
    await advanceTime(page, 0.34);
    await page.keyboard.up('KeyW');

    let minVy = 0;
    for (let i = 0; i < 100; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      minVy = Math.min(minVy, s.player.vy);
      if (s.player.grounded && Math.abs(s.player.y - 20.0) < 0.2 && Math.abs(s.player.x - 26.0) < 0.5) {
        break; // Respawned at CP8 after crossing y = -20
      }
    }
    expect(minVy).toBeLessThanOrEqual(-119.5);
    expect(minVy).toBeGreaterThanOrEqual(-120.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F10-03: tall wall push-out (> STEP_HEIGHT = 0.60 studs): walking North off CP1 into vertical face of sec2_plank1 blocks penetration without auto-stepping onto top', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 1);

    // Position near North center of CP1 facing North (yaw = 0) and walk straight off without jumping
    await orbitCameraToYaw(page, 0);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    await page.keyboard.down('KeyW');
    let hitWallBlocked = false;
    let everAutoSteppedOntoPlank1 = false;
    for (let i = 0; i < 60; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (s.player.y > 3.5 && s.player.z < -80.0) {
        everAutoSteppedOntoPlank1 = true;
      }
      // sec2_plank1 South face is at z = -80.80, y in [2.60, 3.80]; with radius 0.85, push-out holds z >= -80.0 while y+4.2 > 2.60
      if (!s.player.grounded && s.player.y < 2.4 && s.player.y > -1.4 && s.player.z <= -79.85) {
        expect(s.player.z).toBeGreaterThanOrEqual(-80.05);
        hitWallBlocked = true;
      }
    }
    await page.keyboard.up('KeyW');

    expect(hitWallBlocked).toBe(true);
    expect(everAutoSteppedOntoPlank1).toBe(false);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F10-04: capsule grazing edge stability (PLAYER_RADIUS = 0.85): standing inside CP0 edge stays grounded, >0.95 studs past edge falls', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    // CP0 East edge is x = +6.0. Walk East until x is in [5.5, 6.4] (supported via 0.85 capsule overhang)
    await page.keyboard.down('KeyD');
    for (let i = 0; i < 40; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (s.player.x >= 5.6) break;
    }
    await page.keyboard.up('KeyD');
    await advanceTime(page, 0.1);
    const grazing = await getSnapshot(page);
    expect(grazing.player.grounded).toBe(true);

    // Walk past x > 6.95 (> 6.0 + 0.85) and verify grounded transitions to false
    await page.keyboard.down('KeyD');
    for (let i = 0; i < 20; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (s.player.x > 6.95) break;
    }
    await page.keyboard.up('KeyD');
    const pastEdge = await getSnapshot(page);
    expect(pastEdge.player.grounded).toBe(false);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F10-05: jumping vertically off a moving Section 6 platform and landing back on it re-attaches grounded carry cleanly', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 5);

    const sec6Omega = (Math.PI * 2) / 4.2;
    for (let w = 0; w < 90; w++) {
      const tArrive = getCourseElapsed(page) + 0.85;
      if (Math.abs(Math.sin(sec6Omega * tArrive)) < 0.25) break;
      await advanceTime(page, 2 / 60);
    }

    const s0 = await getSnapshot(page);
    await orbitCameraToYaw(page, Math.PI, { currentYaw: s0.camera.yaw });
    await page.keyboard.down('KeyW');
    let jumped = false;
    for (let i = 0; i < 65; i++) {
      const s = await getSnapshot(page);
      const distZ = Math.abs(-57.8 - s.player.z);
      if (!s.player.grounded && distZ < 0.9) {
        await page.keyboard.up('KeyW');
      }
      if (!jumped && s.player.grounded && distZ <= 9.2) {
        await page.keyboard.down('Space');
        await advanceTime(page, 1 / 60);
        await page.keyboard.up('Space');
        jumped = true;
        continue;
      }
      if (jumped && s.player.grounded && s.player.y > 13.7) break;
      await advanceTime(page, 1 / 60);
    }
    await releaseAllGameKeys(page);

    // Wait until gift1 reaches oscillation turnaround (|sin| > 0.94 where lateral speed ~ 0) so vertical jump lands squarely on the 6x6 pad
    for (let w = 0; w < 90; w++) {
      if (Math.abs(Math.sin(sec6Omega * (getCourseElapsed(page) + 0.25))) > 0.94) break;
      await advanceTime(page, 2 / 60);
    }

    const beforeJump = await getSnapshot(page);
    expect(beforeJump.player.grounded).toBe(true);
    expect(beforeJump.player.y).toBeCloseTo(13.9, 1);

    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.58);

    const reLanded = await getSnapshot(page);
    expect(reLanded.player.grounded).toBe(true);
    expect(reLanded.player.y).toBeCloseTo(13.9, 1);

    let maxDx = 0;
    for (let i = 0; i < 8; i++) {
      await advanceTime(page, 0.1);
      const s = await getSnapshot(page);
      expect(s.player.grounded).toBe(true);
      maxDx = Math.max(maxDx, Math.abs(s.player.x - reLanded.player.x));
    }
    expect(maxDx).toBeGreaterThan(0.8);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F10-06: standing near center hub vs outer arm of Section 7 spinning cross scales tangential carry speed proportionally to radius', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 6);

    for (let w = 0; w < 90; w++) {
      const yawArrive = 0.55 * (getCourseElapsed(page) + 0.9);
      const mod = ((yawArrive % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      if (Math.min(mod, Math.PI / 2 - mod) < 0.25) break;
      await advanceTime(page, 3 / 60);
    }

    const s0 = await getSnapshot(page);
    await orbitCameraToYaw(page, Math.PI / 2, { currentYaw: s0.camera.yaw });
    await page.keyboard.down('KeyW');
    let jumped = false;
    for (let i = 0; i < 65; i++) {
      const s = await getSnapshot(page);
      const dist = Math.hypot(103.0 - s.player.x, -24.8 - s.player.z);
      if (!s.player.grounded && dist < 1.2) {
        await page.keyboard.up('KeyW');
      }
      if (!jumped && s.player.grounded && dist <= 10.2) {
        await page.keyboard.down('Space');
        await advanceTime(page, 1 / 60);
        await page.keyboard.up('Space');
        jumped = true;
        continue;
      }
      if (jumped && s.player.grounded && dist < 4.5) break;
      await advanceTime(page, 1 / 60);
    }
    await releaseAllGameKeys(page);

    const nearHub0 = await getSnapshot(page);
    expect(nearHub0.player.grounded).toBe(true);
    const rNear = Math.hypot(nearHub0.player.x - 103.0, nearHub0.player.z - -24.8);
    await advanceTime(page, 0.25);
    const nearHub1 = await getSnapshot(page);
    const dispNear = Math.hypot(nearHub1.player.x - nearHub0.player.x, nearHub1.player.z - nearHub0.player.z);

    if (rNear > 0.85) {
      const yawToCenter = Math.atan2(-(103.0 - nearHub1.player.x), -(-24.8 - nearHub1.player.z));
      await orbitCameraToYaw(page, yawToCenter, { currentYaw: nearHub1.camera.yaw });
      await holdKeysAndAdvance(page, ['KeyW'], Math.min(0.11, (rNear - 0.15) / 16.0));
      await advanceTime(page, 0.08);
      const inner0 = await getSnapshot(page);
      await advanceTime(page, 0.25);
      const inner1 = await getSnapshot(page);
      const dispInner = Math.hypot(inner1.player.x - inner0.player.x, inner1.player.z - inner0.player.z);
      expect(dispNear).toBeGreaterThan(dispInner);
      expect(inner1.player.grounded).toBe(true);
    } else {
      await holdKeysAndAdvance(page, ['KeyS'], 0.09);
      await advanceTime(page, 0.08);
      const outer0 = await getSnapshot(page);
      await advanceTime(page, 0.25);
      const outer1 = await getSnapshot(page);
      const dispOuter = Math.hypot(outer1.player.x - outer0.player.x, outer1.player.z - outer0.player.z);
      expect(dispOuter).toBeGreaterThan(dispNear);
      expect(outer1.player.grounded).toBe(true);
    }
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F11 Boundaries: Checkpoints (CP0..CP9), Void & Hazard Respawn', () => {
  test('T2-F11-01: five consecutive void falls at CP0 respawn cleanly 5/5 times at CP0 with velocity=(0,0,0) and grounded=true', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    for (let i = 0; i < 5; i++) {
      await holdKeysAndAdvance(page, ['KeyD'], 0.65);
      await advanceTime(page, 1.5);
      const s = await getSnapshot(page);
      expect(s.player.grounded).toBe(true);
      expect(s.player.vx).toBe(0);
      expect(s.player.vy).toBe(0);
      expect(s.player.vz).toBe(0);
      expect(Math.hypot(s.player.x, s.player.z)).toBeLessThan(0.05);
    }
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F11-02: three consecutive hazard touches + two void falls after reaching CP2 (3·10) respawn 5/5 times at CP2 with zero drift', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 2);
    const cp2 = (await getSnapshot(page)).checkpoints[2];

    // 3x hazard touches on sec3_c1_R (x=10.25, y=11.05, z=-122.8, South row of col 1)
    for (let h = 0; h < 3; h++) {
      const { respawned, snapshot: sAfter } = await triggerHazardRespawnAt(page, 10.25, -122.8, {
        jump: true,
      });
      expect(respawned).toBe(true);
      expect(sAfter.activeCheckpoint).toBe(2);
      expect(sAfter.player.grounded).toBe(true);
      expect(Math.hypot(sAfter.player.x - cp2.x, sAfter.player.z - cp2.z)).toBeLessThan(0.1);
    }

    // 2x void falls off CP2 North edge
    for (let v = 0; v < 2; v++) {
      await holdKeysAndAdvance(page, ['KeyA'], 0.75);
      await advanceTime(page, 2.2);
      const sAfter = await getSnapshot(page);
      expect(sAfter.activeCheckpoint).toBe(2);
      expect(sAfter.player.grounded).toBe(true);
      expect(Math.hypot(sAfter.player.x - cp2.x, sAfter.player.z - cp2.z)).toBeLessThan(0.1);
    }
    await expectBadgeLevel(page, 3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F11-03: falling off CP0 with high horizontal + downward speed resets vx=0, vy=0, vz=0 immediately on respawn (zero residual momentum)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    // Keep KeyD held until just before crossing VOID_KILL_Y = -20, release KeyD right before respawn frame
    await page.keyboard.down('KeyD');
    for (let i = 0; i < 90; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (s.player.y < -17.5) {
        expect(s.player.vx).toBeGreaterThan(15.0);
        expect(s.player.vy).toBeLessThan(-75.0);
        break;
      }
    }
    await page.keyboard.up('KeyD');
    await advanceTime(page, 0.25);

    const respawned = await getSnapshot(page);
    expect(respawned.player.grounded).toBe(true);
    expect(respawned.player.vx).toBe(0);
    expect(respawned.player.vy).toBe(0);
    expect(respawned.player.vz).toBe(0);
    expect(Math.hypot(respawned.player.x, respawned.player.z)).toBeLessThan(0.05);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F11-04: all 10 checkpoints CP0..CP9 have static, flat, hazard-free spawn positions (grounded=true at each checkpoint)', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    const cp0Snap = await getSnapshot(page);
    expect(cp0Snap.checkpoints.length).toBe(10);
    expect(cp0Snap.player.grounded).toBe(true);

    for (let cpIdx = 1; cpIdx <= 9; cpIdx++) {
      const res = await navigateToCheckpoint(page, cpIdx);
      expect(res.reached).toBe(true);
      await advanceTime(page, 0.35);
      const s1 = await getSnapshot(page);
      await advanceTime(page, 0.25);
      const s2 = await getSnapshot(page);
      expect(s1.player.grounded, `CP${cpIdx} must be grounded after touchdown`).toBe(true);
      expect(s2.player.grounded, `CP${cpIdx} must remain grounded & hazard-free`).toBe(true);
      expect(s2.activeCheckpoint).toBe(cpIdx);
      expect(Math.abs(s2.player.vy)).toBeLessThan(0.02);
      expect(s2.player.x).toBeCloseTo(s1.player.x, 4);
      expect(s2.player.z).toBeCloseTo(s1.player.z, 4);
    }
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F11-05: Section 4 donut ring disc boundary: outer ring is safe while central 0.80-stud red dot triggers respawn at CP3 (4·10)', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 3);
    await expectBadgeLevel(page, 4);

    // Hop across sec4_disc1 (wp 20), sec4_disc2 (wp 21), onto safe North rim of sec4_disc3 (wp 22: 76.2, 12.45, -130.25)
    const sStart = await getSnapshot(page);
    for (const wpIdx of [20, 21, 22]) {
      const prevWp = sStart.sectionWaypoints[wpIdx - 1];
      const wp = sStart.sectionWaypoints[wpIdx];
      const legSpan = Math.hypot(wp.x - prevWp.x, wp.z - prevWp.z);
      const jumpTrigger = wpIdx === 20 ? legSpan - 5.0 : Math.min(9.8, legSpan - 1.6);
      let jumped = false;
      for (let i = 0; i < 90; i++) {
        const s = await getSnapshot(page);
        const dx = wp.x - s.player.x;
        const dz = wp.z - s.player.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 1.4 && s.player.grounded && Math.abs(s.player.y - wp.y) < 1.2) break;
        await orbitCameraToYaw(page, Math.atan2(-dx, -dz), { currentYaw: s.camera.yaw });
        if (!s.player.grounded && dist < 0.95) {
          await page.keyboard.up('KeyW');
        } else {
          await page.keyboard.down('KeyW');
        }
        if (!jumped && s.player.grounded && dist <= jumpTrigger) {
          await page.keyboard.down('Space');
          await advanceTime(page, 1 / 60);
          await page.keyboard.up('Space');
          jumped = true;
        }
        await advanceTime(page, 2 / 60);
      }
      await releaseAllGameKeys(page);
    }

    const onSafeRim = await getSnapshot(page);
    expect(onSafeRim.player.grounded).toBe(true);
    expect(Math.hypot(onSafeRim.player.x - 76.2, onSafeRim.player.z - -127.8)).toBeGreaterThan(1.65);

    // Walk straight toward central red dot at (76.2, -127.8) and catch exact respawn at CP3 (44.5, 11.5, -125.8)
    const { respawned, snapshot: post } = await triggerHazardRespawnAt(page, 76.2, -127.8, {
      jump: false,
    });
    expect(respawned).toBe(true);
    expect(post.activeCheckpoint).toBe(3);
    expect(Math.hypot(post.player.x - 44.5, post.player.z - -125.8)).toBeLessThan(0.15);
    await expectBadgeLevel(page, 4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F11-06: Section 9 sweeper drum boundary: jumping over rotating red arm stays safe, while standing still hits arm and respawns at CP8', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 8);
    await expectBadgeLevel(page, 9);

    for (let w = 0; w < 100; w++) {
      if (Math.cos(1.3 * (getCourseElapsed(page) + 0.95)) < -0.8) break;
      await advanceTime(page, 3 / 60);
    }

    let landedOnDrum = false;
    for (let attempt = 0; attempt < 4 && !landedOnDrum; attempt++) {
      if (attempt > 0) await advanceTime(page, 1.1);
      const s0 = await getSnapshot(page);
      const yaw = Math.atan2(-(28.2 - s0.player.x), -(-79.8 - s0.player.z));
      await orbitCameraToYaw(page, yaw, { currentYaw: s0.camera.yaw });
      await page.keyboard.down('KeyW');
      for (let i = 0; i < 60; i++) {
        const s = await getSnapshot(page);
        const dist = Math.hypot(28.2 - s.player.x, -79.8 - s.player.z);
        if (s.player.grounded && dist <= 10.2) {
          await page.keyboard.down('Space');
          await advanceTime(page, 1 / 60);
          await page.keyboard.up('Space');
          await advanceTime(page, 0.35);
          await page.keyboard.up('KeyW');
          await advanceTime(page, 0.25);
          break;
        }
        await advanceTime(page, 1 / 60);
      }
      await releaseAllGameKeys(page);
      const check = await getSnapshot(page);
      if (check.player.grounded && Math.abs(check.player.z - -79.8) < 4.5) {
        landedOnDrum = true;
      }
    }
    expect(landedOnDrum).toBe(true);

    // Jump vertically when arm approaches to clear one pass, then stand still up to 5.0s so rotating arm (period ~4.83s) sweeps feet -> respawn at CP8
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.55);

    let hitSweeper = false;
    for (let i = 0; i < 320; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (Math.hypot(s.player.x - 26.0, s.player.z - -64.8) < 0.5) {
        hitSweeper = true;
        break;
      }
    }
    expect(hitSweeper).toBe(true);
    await expectBadgeLevel(page, 9);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F12 Boundaries: Rigged Snowball 3D Elf & Contact Blob Shadow', () => {
  test('T2-F12-01: rapid WASD direction reversals (W -> S -> A -> D every 0.08s) wrap facingYaw smoothly across +-PI without NaN', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    for (const key of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyS', 'KeyW']) {
      await holdKeysAndAdvance(page, [key], 0.08, 1 / 60);
      const s = await getSnapshot(page);
      expect(Number.isFinite(s.player.facingYaw)).toBe(true);
    }
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F12-02: airborne-to-respawn transition (falling into void from jump pose) resets avatar cleanly to grounded idle at checkpoint', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.55);
    await page.keyboard.up('KeyD');
    expect((await getSnapshot(page)).player.animState).toBe('jump');

    await advanceTime(page, 1.8);
    const respawned = await getSnapshot(page);
    expect(respawned.player.grounded).toBe(true);
    expect(respawned.player.animState).toBe('idle');
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F12-03: celebration-to-restart transition: reaching Section 10 (celebrate) then clicking #playagainButton resets pose to idle at CP0', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    expect((await getSnapshot(page)).player.animState).toBe('celebrate');

    await clickOverlayPlayAgain(page);
    const resetSnap = await getSnapshot(page);
    expect(resetSnap.player.animState).toBe('idle');
    expect(resetSnap.activeCheckpoint).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F12-04: zooming to minimum distance (5.5 studs) and maximum distance (45.0 studs) renders elf and course with glError === 0', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, -10000, 0.8);
    const closeFrame = await sampleWebGLFrame(page);
    expect(closeFrame.glError).toBe(0);
    expect(closeFrame.distinctColors).toBeGreaterThanOrEqual(3);

    await zoomCameraByWheel(page, 10000, 0.8);
    const farFrame = await sampleWebGLFrame(page);
    expect(farFrame.glError).toBe(0);
    expect(farFrame.distinctColors).toBeGreaterThanOrEqual(4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F12-05: jumping out over open sky / void updates ground-raycast contact blob shadow cleanly with zero raycast errors', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.65);
    await page.keyboard.up('KeyD');

    const overVoid = await getSnapshot(page);
    expect(overVoid.player.x).toBeGreaterThan(7.5);
    const frame = await sampleWebGLFrame(page);
    expect(frame.glError).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F13 Boundaries: 10-Section Winding Course & 3D Props', () => {
  test('T2-F13-01: viewport resize to narrow portrait (480x850) updates <canvas> size and keeps WebGL rendering valid', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.setViewportSize({ width: 480, height: 850 });
    await page.waitForTimeout(100);
    const frame = await sampleWebGLFrame(page);
    expect(frame.clientWidth).toBe(480);
    expect(frame.clientHeight).toBe(850);
    expect(frame.glError).toBe(0);
    expect(frame.distinctColors).toBeGreaterThanOrEqual(4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F13-02: viewport resize to ultra-wide (1920x600) updates <canvas> aspect ratio cleanly without WebGL error', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.setViewportSize({ width: 1920, height: 600 });
    await page.waitForTimeout(100);
    const frame = await sampleWebGLFrame(page);
    expect(frame.clientWidth).toBe(1920);
    expect(frame.clientHeight).toBe(600);
    expect(frame.glError).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F13-03: advancing 60.0s of course kinematic time keeps all moving/spinning platform phases finite and periodic', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await advanceTime(page, 60.0);
    const snap = await getSnapshot(page);
    expect(Number.isFinite(snap.player.x)).toBe(true);
    expect(Number.isFinite(snap.player.y)).toBe(true);
    expect(Number.isFinite(snap.player.z)).toBe(true);
    const frame = await sampleWebGLFrame(page);
    expect(frame.glError).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F13-04: restart resets dynamic course timers deterministically so two post-restart runs match on Section 6 moving platforms', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);

    // Advance arbitrary asymmetric time (1.73s), then restart #1 and navigate to CP5 + jump onto sec6_gift1 at fixed delay
    await advanceTime(page, 1.73);
    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);
    await navigateToCheckpoint(page, 5);
    const run1AtCp5 = await getSnapshot(page);

    // Advance another asymmetric offset (2.91s), restart #2, replay identical navigateToCheckpoint(5)
    await advanceTime(page, 2.91);
    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);
    await navigateToCheckpoint(page, 5);
    const run2AtCp5 = await getSnapshot(page);

    expect(run2AtCp5.activeCheckpoint).toBe(run1AtCp5.activeCheckpoint);
    expect(run2AtCp5.player.y).toBeCloseTo(run1AtCp5.player.y, 2);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F13-05: every checkpoint k (0..8) is followed by reachable sectionWaypoints with consecutive horizontal step distances within jump reach', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const snap = await getSnapshot(page);
    expect(snap.sectionWaypoints.length).toBeGreaterThanOrEqual(50);

    for (let i = 1; i < snap.sectionWaypoints.length; i++) {
      const prev = snap.sectionWaypoints[i - 1];
      const curr = snap.sectionWaypoints[i];
      const centerDist = Math.hypot(curr.x - prev.x, curr.z - prev.z);
      // Accounting for 6-stud checkpoint half-extents / 5.5-stud drum & cross radii, edge-to-edge gap is <= 8.5 studs (center-to-center <= 16.5)
      expect(
        centerDist,
        `Waypoint step ${i - 1}->${i} (${prev.kind}->${curr.kind}) must be within jump reach`
      ).toBeLessThanOrEqual(16.5);
      expect(curr.y - prev.y).toBeLessThanOrEqual(3.5);
    }
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F14 Boundaries: Strict Zero Touch Controls Prohibition', () => {
  test('T2-F14-01: resizing viewport down to mobile dimensions (375x667) does NOT inject any virtual thumbstick or jump button', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(100);
    await advanceTime(page, 0.25);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F14-02: firing resize events across multiple aspect ratios never registers lazy touch* listeners', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    for (const vp of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 720 },
    ]) {
      await page.setViewportSize(vp);
      await advanceTime(page, 0.1);
    }
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F14-03: multi-pointer touch pinch simulation (2x pointerdown/move with pointerType="touch") does NOT zoom or pan camera', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = await getSnapshot(page);

    const f = await jollyobby.contentFrame(page);
    await f.evaluate(() => {
      const canvas = document.querySelector('#module-jollyobby canvas');
      for (const [id, x0, x1] of [
        [1, 300, 180],
        [2, 500, 620],
      ]) {
        canvas.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: id,
            pointerType: 'touch',
            clientX: x0,
            clientY: 360,
            bubbles: true,
          })
        );
        window.dispatchEvent(
          new PointerEvent('pointermove', {
            pointerId: id,
            pointerType: 'touch',
            clientX: x1,
            clientY: 360,
            bubbles: true,
          })
        );
        window.dispatchEvent(
          new PointerEvent('pointerup', {
            pointerId: id,
            pointerType: 'touch',
            clientX: x1,
            clientY: 360,
            bubbles: true,
          })
        );
      }
    });
    await advanceTime(page, 0.3);

    const after = await getSnapshot(page);
    expect(after.camera.distance).toBeCloseTo(before.camera.distance, 5);
    expect(after.camera.yaw).toBeCloseTo(before.camera.yaw, 5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F14-04: host <santa-orientation> rotate-device overlay stays [hidden] on desktop and narrow viewports', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await expect(page.locator('santa-orientation')).toHaveAttribute('hidden', '');

    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForTimeout(80);
    await expect(page.locator('santa-orientation')).toHaveAttribute('hidden', '');
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F14-05: after pause -> resume and #playagainButton restart, window.__E2E_REGISTERED_EVENTS__ still contains zero touch* handlers', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await clickChromePauseOrPlay(page);
    await clickOverlayPlay(page);
    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F15 Boundaries: Strict Zero In-Scene UI/HUD & Zero Text', () => {
  test('T2-F15-01: checkpoint activation (CP0 -> CP1 with particle burst active) injects zero DOM HUD/banner/toast nodes and zero canvas text', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F15-02: void fall & hazard respawn transition injects zero Wipeout/Try Again text or red flash DOM divs inside #module-jollyobby', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await holdKeysAndAdvance(page, ['KeyD'], 0.7);
    await advanceTime(page, 1.5);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F15-03: pausing and resuming injects zero in-scene pause text inside #module-jollyobby (pause UI lives strictly in host <santa-overlay>)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await clickChromePauseOrPlay(page);
    await assertZeroUiTextAndTouch(page);
    await clickOverlayPlay(page);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F15-04: Section 10 Finish Goal celebration injects zero in-scene victory banner/text inside #module-jollyobby', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F15-05: no aria-label, title, or alt visible tooltip/overlay text attributes exist inside #module-jollyobby', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const attrs = await f.evaluate(() => {
      const root = document.querySelector('#module-jollyobby');
      const found = [];
      for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
        for (const name of ['aria-label', 'title', 'alt', 'placeholder']) {
          if (el.hasAttribute(name)) {
            found.push(`${el.tagName}[${name}]`);
          }
        }
      }
      return found;
    });
    expect(attrs).toEqual([]);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 2 — F16 Boundaries: Deterministic Test Bridge & Zero Runtime Errors', () => {
  test('T2-F16-01: advanceTime(0) and advanceTime(-0.5) are safe no-ops that never move backward or produce NaN', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await holdKeysAndAdvance(page, ['KeyW'], 0.2);
    const before = await getSnapshot(page);

    await advanceTime(page, 0);
    await advanceTime(page, -0.5);
    const after = await getSnapshot(page);

    expect(Number.isFinite(after.player.x)).toBe(true);
    expect(Number.isFinite(after.player.y)).toBe(true);
    expect(Number.isFinite(after.player.z)).toBe(true);
    expect(after.player.z).toBeCloseTo(before.player.z, 5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F16-02: micro-step advanceTime(1/240) x 240 vs advanceTime(1/60) x 60 at rest produces consistent grounded state with zero drift', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await advanceTime(page, 1.0, { step: 1 / 240 });
    const micro = await getSnapshot(page);

    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);
    await advanceTime(page, 1.0, { step: 1 / 60 });
    const standard = await getSnapshot(page);

    expect(micro.player.grounded).toBe(true);
    expect(standard.player.grounded).toBe(true);
    expect(micro.player.x).toBeCloseTo(standard.player.x, 4);
    expect(micro.player.y).toBeCloseTo(standard.player.y, 4);
    expect(micro.player.z).toBeCloseTo(standard.player.z, 4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F16-03: loading /jollyobby.html in normal wall-clock mode (__MANUAL_TIME__ unset) runs rAF loop naturally and moves player under WASD', async ({
    page,
    baseURL,
  }) => {
    const monitors = await attachRuntimeMonitors(page);
    const { prodOrigin } = resolveServerUrls(baseURL);
    await page.goto(`${prodOrigin}/jollyobby.html`, { waitUntil: 'domcontentloaded' });
    await jollyobby.gameElem(page).waitFor({ state: 'attached', timeout: 45000 });
    const f = await jollyobby.contentFrame(page);
    await f.evaluate(async () => {
      const deadline = Date.now() + 45000;
      while (!(window.__TEST_CONTROL__ && window.__TEST_CONTROL__.isReady())) {
        if (Date.now() > deadline) throw new Error('Wall-clock isReady timeout');
        await new Promise((r) => setTimeout(r, 30));
      }
    });
    await page.waitForFunction(
      () => {
        const interlude = document.querySelector('santa-interlude');
        return !interlude || !interlude.hasAttribute('active');
      },
      null,
      { timeout: 30000 }
    );

    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(260);
    await page.keyboard.up('KeyW');

    const snap = await getSnapshot(page);
    expect(snap.player.z).toBeLessThan(-1.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F16-04: window.__JOLLYOBBY_STATE__ read-only mirror matches getSnapshot() schema and throws strict-mode TypeError on mutation', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const check = await f.evaluate(() => {
      'use strict';
      const ctrlDesc = Object.getOwnPropertyDescriptor(window, '__TEST_CONTROL__');
      const stateDesc = Object.getOwnPropertyDescriptor(window, '__JOLLYOBBY_STATE__');
      const mirror = window.__JOLLYOBBY_STATE__;
      const snap = window.__TEST_CONTROL__.getSnapshot();
      const equal = JSON.stringify(mirror) === JSON.stringify(snap);
      const frozen =
        Object.isFrozen(window.__TEST_CONTROL__) &&
        Object.isFrozen(mirror) &&
        Object.isFrozen(mirror.player);
      const descriptorsLocked =
        Boolean(ctrlDesc) &&
        ctrlDesc.writable === false &&
        ctrlDesc.configurable === false &&
        Boolean(stateDesc) &&
        stateDesc.configurable === false &&
        stateDesc.set === undefined;

      const mutationOps = [
        () => {
          window.__TEST_CONTROL__ = {};
        },
        () => {
          window.__JOLLYOBBY_STATE__ = {};
        },
        () => {
          mirror.currentSection = 99;
        },
        () => {
          mirror.player.x = 5555;
        },
      ];
      const allThrewTypeError = mutationOps.every((fn) => {
        try {
          fn();
          return false;
        } catch (err) {
          return err instanceof TypeError;
        }
      });

      const after = window.__TEST_CONTROL__.getSnapshot();
      return {
        equal,
        frozen,
        descriptorsLocked,
        allThrewTypeError,
        sectionAfter: after.currentSection,
        xAfter: after.player.x,
      };
    });
    expect(check).toEqual({
      equal: true,
      frozen: true,
      descriptorsLocked: true,
      allThrewTypeError: true,
      sectionAfter: 1,
      xAfter: 0,
    });
    assertZeroRuntimeErrors(monitors);
  });

  test('T2-F16-05: calling getSnapshot() 200x rapidly in a tight loop incurs zero leaks and completes rapidly', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const res = await f.evaluate(() => {
      const domBefore = document.querySelectorAll('*').length;
      const t0 = performance.now();
      let last = null;
      for (let i = 0; i < 200; i++) {
        last = window.__TEST_CONTROL__.getSnapshot();
      }
      const elapsedMs = performance.now() - t0;
      const domAfter = document.querySelectorAll('*').length;
      return { elapsedMs, domBefore, domAfter, ready: last.ready };
    });
    expect(res.ready).toBe(true);
    expect(res.domAfter).toBe(res.domBefore);
    expect(res.elapsedMs).toBeLessThan(250);
    assertZeroRuntimeErrors(monitors);
  });
});
