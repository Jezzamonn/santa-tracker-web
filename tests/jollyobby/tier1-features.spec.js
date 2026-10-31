const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  WORKTREE_ROOT,
  BASE_REPO_ROOT,
  SCENE_DIR,
  jollyobby,
  expectGameOverOverlay,
  resolveServerUrls,
  readPngMetadata,
  listRelativeFiles,
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
  clickOverlayPlay,
  clickOverlayPlayAgain,
  sampleWebGLFrame,
  assertZeroUiTextAndTouch,
  navigateToCheckpoint,
  navigateCourseToGoal,
} = require('./helpers');

test.describe('Tier 1 — F1: Isolated JJ Workspace & Port Isolation', () => {
  test('T1-F01-01: worktree directory is santa-tracker-web-jollyobby with .jj workspace metadata', async () => {
    expect(path.basename(WORKTREE_ROOT)).toBe('santa-tracker-web-jollyobby');
    const jjDir = path.join(WORKTREE_ROOT, '.jj');
    expect(fs.existsSync(jjDir)).toBe(true);
    expect(fs.statSync(jjDir).isDirectory()).toBe(true);
  });

  test('T1-F01-02: node_modules at worktree root is a symlink and resolves three@0.158.0', async () => {
    const nmPath = path.join(WORKTREE_ROOT, 'node_modules');
    expect(fs.existsSync(nmPath)).toBe(true);
    expect(fs.lstatSync(nmPath).isSymbolicLink()).toBe(true);
    const threePkgPath = path.join(nmPath, 'three/package.json');
    const threePkg = JSON.parse(fs.readFileSync(threePkgPath, 'utf8'));
    expect(threePkg.version).toBe('0.158.0');
  });

  test('T1-F01-03: prod host server responds 200 OK (text/html) on configured port for /jollyobby.html', async ({
    request,
    baseURL,
  }) => {
    const { prodOrigin, hostname } = resolveServerUrls(baseURL);
    expect(['localhost', '127.0.0.1']).toContain(hostname);
    const res = await request.get(`${prodOrigin}/jollyobby.html`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type'] || '').toContain('text/html');
  });

  test('T1-F01-04: static VFS server responds 200 OK with CORS header on port+80', async ({
    request,
    baseURL,
  }) => {
    const { staticBase } = resolveServerUrls(baseURL);
    const res = await request.get(`${staticBase}/scenes/jollyobby/index.html`);
    expect(res.status()).toBe(200);
    expect(res.headers()['access-control-allow-origin']).toBe('*');
  });

  test('T1-F01-05: base repository checkout contains zero static/scenes/jollyobby directory (strict R1 isolation)', async () => {
    expect(fs.existsSync(BASE_REPO_ROOT)).toBe(true);
    const baseSceneDir = path.join(BASE_REPO_ROOT, 'static/scenes/jollyobby');
    expect(fs.existsSync(baseSceneDir)).toBe(false);
  });
});

test.describe('Tier 1 — F2: jollyobby Host Scene Registration & Release Bundling', () => {
  test('T1-F02-01: static/src/strings/scenes.js registers jollyobby matching release.js parser format', async () => {
    const scenesJs = fs.readFileSync(
      path.join(WORKTREE_ROOT, 'static/src/strings/scenes.js'),
      'utf8'
    );
    expect(scenesJs).toMatch(/'jollyobby'\s*:\s*_msg`scene_jollyobby`/);
  });

  test('T1-F02-02: en_src_messages.json and _messages/en.json define scene_jollyobby as Jolly Obby', async () => {
    const enSrc = JSON.parse(
      fs.readFileSync(path.join(WORKTREE_ROOT, 'en_src_messages.json'), 'utf8')
    );
    const enCompiled = JSON.parse(
      fs.readFileSync(path.join(WORKTREE_ROOT, '_messages/en.json'), 'utf8')
    );
    expect(enSrc.scene_jollyobby).toBeTruthy();
    expect(enSrc.scene_jollyobby.message).toBe('Jolly Obby');
    expect(enCompiled.scene_jollyobby).toBeTruthy();
    expect(enCompiled.scene_jollyobby.message).toBe('Jolly Obby');
  });

  test('T1-F02-03: scene card 1x (475x282), 2x (950x564), and OG (1333x1000) PNGs exist with valid IHDR dimensions', async () => {
    const card1x = readPngMetadata(
      path.join(WORKTREE_ROOT, 'static/img/scenes/jollyobby_1x.png')
    );
    const card2x = readPngMetadata(
      path.join(WORKTREE_ROOT, 'static/img/scenes/jollyobby_2x.png')
    );
    const ogImg = readPngMetadata(path.join(WORKTREE_ROOT, 'prod/images/og/jollyobby.png'));

    expect(card1x.validSignature).toBe(true);
    expect({ width: card1x.width, height: card1x.height }).toEqual({ width: 475, height: 282 });

    expect(card2x.validSignature).toBe(true);
    expect({ width: card2x.width, height: card2x.height }).toEqual({ width: 950, height: 564 });

    expect(ogImg.validSignature).toBe(true);
    expect({ width: ogImg.width, height: ogImg.height }).toEqual({ width: 1333, height: 1000 });
  });

  test('T1-F02-04: remote-config-defaults.js includes jollyobby in nav and santa-card.js excludes it from Lottie-only list', async () => {
    const rcSrc = fs.readFileSync(
      path.join(WORKTREE_ROOT, 'prod/src/remote-config-defaults.js'),
      'utf8'
    );
    expect(rcSrc).toMatch(/['"]jollyobby['"]/);

    const cardSrc = fs.readFileSync(
      path.join(WORKTREE_ROOT, 'static/src/elements/santa-card.js'),
      'utf8'
    );
    const scenesWithColorMatch = cardSrc.match(/scenesWithColor\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
    if (scenesWithColorMatch) {
      expect(scenesWithColorMatch[1]).not.toMatch(/['"]jollyobby['"]/);
    }
  });

  test('T1-F02-05: all non-code static assets under static/scenes/jollyobby/ reside inside models/ or img/', async () => {
    const files = listRelativeFiles(SCENE_DIR);
    const binaryAssetFiles = files.filter((rel) =>
      /\.(png|jpg|jpeg|webp|gif|svg|gltf|glb|bin|obj|mtl|mp3|ogg|wav)$/i.test(rel)
    );
    for (const rel of binaryAssetFiles) {
      expect(rel).toMatch(/^(models|img)\//);
    }
  });

  test('T1-F02-06: loading /jollyobby.html sets title Jolly Obby, clears interlude, and boots WebGL with zero santa-error', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await expect(page).toHaveTitle(/Jolly Obby/i);
    await expect(jollyobby.iframe(page)).toBeVisible();
    await expect(page.locator('santa-error')).toHaveCount(0);
    const snap = await getSnapshot(page);
    expect(snap.ready).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F3: Host Level Badge Progression (1..10)', () => {
  test('T1-F03-01: initial boot sets <santa-badge> level=1, maxLevel=10, score=0', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const badge = await getBadgeState(page);
    expect(badge.level).toBe(1);
    expect(badge.maxLevel).toBe(10);
    expect(badge.score).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F03-02: <santa-badge> shadow DOM renders 1·10 inside .data.alt with Level label (never Iced)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await expectBadgeLevel(page, 1);
    const badge = await getBadgeState(page);
    expect(badge.displayText).toBe('1\u00b710');
    expect(badge.labelText).toMatch(/^level$/i);
    expect(badge.labelText).not.toMatch(/iced/i);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F03-03: <santa-badge> .item retains alt-active after 2.5s wall-clock + manual time', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await expectBadgeLevel(page, 1);
    await page.waitForTimeout(2200);
    await advanceTime(page, 2.5);
    const badgeAfter = await getBadgeState(page);
    expect(badgeAfter.altActive).toBe(true);
    expect(badgeAfter.altHidden).toBe(false);
    expect(badgeAfter.displayText).toBe('1\u00b710');
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F03-04: navigating across Section 1 to CP1 updates <santa-badge> to 2·10', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const res = await navigateToCheckpoint(page, 1);
    expect(res.reached).toBe(true);
    await expectBadgeLevel(page, 2);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F03-05: advancing through Section 2 to CP2 updates <santa-badge> to 3·10', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const res = await navigateToCheckpoint(page, 2);
    expect(res.reached).toBe(true);
    await expectBadgeLevel(page, 3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F03-06: advancing through Section 3 to CP3 updates <santa-badge> to 4·10 in sync with currentSection=4', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const res = await navigateToCheckpoint(page, 3);
    expect(res.reached).toBe(true);
    expect(res.snapshot.currentSection).toBe(4);
    await expectBadgeLevel(page, 4);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F4: Section 10 Host Completion / Game-Over', () => {
  test('T1-F04-01: before reaching Section 10 Finish Goal, <santa-overlay> is hidden and completed is false', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await expect(page.locator('santa-overlay')).toHaveAttribute('hidden', '');
    const snap = await getSnapshot(page);
    expect(snap.completed).toBe(false);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F04-02: navigating course to Section 10 Finish Goal sets completed=true and badge 10·10', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    const res = await navigateCourseToGoal(page);
    expect(res.reached).toBe(true);
    expect(res.snapshot.completed).toBe(true);
    await expectBadgeLevel(page, 10);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F04-03: reaching Section 10 Finish Goal reveals <santa-overlay> passing expectGameOverOverlay', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F04-04: completion overlay .hero has class gameover, .url stays [hidden], and zero Firebase shortLink calls occur', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);

    const overlayDetails = await page.evaluate(() => {
      const ov = document.querySelector('santa-overlay');
      const hero = ov.shadowRoot.querySelector('.hero');
      const urlBox = ov.shadowRoot.querySelector('.url');
      return {
        heroClasses: Array.from(hero.classList),
        urlHidden: urlBox.hasAttribute('hidden'),
      };
    });
    expect(overlayDetails.heroClasses).toContain('gameover');
    expect(overlayDetails.heroClasses).not.toContain('share');
    expect(overlayDetails.heroClasses).not.toContain('pause');
    expect(overlayDetails.urlHidden).toBe(true);
    expect(monitors.firebaseShortLinkCalls).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F04-05: once completed, WASD and Space inputs are frozen so player stays on Section 10 Finish Dais', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);

    const winSnap = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['KeyW', 'KeyD', 'Space'], 1.0);
    const afterSnap = await getSnapshot(page);

    expect(Math.hypot(afterSnap.player.x - winSnap.player.x, afterSnap.player.z - winSnap.player.z)).toBeLessThan(1e-4);
    expect(afterSnap.completed).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F5: Host Lifecycle (pause, resume, restart, Audio & Focus)', () => {
  test('T1-F05-01: synchronous api.config({ pause: true }) enables <santa-chrome> pause action button', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const chromeAction = await page.evaluate(() => {
      const chrome = document.querySelector('santa-chrome');
      const btn = chrome.shadowRoot.querySelectorAll('header santa-button')[2];
      return { action: chrome.action, disabled: btn.hasAttribute('disabled') };
    });
    expect(chromeAction).toEqual({ action: 'pause', disabled: false });
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F05-02: clicking <santa-chrome> Pause opens <santa-overlay> in pause mode and sets paused=true', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const snap = await clickChromePauseOrPlay(page);
    expect(snap.paused).toBe(true);
    await expect(page.locator('santa-overlay #playButton')).toBeVisible();
    const isPausedProp = await page.evaluate(() => document.querySelector('santa-overlay').isPaused);
    expect(isPausedProp).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F05-03: clicking #playButton on paused <santa-overlay> hides overlay and sets paused=false', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await clickChromePauseOrPlay(page);
    await clickOverlayPlay(page);
    const snap = await getSnapshot(page);
    expect(snap.paused).toBe(false);
    await expect(page.locator('santa-overlay')).toHaveAttribute('hidden', '');
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F05-04: clicking <santa-chrome> audio mute/unmute button toggles muted state cleanly without errors', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const initialMuted = await page.evaluate(() => Boolean(document.querySelector('santa-chrome').muted));
    const afterFirstClick = await clickChromeMuteToggle(page);
    expect(afterFirstClick).toBe(!initialMuted);
    const afterSecondClick = await clickChromeMuteToggle(page);
    expect(afterSecondClick).toBe(initialMuted);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F05-05: clicking #playagainButton from pause overlay resets player to CP0 and badge from 2·10 to 1·10', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);

    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);

    const snap = await getSnapshot(page);
    expect(snap.activeCheckpoint).toBe(0);
    expect(snap.currentSection).toBe(1);
    expect(Math.hypot(snap.player.x - snap.checkpoints[0].x, snap.player.z - snap.checkpoints[0].z)).toBeLessThan(0.1);
    await expectBadgeLevel(page, 1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F05-06: immediately after loadJollyObby WITHOUT focusing iframe or clicking canvas, KeyW moves player North', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['KeyW'], 0.3);
    const after = await getSnapshot(page);
    expect(after.player.z - before.player.z).toBeLessThan(-3.5);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F6: Keyboard Movement (WASD & Arrow Keys)', () => {
  test('T1-F06-01: holding KeyW for 0.25s at default camera yaw moves player North (-Z)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const s0 = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['KeyW'], 0.25);
    const s1 = await getSnapshot(page);
    expect(s1.player.z - s0.player.z).toBeLessThan(-3.0);
    expect(Math.abs(s1.player.x - s0.player.x)).toBeLessThan(0.1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F06-02: holding KeyS for 0.25s moves player South (+Z)', async ({ page, baseURL }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const s0 = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['KeyS'], 0.25);
    const s1 = await getSnapshot(page);
    expect(s1.player.z - s0.player.z).toBeGreaterThan(3.0);
    expect(Math.abs(s1.player.x - s0.player.x)).toBeLessThan(0.1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F06-03: holding KeyA for 0.25s moves player West (-X)', async ({ page, baseURL }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const s0 = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['KeyA'], 0.25);
    const s1 = await getSnapshot(page);
    expect(s1.player.x - s0.player.x).toBeLessThan(-3.0);
    expect(Math.abs(s1.player.z - s0.player.z)).toBeLessThan(0.1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F06-04: holding KeyD for 0.25s moves player East (+X)', async ({ page, baseURL }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const s0 = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['KeyD'], 0.25);
    const s1 = await getSnapshot(page);
    expect(s1.player.x - s0.player.x).toBeGreaterThan(3.0);
    expect(Math.abs(s1.player.z - s0.player.z)).toBeLessThan(0.1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F06-05: holding ArrowUp for 0.25s moves player North (-Z) matching KeyW', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const s0 = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['ArrowUp'], 0.25);
    const s1 = await getSnapshot(page);
    expect(s1.player.z - s0.player.z).toBeLessThan(-3.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F06-06: holding ArrowDown for 0.25s moves player South (+Z) matching KeyS', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const s0 = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['ArrowDown'], 0.25);
    const s1 = await getSnapshot(page);
    expect(s1.player.z - s0.player.z).toBeGreaterThan(3.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F06-07: holding ArrowLeft then ArrowRight moves West (-X) then East (+X)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const s0 = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['ArrowLeft'], 0.25);
    await advanceTime(page, 0.15);
    const sWest = await getSnapshot(page);
    expect(sWest.player.x - s0.player.x).toBeLessThan(-3.0);

    await holdKeysAndAdvance(page, ['ArrowRight'], 0.5);
    const sEast = await getSnapshot(page);
    expect(sEast.player.x - sWest.player.x).toBeGreaterThan(6.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F06-08: steady-state ground speed matches Roblox WalkSpeed=16.0 studs/s and decelerates to 0 on release', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.2);
    const running = await getSnapshot(page);
    const speed = Math.hypot(running.player.vx, running.player.vz);
    expect(speed).toBeGreaterThanOrEqual(15.5);
    expect(speed).toBeLessThanOrEqual(16.2);

    await page.keyboard.up('KeyW');
    await advanceTime(page, 0.15);
    const stopped = await getSnapshot(page);
    expect(Math.hypot(stopped.player.vx, stopped.player.vz)).toBeLessThan(0.05);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F7: Keyboard Jump (Space)', () => {
  test('T1-F07-01: pressing Space while grounded on CP0 launches player upward (vy > 45, grounded=false)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    const snap = await getSnapshot(page);
    expect(snap.player.grounded).toBe(false);
    expect(snap.player.vy).toBeGreaterThan(45.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F07-02: jump apex height above CP0 matches Roblox feel (6.3..7.4 studs, target ~6.89)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const baseSnap = await getSnapshot(page);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');

    let maxY = baseSnap.player.y;
    for (let i = 0; i < 36; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (s.player.y > maxY) maxY = s.player.y;
    }
    const peakDeltaY = maxY - baseSnap.player.y;
    expect(peakDeltaY).toBeGreaterThanOrEqual(6.3);
    expect(peakDeltaY).toBeLessThanOrEqual(7.4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F07-03: jump apex occurs at t_apex ~0.265s and landing occurs at t_total ~0.530s', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');

    let peakT = 1 / 60;
    let peakY = -Infinity;
    let landT = null;
    for (let step = 2; step <= 42; step++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      const t = step / 60;
      if (s.player.y > peakY) {
        peakY = s.player.y;
        peakT = t;
      }
      if (landT === null && step > 10 && s.player.grounded) {
        landT = t;
      }
    }
    expect(peakT).toBeGreaterThanOrEqual(0.23);
    expect(peakT).toBeLessThanOrEqual(0.31);
    expect(landT).not.toBeNull();
    expect(landT).toBeGreaterThanOrEqual(0.49);
    expect(landT).toBeLessThanOrEqual(0.58);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F07-04: running forward jump (KeyW + Space) spans gap from CP0 onto first Section 1 hex pad', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.31);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.56);
    await page.keyboard.up('KeyW');

    const landed = await getSnapshot(page);
    expect(landed.player.grounded).toBe(true);
    expect(landed.player.z).toBeLessThan(-10.5);
    expect(landed.player.y).toBeGreaterThan(0.3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F07-05: pressing Space does not scroll host window or scene iframe', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.press('Space');
    await advanceTime(page, 0.2);
    const hostScroll = await page.evaluate(() => window.scrollY);
    const frameScroll = await (await jollyobby.contentFrame(page)).evaluate(() => window.scrollY);
    expect(hostScroll).toBe(0);
    expect(frameScroll).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F8: Mouse Click + Drag Camera Orbit', () => {
  test('T1-F08-01: initial camera state matches CAMERA_CONFIG defaults (distance ~17.0, pitch ~26 deg, yaw ~0)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { camera } = await getSnapshot(page);
    expect(camera.distance).toBeCloseTo(17.0, 1);
    expect(camera.pitch).toBeCloseTo((26 * Math.PI) / 180, 2);
    expect(camera.yaw).toBeCloseTo(0, 2);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F08-02: left-click dragging horizontally right (+180px) orbits camera yaw without altering pitch', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = (await getSnapshot(page)).camera;
    await orbitCameraByDrag(page, 180, 0);
    const after = (await getSnapshot(page)).camera;
    expect(Math.abs(after.yaw - before.yaw)).toBeGreaterThan(0.7);
    expect(Math.abs(after.pitch - before.pitch)).toBeLessThan(0.02);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F08-03: left-click dragging horizontally left (-180px) orbits camera yaw in opposite direction', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = (await getSnapshot(page)).camera;
    await orbitCameraByDrag(page, -180, 0);
    const after = (await getSnapshot(page)).camera;
    expect(after.yaw - before.yaw).toBeGreaterThan(0.7);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F08-04: left-click dragging vertically (+100px / -100px) adjusts camera pitch up and down smoothly', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const c0 = (await getSnapshot(page)).camera;
    await orbitCameraByDrag(page, 0, 100);
    const cUp = (await getSnapshot(page)).camera;
    expect(cUp.pitch).toBeGreaterThan(c0.pitch + 0.35);

    await orbitCameraByDrag(page, 0, -200);
    const cDown = (await getSnapshot(page)).camera;
    expect(cDown.pitch).toBeLessThan(c0.pitch - 0.35);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F08-05: moving mouse across canvas WITHOUT holding mouse button does not rotate yaw or pitch', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = (await getSnapshot(page)).camera;
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.move(x - 120, y - 50);
    await page.mouse.move(x + 120, y + 50, { steps: 8 });
    await advanceTime(page, 0.15);
    const after = (await getSnapshot(page)).camera;
    expect(after.yaw).toBeCloseTo(before.yaw, 5);
    expect(after.pitch).toBeCloseTo(before.pitch, 5);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F9: Mouse Scroll-Wheel Camera Zoom', () => {
  test('T1-F09-01: scrolling wheel up (deltaY = -200) zooms camera closer to elf (distance < 17.0)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, -200, 0.35);
    const { camera } = await getSnapshot(page);
    expect(camera.distance).toBeLessThan(15.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F09-02: scrolling wheel down (deltaY = +200) zooms camera farther from elf (distance > 17.0)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, 200, 0.35);
    const { camera } = await getSnapshot(page);
    expect(camera.distance).toBeGreaterThan(19.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F09-03: multiple incremental wheel notches zoom monotonically across [8, 30] studs', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, -400, 0.35);
    const dIn = (await getSnapshot(page)).camera.distance;
    expect(dIn).toBeGreaterThanOrEqual(8.0);
    expect(dIn).toBeLessThan(11.0);

    await zoomCameraByWheel(page, 900, 0.35);
    const dOut = (await getSnapshot(page)).camera.distance;
    expect(dOut).toBeGreaterThan(24.0);
    expect(dOut).toBeLessThanOrEqual(30.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F09-04: zooming preserves current camera yaw and pitch', async ({ page, baseURL }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await orbitCameraByDrag(page, 110, 45);
    const before = (await getSnapshot(page)).camera;
    await zoomCameraByWheel(page, -300, 0.35);
    const after = (await getSnapshot(page)).camera;
    expect(after.yaw).toBeCloseTo(before.yaw, 4);
    expect(after.pitch).toBeCloseTo(before.pitch, 4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F09-05: scrolling wheel over game canvas prevents document scroll (scrollY === 0)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, 500, 0.2);
    const hostScroll = await page.evaluate(() => window.scrollY);
    const frameScroll = await (await jollyobby.contentFrame(page)).evaluate(() => window.scrollY);
    expect(hostScroll).toBe(0);
    expect(frameScroll).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F10: Roblox-Feel Hitbox, Substepped Collision & Platform Carry', () => {
  test('T1-F10-01: grounded player rests flush on CP0 top surface (|y - cp0.y| < 0.08, vy=0, grounded=true)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await advanceTime(page, 0.25);
    const snap = await getSnapshot(page);
    expect(snap.player.grounded).toBe(true);
    expect(snap.player.vy).toBe(0);
    expect(Math.abs(snap.player.y - snap.checkpoints[0].y)).toBeLessThan(0.08);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F10-02: midair horizontal steering (AirControl) accelerates player laterally after vertical Space jump', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const s0 = await getSnapshot(page);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');

    await holdKeysAndAdvance(page, ['KeyD'], 0.38);
    await advanceTime(page, 0.2);
    const s1 = await getSnapshot(page);
    expect(s1.player.x - s0.player.x).toBeGreaterThan(2.0);
    expect(s1.player.grounded).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F10-03: step-up tolerance (<= 0.60 studs) steps smoothly onto raised hub on Section 9 drum without jumping', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 8);

    // Wait until sec9_sweep1 (omega = 1.30) will point West (cos(theta) < -0.85) upon landing + hub step-up (~1.1s ahead)
    for (let w = 0; w < 100; w++) {
      const tPred = getCourseElapsed(page) + 1.1;
      if (Math.cos(1.3 * tPred) < -0.88) break;
      await advanceTime(page, 3 / 60);
    }

    // Jump onto East outer deck of sec9_drum1 at (29.2, 20.50, -79.8)
    const targetDeckX = 29.2;
    const targetDeckZ = -79.8;
    const snapAtCp8 = await getSnapshot(page);
    await orbitCameraToYaw(
      page,
      Math.atan2(-(targetDeckX - snapAtCp8.player.x), -(targetDeckZ - snapAtCp8.player.z)),
      { currentYaw: snapAtCp8.camera.yaw }
    );
    await page.keyboard.down('KeyW');
    let jumpedToDrum = false;
    for (let i = 0; i < 65; i++) {
      const s = await getSnapshot(page);
      const dist = Math.hypot(targetDeckX - s.player.x, targetDeckZ - s.player.z);
      if (!s.player.grounded && dist < 0.9) {
        await page.keyboard.up('KeyW');
      }
      if (!jumpedToDrum && s.player.grounded && dist <= 9.8) {
        await page.keyboard.down('Space');
        await advanceTime(page, 1 / 60);
        await page.keyboard.up('Space');
        jumpedToDrum = true;
        continue;
      }
      if (jumpedToDrum && s.player.grounded && Math.abs(s.player.z - targetDeckZ) < 3.5) {
        break;
      }
      await advanceTime(page, 1 / 60);
    }
    await releaseAllGameKeys(page);

    const onDrum = await getSnapshot(page);
    expect(onDrum.player.grounded).toBe(true);
    expect(onDrum.player.y).toBeCloseTo(20.5, 1);

    // Walk West (-X) WITHOUT Space onto East rim of 0.45-stud raised central white hub (x ~27.05, z=-79.8, topY=20.95)
    await orbitCameraToYaw(page, Math.atan2(-(26.0 - onDrum.player.x), -(-79.8 - onDrum.player.z)), {
      currentYaw: onDrum.camera.yaw,
    });
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 25; i++) {
      await advanceTime(page, 1 / 60);
      const cur = await getSnapshot(page);
      if (cur.player.y > 20.85 || cur.player.x <= 27.05) {
        break;
      }
    }
    await page.keyboard.up('KeyW');

    const onHub = await getSnapshot(page);
    expect(onHub.player.grounded).toBe(true);
    expect(onHub.player.y).toBeGreaterThan(20.85);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F10-04: sliding platform carry (Section 6) carries standing player laterally with zero keys held', async ({
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
      if (jumped && s.player.grounded && s.player.y > 13.7) {
        break;
      }
      await advanceTime(page, 1 / 60);
    }
    await releaseAllGameKeys(page);
    await advanceTime(page, 0.1);

    const landed = await getSnapshot(page);
    expect(landed.player.grounded).toBe(true);
    expect(landed.player.y).toBeGreaterThan(13.7);

    // Stand completely still with zero movement keys held across 1.0s and measure peak lateral carry
    let maxCarryDx = 0;
    for (let i = 0; i < 10; i++) {
      await advanceTime(page, 0.1);
      const s = await getSnapshot(page);
      expect(s.player.grounded).toBe(true);
      maxCarryDx = Math.max(maxCarryDx, Math.abs(s.player.x - landed.player.x));
    }
    expect(maxCarryDx).toBeGreaterThan(1.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F10-05: spinning cross carry (Section 7) carries off-center standing player tangentially', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 6);

    // Wait until sec7_cross1 (omega=0.55, phase=0) arm aligns East-West at landing
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
      if (jumped && s.player.grounded && dist < 4.5) {
        break;
      }
      await advanceTime(page, 1 / 60);
    }
    await releaseAllGameKeys(page);

    const landed = await getSnapshot(page);
    expect(landed.player.grounded).toBe(true);
    expect(Math.hypot(landed.player.x - 103.0, landed.player.z - -24.8)).toBeLessThan(4.5);

    // Position ~1.4 studs off-center on the solid 1.9-stud rotating hub so tangential carry (0.55 rad/s * r) is unmistakable
    if (Math.hypot(landed.player.x - 103.0, landed.player.z - -24.8) < 1.0) {
      await holdKeysAndAdvance(page, ['KeyS'], 0.09);
      await advanceTime(page, 0.1);
    }
    const startCarry = await getSnapshot(page);
    expect(startCarry.player.grounded).toBe(true);
    expect(Math.hypot(startCarry.player.x - 103.0, startCarry.player.z - -24.8)).toBeGreaterThan(0.9);

    await advanceTime(page, 0.8);
    const endCarry = await getSnapshot(page);
    expect(endCarry.player.grounded).toBe(true);
    const moved = Math.hypot(endCarry.player.x - startCarry.player.x, endCarry.player.z - startCarry.player.z);
    expect(moved).toBeGreaterThan(0.4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F10-06: walkable 14-degree truss ramp (Section 8) climbs > +3.0 studs smoothly without jumping', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 7);

    // Traverse Section 8 diamonds (waypoints #42..#46) to sec8_truss_base (26.0, 16.0, -37.2)
    const snap0 = await getSnapshot(page);
    const baseIdx = snap0.sectionWaypoints.findIndex(
      (w) => w.section === 8 && Math.abs(w.z - -37.2) < 0.5
    );
    // Use navigateToCheckpoint(8) check: instead stop right at truss base by steering through the 5 diamond hops
    for (let idx = 42; idx <= baseIdx; idx++) {
      const wp = snap0.sectionWaypoints[idx];
      const cur = await getSnapshot(page);
      const dx = wp.x - cur.player.x;
      const dz = wp.z - cur.player.z;
      await orbitCameraToYaw(page, Math.atan2(-dx, -dz), { currentYaw: cur.camera.yaw });
      await page.keyboard.down('KeyW');
      const d = Math.hypot(dx, dz);
      await advanceTime(page, Math.max(1 / 60, (d - 7.5) / 16.0));
      await page.keyboard.down('Space');
      await advanceTime(page, 1 / 60);
      await page.keyboard.up('Space');
      await advanceTime(page, 0.54);
      await page.keyboard.up('KeyW');
    }

    const atBase = await getSnapshot(page);
    expect(atBase.player.grounded).toBe(true);
    expect(atBase.player.y).toBeCloseTo(16.0, 0);

    // Hold ONLY KeyW facing due North (yaw = 0) up the 14° truss ramp — NO Space pressed!
    await orbitCameraToYaw(page, 0, { currentYaw: atBase.camera.yaw });
    await holdKeysAndAdvance(page, ['KeyW'], 1.15);
    const atTop = await getSnapshot(page);
    expect(atTop.player.y - atBase.player.y).toBeGreaterThan(3.0);
    expect(atTop.player.grounded).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F11: Checkpoints (CP0..CP9), Void Fall & Hazard Respawn', () => {
  test('T1-F11-01: snapshot exposes 10 static checkpoint descriptors (0..9) ascending from y=0 toward Section 10', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { checkpoints } = await getSnapshot(page);
    expect(checkpoints).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(checkpoints[i].index).toBe(i);
    }
    expect(checkpoints[0].y).toBeCloseTo(0, 2);
    expect(checkpoints[9].y).toBeGreaterThan(20.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F11-02: walking off CP0 into void (y < -20) respawns player on CP0 with zeroed velocity', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyA');
    await advanceTime(page, 0.65);
    await page.keyboard.up('KeyA');
    await advanceTime(page, 1.0);

    const post = await getSnapshot(page);
    expect(post.activeCheckpoint).toBe(0);
    expect(Math.hypot(post.player.x - post.checkpoints[0].x, post.player.z - post.checkpoints[0].z)).toBeLessThan(0.2);
    expect(post.player.vx).toBe(0);
    expect(post.player.vy).toBe(0);
    expect(post.player.vz).toBe(0);
    expect(post.player.grounded).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F11-03: reaching CP1 (2·10) and walking into void respawns at CP1 (never CP0) preserving 2·10 badge', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);

    await page.keyboard.down('KeyA');
    await advanceTime(page, 0.65);
    await page.keyboard.up('KeyA');
    await advanceTime(page, 1.1);

    const post = await getSnapshot(page);
    expect(post.activeCheckpoint).toBe(1);
    expect(Math.hypot(post.player.x - post.checkpoints[1].x, post.player.z - post.checkpoints[1].z)).toBeLessThan(0.2);
    await expectBadgeLevel(page, 2);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F11-04: stepping onto Section 3 crimson hazard tile respawns immediately at CP2 (3·10) with zeroed velocity', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 2);
    await expectBadgeLevel(page, 3);

    // Jump from CP2 (0, 11.5, -125.8) onto sec3_c1_R crimson hazard tile at (10.25, 11.55, -122.8)
    const cp2 = (await getSnapshot(page)).checkpoints[2];
    const { respawned, snapshot: post } = await triggerHazardRespawnAt(page, 10.25, -122.8, { jump: true });

    expect(respawned).toBe(true);
    expect(post.activeCheckpoint).toBe(2);
    expect(Math.hypot(post.player.x - cp2.x, post.player.z - cp2.z)).toBeLessThan(0.15);
    expect(post.player.vx).toBe(0);
    expect(post.player.vy).toBe(0);
    expect(post.player.vz).toBe(0);
    await expectBadgeLevel(page, 3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F11-05: walking into Section 5 raised red hurdle without jumping triggers respawn at CP4 (5·10)', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 4);
    await expectBadgeLevel(page, 5);

    const cp4 = (await getSnapshot(page)).checkpoints[4];
    // Hop across entry gap from CP4 onto Section 5 fork_in (118.5, 13.5, -116.8)
    await orbitCameraToYaw(page, Math.PI);
    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.28);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.48);
    await page.keyboard.up('KeyW');

    const onBeamEntry = await getSnapshot(page);
    expect(onBeamEntry.player.z).toBeGreaterThan(-118.0);

    // Walk South (+Z) WITHOUT jumping straight into sec5_hurdle1 (118.5, 14.0, -102.5)
    const { respawned, snapshot: post } = await triggerHazardRespawnAt(page, 118.5, -102.5, { jump: false });

    expect(respawned).toBe(true);
    expect(post.activeCheckpoint).toBe(4);
    expect(Math.hypot(post.player.x - cp4.x, post.player.z - cp4.z)).toBeLessThan(0.15);
    await expectBadgeLevel(page, 5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F11-06: jumping cleanly over Section 5 red hurdles clears hazards with 0 respawns and reaches CP5 (6·10)', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 4);
    const res = await navigateToCheckpoint(page, 5, { allowRespawn: false });
    expect(res.reached).toBe(true);
    expect(res.respawns).toBe(0);
    await expectBadgeLevel(page, 6);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F12: Rigged Snowball 3D Elf & Contact Blob Shadow', () => {
  test('T1-F12-01: VFS loads elf-animated.gltf, elf-animated.bin, and elf-tidy.png with 200 OK', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const urls = monitors.localAssetLoads.map((a) => a.url);
    expect(urls.some((u) => u.includes('elf-animated.gltf'))).toBe(true);
    expect(urls.some((u) => u.includes('elf-animated.bin'))).toBe(true);
    expect(urls.some((u) => u.includes('elf-tidy.png'))).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F12-02: standing still on CP0 reports grounded idle animState with zero missing-clip warnings', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const snap = await getSnapshot(page);
    expect(snap.player.grounded).toBe(true);
    expect(snap.player.animState).toBe('idle');
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F12-03: holding KeyD transitions avatar to run animState and rotates facingYaw toward East (-PI/2)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyD');
    await advanceTime(page, 0.25);
    const running = await getSnapshot(page);
    await page.keyboard.up('KeyD');

    expect(running.player.animState).toBe('run');
    expect(Math.abs(shortestAngle(running.player.facingYaw, -Math.PI / 2))).toBeLessThan(0.15);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F12-04: pressing Space transitions avatar to airborne jump pose and returns to idle upon landing', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('Space');
    await advanceTime(page, 0.15);
    await page.keyboard.up('Space');

    const midair = await getSnapshot(page);
    expect(midair.player.grounded).toBe(false);
    expect(midair.player.animState).toMatch(/jump|air/i);

    await advanceTime(page, 0.55);
    const landed = await getSnapshot(page);
    expect(landed.player.grounded).toBe(true);
    expect(landed.player.animState).toBe('idle');
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F12-05: reaching Section 10 Finish Goal transitions avatar into celebrate state', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    const res = await navigateCourseToGoal(page);
    expect(res.snapshot.completed).toBe(true);
    expect(res.snapshot.player.animState).toBe('celebrate');
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F13: 10-Section Winding Colorful Course & Snowball/Snowbox Props', () => {
  test('T1-F13-01: course geometry spans all 10 sections and climbs >= 22 studs vertically', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const snap = await getSnapshot(page);
    const sections = new Set(snap.sectionWaypoints.map((w) => w.section));
    expect([...sections].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(snap.finishGoal.y - snap.checkpoints[0].y).toBeGreaterThanOrEqual(22.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F13-02: course follows compact winding serpentine layout across both X and Z axes within 200x200 studs', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { checkpoints } = await getSnapshot(page);
    const xs = checkpoints.map((c) => c.x);
    const zs = checkpoints.map((c) => c.z);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanZ = Math.max(...zs) - Math.min(...zs);
    expect(spanX).toBeGreaterThan(80.0);
    expect(spanX).toBeLessThanOrEqual(200.0);
    expect(spanZ).toBeGreaterThan(80.0);
    expect(spanZ).toBeLessThanOrEqual(200.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F13-03: WebGL framebuffer renders multi-colored 3D scene with glError === 0 and non-zero dimensions', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await sampleWebGLFrame(page);
    expect(frame.glError).toBe(0);
    expect(frame.width).toBeGreaterThan(300);
    expect(frame.height).toBeGreaterThan(200);
    expect(frame.nonTransparentRatio).toBe(1);
    expect(frame.distinctColors).toBeGreaterThanOrEqual(4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F13-04: orbiting camera 90 and 180 degrees changes rendered WebGL pixel color distribution', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f0 = await sampleWebGLFrame(page);
    await orbitCameraToYaw(page, Math.PI / 2, { settleSec: 0.1 });
    const f90 = await sampleWebGLFrame(page);
    await orbitCameraToYaw(page, Math.PI, { settleSec: 0.1 });
    const f180 = await sampleWebGLFrame(page);

    expect(f90.signature).not.toBe(f0.signature);
    expect(f180.signature).not.toBe(f0.signature);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F13-05: local 3D Snowbox OBJ prop assets load 200 OK from local VFS with zero external CDN requests', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const objUrls = monitors.localAssetLoads.filter((a) => a.url.endsWith('.obj'));
    expect(objUrls.length).toBeGreaterThanOrEqual(5);
    expect(monitors.externalSceneAssetRequests).toEqual([]);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F14: Strict Zero Touch Controls Prohibition', () => {
  test('T1-F14-01: zero virtual thumbstick, joystick, D-pad, or touch overlay elements exist in scene DOM', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const count = await f.evaluate(
      () =>
        document.querySelectorAll(
          '[class*="touch" i],[class*="thumb" i],[class*="joy" i],[class*="dpad" i],[id*="touch" i],[id*="joy" i]'
        ).length
    );
    expect(count).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F14-02: zero on-screen jump buttons (button, [id*="jump"], [role="button"]) exist in scene DOM', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const count = await f.evaluate(
      () => document.querySelectorAll('button,[id*="jump" i],[role="button"]').length
    );
    expect(count).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F14-03: pre-boot addEventListener spy confirms zero touchstart/touchmove/touchend/touchcancel listeners', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const touchEvents = await f.evaluate(() =>
      (window.__E2E_REGISTERED_EVENTS__ || []).filter((e) => /^touch/i.test(e.type))
    );
    expect(touchEvents).toEqual([]);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F14-04: static source scan of static/scenes/jollyobby/ confirms zero OrbitControls or touch* bindings', async () => {
    const jsFiles = listRelativeFiles(SCENE_DIR).filter((rel) => /\.(js|html|css)$/i.test(rel) && !rel.startsWith('test/'));
    expect(jsFiles.length).toBeGreaterThanOrEqual(10);
    for (const rel of jsFiles) {
      const src = fs.readFileSync(path.join(SCENE_DIR, rel), 'utf8');
      expect(src, `${rel} must not import OrbitControls`).not.toMatch(/OrbitControls/);
      expect(src, `${rel} must not bind touch events`).not.toMatch(
        /\b(touchstart|touchmove|touchend|touchcancel|ontouchstart|ontouchmove|ontouchend)\b/
      );
    }
  });

  test('T1-F14-05: dispatching touch PointerEvents inside canvas produces zero player movement, jump, or camera orbit', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = await getSnapshot(page);
    const f = await jollyobby.contentFrame(page);
    await f.evaluate(() => {
      const canvas = document.querySelector('#module-jollyobby canvas');
      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          pointerType: 'touch',
          clientX: 300,
          clientY: 300,
          bubbles: true,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'touch',
          clientX: 480,
          clientY: 220,
          bubbles: true,
        })
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 1,
          pointerType: 'touch',
          clientX: 480,
          clientY: 220,
          bubbles: true,
        })
      );
    });
    await advanceTime(page, 0.25);
    const after = await getSnapshot(page);
    expect(after.player.x).toBeCloseTo(before.player.x, 5);
    expect(after.player.y).toBeCloseTo(before.player.y, 5);
    expect(after.player.z).toBeCloseTo(before.player.z, 5);
    expect(after.camera.yaw).toBeCloseTo(before.camera.yaw, 5);
    expect(after.camera.pitch).toBeCloseTo(before.camera.pitch, 5);
    assertZeroRuntimeErrors(monitors);
  });
});

test.describe('Tier 1 — F15: Strict Zero In-Scene UI/HUD & Zero Text Prohibition', () => {
  test('T1-F15-01: #module-jollyobby contains strictly 1 child (<canvas>) and zero HUD/score/banner elements', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F15-02: document.body.innerText is empty and TreeWalker finds zero non-whitespace text nodes', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const textCheck = await f.evaluate(() => {
      const nodes = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n = w.nextNode();
      while (n) {
        const tag = n.parentElement ? n.parentElement.tagName : '';
        if (tag !== 'SCRIPT' && tag !== 'STYLE' && (n.nodeValue || '').trim()) {
          nodes.push(n.nodeValue.trim());
        }
        n = w.nextNode();
      }
      return { innerText: document.body.innerText.trim(), nodes };
    });
    expect(textCheck.innerText).toBe('');
    expect(textCheck.nodes).toEqual([]);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F15-03: computed styles (::before and ::after) on every iframe element contain zero text content', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const violations = await f.evaluate(() => {
      const out = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        for (const p of ['::before', '::after']) {
          const c = getComputedStyle(el, p).content;
          if (c && c !== 'none' && c !== 'normal' && c !== '""' && c !== "''") {
            out.push(`${el.tagName}${p}:${c}`);
          }
        }
      }
      return out;
    });
    expect(violations).toEqual([]);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F15-04: CanvasRenderingContext2D spy confirms zero fillText or strokeText calls during preload and gameplay', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await holdKeysAndAdvance(page, ['KeyW'], 0.25);
    const f = await jollyobby.contentFrame(page);
    const calls = await f.evaluate(() => window.__E2E_CANVAS_TEXT_CALLS__ || []);
    expect(calls).toEqual([]);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F15-05: static source scan confirms zero TextGeometry, FontLoader, troika-three-text, levelup.js, scoreboard.js, tutorialQueue, or unsafe innerHTML', async () => {
    const jsFiles = listRelativeFiles(SCENE_DIR).filter(
      (rel) => /\.(js|html|css)$/i.test(rel) && !rel.startsWith('test/')
    );
    for (const rel of jsFiles) {
      const src = fs.readFileSync(path.join(SCENE_DIR, rel), 'utf8');
      expect(src, `${rel} must contain zero 3D/HUD text libraries`).not.toMatch(
        /\b(TextGeometry|FontLoader|troika-three-text|levelup\.js|scoreboard\.js|tutorialQueue)\b/
      );
      expect(src, `${rel} must contain zero unsafe HTML sinks`).not.toMatch(
        /\.(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\b/
      );
    }
  });
});

test.describe('Tier 1 — F16: Deterministic Test Bridge, Integrity & Zero Errors', () => {
  test('T1-F16-01: under __MANUAL_TIME__=true, waiting 400ms wall-clock without advanceTime leaves simulation frozen', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.keyboard.down('KeyW');
    const s0 = await getSnapshot(page);
    await page.waitForTimeout(400);
    const s1 = await getSnapshot(page);
    await page.keyboard.up('KeyW');

    expect(s1.player.x).toBe(s0.player.x);
    expect(s1.player.y).toBe(s0.player.y);
    expect(s1.player.z).toBe(s0.player.z);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F16-02: two independent runs with identical inputs + DEFAULT_SEED yield identical player coordinates', async ({
    browser,
    baseURL,
  }) => {
    const runSequence = async () => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      try {
        const monitors = await loadJollyObby(p, baseURL);
        await holdKeysAndAdvance(p, ['KeyW'], 0.25);
        await p.keyboard.down('KeyD');
        await p.keyboard.down('Space');
        await advanceTime(p, 1 / 60);
        await p.keyboard.up('Space');
        await advanceTime(p, 0.35);
        await p.keyboard.up('KeyD');
        const snap = await getSnapshot(p);
        assertZeroRuntimeErrors(monitors);
        return snap.player;
      } finally {
        await ctx.close();
      }
    };

    const r1 = await runSequence();
    const r2 = await runSequence();
    expect(Math.abs(r1.x - r2.x)).toBeLessThan(1e-6);
    expect(Math.abs(r1.y - r2.y)).toBeLessThan(1e-6);
    expect(Math.abs(r1.z - r2.z)).toBeLessThan(1e-6);
  });

  test('T1-F16-03: window.__TEST_CONTROL__ exposes strictly {isReady, advanceTime, getSnapshot} with zero cheat mutators', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const inspection = await f.evaluate(() => {
      const tc = window.__TEST_CONTROL__;
      return {
        keys: Object.keys(tc).sort(),
        frozen: Object.isFrozen(tc),
        cheats: ['setLevel', 'teleport', 'skip', 'win', 'complete', 'gameover'].filter(
          (k) => k in tc
        ),
      };
    });
    expect(inspection.keys).toEqual(['advanceTime', 'getSnapshot', 'isReady']);
    expect(inspection.frozen).toBe(true);
    expect(inspection.cheats).toEqual([]);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F16-04: getSnapshot() returns deep-frozen read-only copy unaffected by caller mutation attempts', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const f = await jollyobby.contentFrame(page);
    const tamperResult = await f.evaluate(() => {
      const snap1 = window.__TEST_CONTROL__.getSnapshot();
      try {
        snap1.currentSection = 99;
      } catch (_) {}
      try {
        snap1.player.x = 9999;
      } catch (_) {}
      try {
        snap1.completed = true;
      } catch (_) {}
      const snap2 = window.__TEST_CONTROL__.getSnapshot();
      return {
        isFrozenRoot: Object.isFrozen(snap1),
        isFrozenPlayer: Object.isFrozen(snap1.player),
        currentSection: snap2.currentSection,
        playerX: snap2.player.x,
        completed: snap2.completed,
      };
    });
    expect(tamperResult.isFrozenRoot).toBe(true);
    expect(tamperResult.isFrozenPlayer).toBe(true);
    expect(tamperResult.currentSection).toBe(1);
    expect(tamperResult.playerX).toBe(0);
    expect(tamperResult.completed).toBe(false);
    assertZeroRuntimeErrors(monitors);
  });

  test('T1-F16-05: boot, movement, jump, orbit, zoom, checkpoint, respawn, pause/resume, and restart complete with zero errors', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await orbitCameraByDrag(page, 90, 20);
    await zoomCameraByWheel(page, -150, 0.2);
    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);

    // Trigger void respawn back to CP1
    await page.keyboard.down('KeyA');
    await advanceTime(page, 0.65);
    await page.keyboard.up('KeyA');
    await advanceTime(page, 1.05);

    await clickChromePauseOrPlay(page);
    await clickOverlayPlay(page);
    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);
    await expectBadgeLevel(page, 1);
    assertZeroRuntimeErrors(monitors);
  });
});
