const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const {
  WORKTREE_ROOT,
  SCENE_DIR,
  jollyobby,
  expectGameOverOverlay,
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
  clickOverlayHome,
  sampleWebGLFrame,
  assertZeroUiTextAndTouch,
  navigateToCheckpoint,
  navigateCourseToGoal,
} = require('./helpers');

test.describe('Tier 4 — Real-World End-to-End Application Scenarios', () => {
  test.setTimeout(150000);

  test('T4-01: Full Clean Golden-Path 10-Section Playthrough (CP0 -> CP1..CP9 -> FinishGoal with zero respawns)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await expectBadgeLevel(page, 1);
    await assertZeroUiTextAndTouch(page);

    const observedBadgeLevels = [1];
    const result = await navigateCourseToGoal(page, {
      keyScheme: 'WASD',
      useCameraOrbit: true,
      allowRespawn: false,
      onCheckpoint: async (cpIdx) => {
        await expectBadgeLevel(page, cpIdx + 1);
        observedBadgeLevels.push(cpIdx + 1);
      },
    });

    expect(result.reached).toBe(true);
    expect(result.respawns).toBe(0);
    expect(observedBadgeLevels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.snapshot.completed).toBe(true);
    expect(result.snapshot.currentSection).toBe(10);
    expect(result.snapshot.player.animState).toBe('celebrate');

    await expectBadgeLevel(page, 10);
    await expectGameOverOverlay(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T4-02: Resilient Wipeout & Checkpoint Recovery Playthrough (CP3 Hazard + CP6 Void + CP8 Sweeper -> Victory)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    // 1. Navigate to CP3 (4·10, start of Section 4) and hit Section 3 col 5 crimson hazard sec3_c5_L (34.25, 11.05, -128.8)
    await navigateToCheckpoint(page, 3);
    await expectBadgeLevel(page, 4);
    const cp3Haz = await triggerHazardRespawnAt(page, 34.25, -128.8, { jump: true });
    expect(cp3Haz.respawned).toBe(true);
    expect(cp3Haz.snapshot.activeCheckpoint).toBe(3);
    expect(cp3Haz.snapshot.currentSection).toBe(4);
    await expectBadgeLevel(page, 4);

    // 2. Navigate to CP6 (7·10) and walk off East into the void
    await navigateToCheckpoint(page, 6);
    await expectBadgeLevel(page, 7);
    await orbitCameraToYaw(page, -Math.PI / 2);
    await holdKeysAndAdvance(page, ['KeyW'], 0.8);
    await advanceTime(page, 2.4);
    const afterCp6Void = await getSnapshot(page);
    expect(afterCp6Void.activeCheckpoint).toBe(6);
    expect(afterCp6Void.currentSection).toBe(7);
    await expectBadgeLevel(page, 7);

    // 3. Navigate to CP8 (9·10), phase-align landing on Section 9 Drum 1 East side, then let sweeper arm trigger respawn at CP8
    await navigateToCheckpoint(page, 8);
    await expectBadgeLevel(page, 9);
    for (let w = 0; w < 120; w++) {
      const tPred = getCourseElapsed(page) + 0.55;
      if (Math.cos(1.3 * tPred) < -0.75) break;
      await advanceTime(page, 0.05);
    }
    const s0 = await getSnapshot(page);
    await orbitCameraToYaw(page, Math.atan2(-(28.5 - s0.player.x), -(-79.8 - s0.player.z)), {
      currentYaw: s0.camera.yaw,
    });
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 60; i++) {
      const s = await getSnapshot(page);
      if (s.player.grounded && Math.hypot(28.5 - s.player.x, -79.8 - s.player.z) <= 10.2) {
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
    const checkOnDrum = await getSnapshot(page);
    expect(checkOnDrum.player.grounded).toBe(true);
    expect(Math.abs(checkOnDrum.player.z - -79.8)).toBeLessThan(4.5);

    // Stand still up to 5.2s until sweeper arm hits player and respawns at CP8 (26.0, 20.0, -64.8)
    let sweptBackToCp8 = false;
    for (let i = 0; i < 320; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (Math.hypot(s.player.x - 26.0, s.player.z - -64.8) < 0.5) {
        sweptBackToCp8 = true;
        break;
      }
    }
    expect(sweptBackToCp8).toBe(true);
    await expectBadgeLevel(page, 9);

    // 4. Recover from CP8 and complete Sections 9 & 10 to Victory
    const finalRes = await navigateCourseToGoal(page);
    expect(finalRes.reached).toBe(true);
    await expectBadgeLevel(page, 10);
    await expectGameOverOverlay(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T4-03: Full Course Completion -> #playagainButton Restart -> Automatic Focus Reclaim & Immediate WASD Second Run', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);

    // Click #playagainButton WITHOUT clicking the iframe or calling iframe.focus()
    await clickOverlayPlayAgain(page);

    const resetSnap = await getSnapshot(page);
    expect(resetSnap.completed).toBe(false);
    expect(resetSnap.activeCheckpoint).toBe(0);
    expect(resetSnap.currentSection).toBe(1);
    await expectBadgeLevel(page, 1);

    // Immediately press KeyW + Space WITHOUT touching mouse to verify automatic focus restoration
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.25);
    await page.keyboard.up('KeyW');

    const immediateMove = await getSnapshot(page);
    expect(immediateMove.player.z).toBeLessThan(-3.0);
    expect(immediateMove.player.y).toBeGreaterThan(3.0);

    // Settle and complete Section 1 to CP1 (2·10) on the second run
    await advanceTime(page, 0.45);
    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);
    assertZeroRuntimeErrors(monitors);
  });

  test('T4-04: Arrow-Keys-Only + Active Mouse Orbit & Scroll-Zoom Multi-Section Run (CP0 -> CP4 across 90 deg turns)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, -350, 0.3);
    expect((await getSnapshot(page)).camera.distance).toBeLessThan(13.0);

    const levels = [1];
    const res = await navigateToCheckpoint(page, 4, {
      keyScheme: 'ARROWS',
      useCameraOrbit: true,
      allowRespawn: false,
      onCheckpoint: async (cpIdx) => {
        levels.push(cpIdx + 1);
        if (cpIdx === 2) {
          await zoomCameraByWheel(page, 700, 0.3);
        }
      },
    });

    expect(res.reached).toBe(true);
    expect(res.respawns).toBe(0);
    expect(levels).toEqual([1, 2, 3, 4, 5]);
    expect((await getSnapshot(page)).camera.distance).toBeGreaterThan(18.0);
    await expectBadgeLevel(page, 5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T4-05: Interrupted Player Session (Mid-Course Pause/Resume, Mute/Unmute, Mid-Jump Pause & Tab Blur Resilience)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    // Reach CP1 (2·10), settle grounded on CP1 pad, pause, toggle mute, resume
    await navigateToCheckpoint(page, 1);
    await advanceTime(page, 0.35);
    await expectBadgeLevel(page, 2);
    const p1 = await clickChromePauseOrPlay(page);
    expect(p1.paused).toBe(true);
    await clickChromeMuteToggle(page);
    await clickOverlayPlay(page);

    // Start vertical jump on CP1, pause mid-jump, verify frozen, resume and land cleanly
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.22);
    const midJumpPause = await clickChromePauseOrPlay(page);
    expect(midJumpPause.player.grounded).toBe(false);
    await advanceTime(page, 0.5);
    expect((await getSnapshot(page)).player.y).toBeCloseTo(midJumpPause.player.y, 5);
    await clickOverlayPlay(page);
    await advanceTime(page, 0.45);
    expect((await getSnapshot(page)).player.grounded).toBe(true);

    // Advance to CP2 (3·10), settle grounded, hold KeyW and fire iframe window blur -> player stops safely on CP2 instead of running off
    await navigateToCheckpoint(page, 2);
    await advanceTime(page, 0.35);
    await expectBadgeLevel(page, 3);
    await page.mouse.click(x, y);
    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.08);
    const f = await jollyobby.contentFrame(page);
    await f.evaluate(() => window.dispatchEvent(new Event('blur')));
    await advanceTime(page, 0.35);
    await page.keyboard.up('KeyW');
    const safeOnCp2 = await getSnapshot(page);
    expect(safeOnCp2.player.grounded).toBe(true);
    expect(Math.abs(safeOnCp2.player.vx)).toBeLessThan(0.05);

    // Continue cleanly to CP3 (4·10) and unmute
    await navigateToCheckpoint(page, 3);
    await expectBadgeLevel(page, 4);
    await clickChromeMuteToggle(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T4-06: Multi-Viewport Responsive Gameplay Journey (1920x1080 -> 1280x720 -> 1024x600 -> 800x900 across CP0..CP3)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    const stages = [
      { vp: { width: 1920, height: 1080 }, targetCp: 1 },
      { vp: { width: 1280, height: 720 }, targetCp: 2 },
      { vp: { width: 1024, height: 600 }, targetCp: 3 },
    ];

    for (const stage of stages) {
      await page.setViewportSize(stage.vp);
      await page.waitForTimeout(80);
      const frame = await sampleWebGLFrame(page);
      expect(frame.clientWidth).toBe(stage.vp.width);
      expect(frame.clientHeight).toBe(stage.vp.height);
      expect(frame.glError).toBe(0);
      expect(frame.distinctColors).toBeGreaterThanOrEqual(4);
      await assertZeroUiTextAndTouch(page);

      await navigateToCheckpoint(page, stage.targetCp);
      await expectBadgeLevel(page, stage.targetCp + 1);
    }

    await page.setViewportSize({ width: 800, height: 900 });
    await page.waitForTimeout(80);
    await orbitCameraByDrag(page, 70, 25);
    await zoomCameraByWheel(page, -200, 0.25);
    const finalFrame = await sampleWebGLFrame(page);
    expect(finalFrame.clientWidth).toBe(800);
    expect(finalFrame.clientHeight).toBe(900);
    expect(finalFrame.glError).toBe(0);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T4-07: Production Registration, Asset Hygiene, Localized Route Gameplay & Village Navigation Journey', async ({
    page,
    baseURL,
  }) => {
    // 1. Verify production registration & asset files
    const scenesJs = fs.readFileSync(path.join(WORKTREE_ROOT, 'static/src/strings/scenes.js'), 'utf8');
    expect(scenesJs).toMatch(/'jollyobby':\s*_msg`scene_jollyobby`/);
    const enSrc = JSON.parse(fs.readFileSync(path.join(WORKTREE_ROOT, 'en_src_messages.json'), 'utf8'));
    expect(enSrc.scene_jollyobby.message).toBe('Jolly Obby');
    const enMsg = JSON.parse(fs.readFileSync(path.join(WORKTREE_ROOT, '_messages/en.json'), 'utf8'));
    expect(enMsg.scene_jollyobby.message).toBe('Jolly Obby');

    expect(readPngMetadata(path.join(WORKTREE_ROOT, 'static/img/scenes/jollyobby_1x.png'))).toMatchObject({
      validSignature: true,
      width: 475,
      height: 282,
    });
    expect(readPngMetadata(path.join(WORKTREE_ROOT, 'static/img/scenes/jollyobby_2x.png'))).toMatchObject({
      validSignature: true,
      width: 950,
      height: 564,
    });
    expect(readPngMetadata(path.join(WORKTREE_ROOT, 'prod/images/og/jollyobby.png'))).toMatchObject({
      validSignature: true,
      width: 1333,
      height: 1000,
    });

    const binaryAssets = listRelativeFiles(SCENE_DIR).filter((rel) =>
      /\.(gltf|bin|obj|png|jpg|jpeg|webp|svg|mp3|ogg|wav)$/i.test(rel)
    );
    for (const rel of binaryAssets) {
      expect(rel).toMatch(/^(models|img)\//);
    }

    // 2. Load localized route, play to CP1 (2·10), pause, and click Home to navigate to Santa's Village (/)
    const monitors = await loadJollyObby(page, baseURL, { routePath: '/intl/en/jollyobby.html' });
    await expect(page).toHaveTitle(/Jolly Obby/);
    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);

    await clickChromePauseOrPlay(page);
    await clickOverlayHome(page);
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 10000 }).toMatch(/\/$/);
    expect(monitors.pageErrors).toEqual([]);
  });

  test('T4-08: Continuous End-to-End Forensic R4 & R5 Audit Across Full 10-Section Lifecycle (7 Audit Gates)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    // Gate 1: Initial boot on CP0
    await assertZeroUiTextAndTouch(page);
    expect((await sampleWebGLFrame(page)).distinctColors).toBeGreaterThanOrEqual(4);

    // Gate 2: CP2 checkpoint activation
    await navigateToCheckpoint(page, 2);
    await assertZeroUiTextAndTouch(page);
    expect((await sampleWebGLFrame(page)).glError).toBe(0);

    // Gate 3: Crimson hazard respawn
    const g3Haz = await triggerHazardRespawnAt(page, 10.25, -122.8, { jump: true });
    expect(g3Haz.respawned).toBe(true);
    await assertZeroUiTextAndTouch(page);

    // Gate 4: Pause & Resume
    await clickChromePauseOrPlay(page);
    await assertZeroUiTextAndTouch(page);
    await clickOverlayPlay(page);

    // Gate 5: CP5 (before moving gift boxes)
    await navigateToCheckpoint(page, 5);
    await assertZeroUiTextAndTouch(page);
    expect((await sampleWebGLFrame(page)).glError).toBe(0);

    // Gate 6: CP9 (10·10 Summit base)
    await navigateToCheckpoint(page, 9);
    await assertZeroUiTextAndTouch(page);
    expect((await sampleWebGLFrame(page)).glError).toBe(0);

    // Gate 7: Section 10 Finish Goal celebration + host <santa-overlay>
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);
    await assertZeroUiTextAndTouch(page);
    expect((await sampleWebGLFrame(page)).glError).toBe(0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T4-09: Negative Mutation (Input-Necessity) & Anti-Cheat Integrity Journey', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    // 1. 60.0s of passive time with zero inputs at CP0 must never advance checkpoints or trigger gameover
    await advanceTime(page, 60.0);
    const idleCp0 = await getSnapshot(page);
    expect(idleCp0.activeCheckpoint).toBe(0);
    expect(idleCp0.currentSection).toBe(1);
    expect(idleCp0.completed).toBe(false);
    await expectBadgeLevel(page, 1);
    await expect(page.locator('santa-overlay')).toHaveAttribute('hidden', '');

    // 2. Navigate to CP5 (6·10, right before moving platforms), release all keys, advance 30.0s -> stays at CP5
    await navigateToCheckpoint(page, 5);
    await releaseAllGameKeys(page);
    await advanceTime(page, 30.0);
    const idleCp5 = await getSnapshot(page);
    expect(idleCp5.activeCheckpoint).toBe(5);
    expect(idleCp5.currentSection).toBe(6);
    expect(idleCp5.completed).toBe(false);
    await expectBadgeLevel(page, 6);
    await expect(page.locator('santa-overlay')).toHaveAttribute('hidden', '');

    // 3. Verify getSnapshot() & __TEST_CONTROL__ anti-cheat immutability
    const f = await jollyobby.contentFrame(page);
    const immutability = await f.evaluate(() => {
      const keys = Object.keys(window.__TEST_CONTROL__).sort();
      const s = window.__TEST_CONTROL__.getSnapshot();
      try {
        s.completed = true;
        s.activeCheckpoint = 9;
        s.player.x = 82;
      } catch (_) {}
      const s2 = window.__TEST_CONTROL__.getSnapshot();
      return { keys, completedAfter: s2.completed, cpAfter: s2.activeCheckpoint };
    });
    expect(immutability).toEqual({
      keys: ['advanceTime', 'getSnapshot', 'isReady'],
      completedAfter: false,
      cpAfter: 5,
    });
    assertZeroRuntimeErrors(monitors);
  });

  test('T4-10: Dynamic Workshop Gauntlet (CP5 Sliders -> CP6 Spinners -> CP7 Truss Slope -> CP8 Sweepers -> CP9 Summit -> Victory + Post-Win Lock)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    await navigateToCheckpoint(page, 5, { allowRespawn: false });
    await expectBadgeLevel(page, 6);

    const gauntletCheckpoints = [];
    const res = await navigateCourseToGoal(page, {
      allowRespawn: false,
      onCheckpoint: async (cpIdx) => {
        gauntletCheckpoints.push(cpIdx);
        await expectBadgeLevel(page, cpIdx + 1);
      },
    });

    expect(res.reached).toBe(true);
    expect(res.respawns).toBe(0);
    expect(gauntletCheckpoints).toEqual([6, 7, 8, 9]);
    await expectBadgeLevel(page, 10);
    await expectGameOverOverlay(page);

    const summitPos = (await getSnapshot(page)).player;
    expect(summitPos.animState).toBe('celebrate');

    // Hold WASD + Space for 3.0s post-victory and verify elf stays locked on the Section 10 Finish Dais
    await holdKeysAndAdvance(page, ['KeyW', 'KeyA', 'KeyD', 'Space'], 3.0);
    const lockedPos = await getSnapshot(page);
    expect(lockedPos.completed).toBe(true);
    expect(lockedPos.player.animState).toBe('celebrate');
    expect(lockedPos.player.x).toBeCloseTo(summitPos.x, 4);
    expect(lockedPos.player.z).toBeCloseTo(summitPos.z, 4);
    await expectGameOverOverlay(page);
    assertZeroRuntimeErrors(monitors);
  });
});
