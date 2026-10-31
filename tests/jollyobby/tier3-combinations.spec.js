const { test, expect } = require('@playwright/test');
const {
  jollyobby,
  expectGameOverOverlay,
  loadJollyObby,
  assertZeroRuntimeErrors,
  advanceTime,
  getCourseElapsed,
  getSnapshot,
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
  assertZeroUiTextAndTouch,
  navigateToCheckpoint,
  navigateCourseToGoal,
} = require('./helpers');

test.describe('Tier 3 — Cross-Feature Pairwise & Multi-Feature Combinations (F1–F16)', () => {
  test('T3-01 (F8 x F6): orbiting camera yaw +90 deg via mouse drag rotates WASD forward basis to move along -X instead of -Z', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await orbitCameraToYaw(page, Math.PI / 2, { settleSec: 0.1 });
    const afterOrbit = await getSnapshot(page);
    expect(Math.abs(shortestAngle(afterOrbit.camera.yaw, Math.PI / 2))).toBeLessThan(0.05);

    await holdKeysAndAdvance(page, ['KeyW'], 0.25);
    const moved = await getSnapshot(page);
    expect(moved.player.x).toBeLessThan(-3.2);
    expect(Math.abs(moved.player.z)).toBeLessThan(0.4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-02 (F8 x F6): orbiting camera yaw 180 deg via mouse drag reverses ArrowUp (+Z) and ArrowRight (-X) movement basis', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await orbitCameraToYaw(page, Math.PI, { settleSec: 0.1 });

    await holdKeysAndAdvance(page, ['ArrowUp'], 0.25);
    const afterUp = await getSnapshot(page);
    expect(afterUp.player.z).toBeGreaterThan(2.5);

    await advanceTime(page, 0.1);
    await holdKeysAndAdvance(page, ['ArrowRight'], 0.25);
    const afterRight = await getSnapshot(page);
    expect(afterRight.player.x).toBeLessThan(-2.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-03 (F6 x F7 x F12): diagonal WASD + Space jump normalizes air speed, aligns 45 deg facingYaw, enters jump pose, and lands into run', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await advanceTime(page, 0.08);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.16);

    const midAir = await getSnapshot(page);
    expect(midAir.player.grounded).toBe(false);
    expect(midAir.player.animState).toBe('jump');
    expect(Math.hypot(midAir.player.vx, midAir.player.vz)).toBeLessThanOrEqual(16.08);
    expect(Math.abs(shortestAngle(midAir.player.facingYaw, -Math.PI / 4))).toBeLessThan(0.2);

    // Release movement keys before CP0 corner edge so player lands back on CP0, then press KeyW to verify run transition
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await advanceTime(page, 0.42);
    await page.keyboard.down('KeyS');
    await advanceTime(page, 0.12);
    const landedRun = await getSnapshot(page);
    await page.keyboard.up('KeyS');

    expect(landedRun.player.grounded).toBe(true);
    expect(landedRun.player.animState).toBe('run');
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-04 (F8 x F9): interleaved diagonal mouse orbit and scroll-wheel zoom update yaw, pitch, and distance within clamps', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const before = await getSnapshot(page);

    await orbitCameraByDrag(page, 140, 70, { settleSec: 0.1 });
    await zoomCameraByWheel(page, -400, 0.3);
    const mid = await getSnapshot(page);
    expect(mid.camera.yaw).toBeLessThan(before.camera.yaw - 0.5);
    expect(mid.camera.pitch).toBeGreaterThan(before.camera.pitch + 0.25);
    expect(mid.camera.distance).toBeLessThan(before.camera.distance - 2.0);

    await orbitCameraByDrag(page, -80, -110, { settleSec: 0.1 });
    await zoomCameraByWheel(page, 800, 0.4);
    const end = await getSnapshot(page);
    expect(end.camera.distance).toBeGreaterThan(mid.camera.distance + 4.0);
    expect(end.camera.distance).toBeLessThanOrEqual(45.0);
    expect(end.camera.pitch).toBeGreaterThanOrEqual((-15 * Math.PI) / 180 - 1e-3);
    expect(end.camera.pitch).toBeLessThanOrEqual((80 * Math.PI) / 180 + 1e-3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-05 (F6 x F8 x F9): orbiting camera +45 deg and zooming in while running curves player trajectory smoothly along live heading', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await holdKeysAndAdvance(page, ['KeyW'], 0.16);
    const leg1 = await getSnapshot(page);
    expect(Math.abs(leg1.player.x)).toBeLessThan(0.1);
    expect(leg1.player.z).toBeLessThan(-1.5);

    await orbitCameraToYaw(page, Math.PI / 4, { settleSec: 0.05 });
    await zoomCameraByWheel(page, -300, 0.2);
    const beforeLeg2 = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['KeyW'], 0.22);
    const leg2 = await getSnapshot(page);

    expect(leg2.player.x).toBeLessThan(-1.6);
    expect(leg2.player.z).toBeLessThan(beforeLeg2.player.z - 1.6);
    expect(leg2.camera.distance).toBeLessThan(15.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-06 (F10 x F6 x F7 x F13): navigating Section 6 rides lateral sliding gift-box carry and jumps cleanly across all 3 moving pads to CP6', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    const res = await navigateToCheckpoint(page, 6, { allowRespawn: false });
    expect(res.reached).toBe(true);
    expect(res.respawns).toBe(0);
    await expectBadgeLevel(page, 7);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-07 (F10 x F7 x F13): navigating Section 7 lands on spinning windmill crosses, rides rotation, and jumps cleanly to CP7', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    const res = await navigateToCheckpoint(page, 7, { allowRespawn: false });
    expect(res.reached).toBe(true);
    expect(res.respawns).toBe(0);
    await expectBadgeLevel(page, 8);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-08 (F10 x F8): standing on a Section 7 spinning cross carries player tangentially while camera yaw remains strictly mouse-controlled', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 6);

    // Align sec7_cross1 East-West arm phase and jump onto hub (103.0, 15.0, -24.8)
    for (let w = 0; w < 120; w++) {
      const tPred = getCourseElapsed(page) + 0.52;
      if (Math.abs(Math.sin(0.9 * tPred)) < 0.25) break;
      await advanceTime(page, 0.05);
    }
    await orbitCameraToYaw(page, Math.PI / 2);
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 60; i++) {
      const s = await getSnapshot(page);
      const dist = Math.hypot(103.0 - s.player.x, -24.8 - s.player.z);
      if (s.player.grounded && dist <= 10.2) {
        await page.keyboard.down('Space');
        await advanceTime(page, 1 / 60);
        await page.keyboard.up('Space');
        await advanceTime(page, 0.34);
        await page.keyboard.up('KeyW');
        await advanceTime(page, 0.28);
        break;
      }
      await advanceTime(page, 1 / 60);
    }
    await releaseAllGameKeys(page);

    // Orbit camera to explicit yaw 0.25 and advance 0.4s with zero mouse drag; camera.yaw must stay 0.25 while player rotates on cross
    await orbitCameraToYaw(page, 0.25);
    const s0 = await getSnapshot(page);
    expect(s0.player.grounded).toBe(true);
    expect(Math.abs(s0.player.x - 103.0)).toBeLessThan(4.5);
    await advanceTime(page, 0.4);
    const s1 = await getSnapshot(page);

    expect(s1.player.grounded).toBe(true);
    expect(s1.camera.yaw).toBeCloseTo(s0.camera.yaw, 4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-09 (F11 x F3 x F8): reaching CP2 (90 deg East turn), orbiting camera away, and falling into void respawns at CP2 (3·10) facing East', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 2);
    await expectBadgeLevel(page, 3);

    // Orbit camera away from East (-PI/2) to North (0), then walk West off CP2 into void
    await orbitCameraToYaw(page, 0);
    await holdKeysAndAdvance(page, ['KeyA'], 0.8);
    await advanceTime(page, 2.2);

    const snap = await getSnapshot(page);
    expect(snap.activeCheckpoint).toBe(2);
    expect(snap.player.grounded).toBe(true);
    expect(Math.abs(shortestAngle(snap.camera.yaw, -Math.PI / 2))).toBeLessThan(0.05);
    expect(Math.abs(shortestAngle(snap.player.facingYaw, -Math.PI / 2))).toBeLessThan(0.05);
    await expectBadgeLevel(page, 3);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-10 (F9 x F14): mouse wheel zoom works before and after rejected multi-touch pinch gestures', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await zoomCameraByWheel(page, -400, 0.4);
    const zoomedIn = await getSnapshot(page);
    expect(zoomedIn.camera.distance).toBeLessThan(12.5);

    const f = await jollyobby.contentFrame(page);
    await f.evaluate(() => {
      const canvas = document.querySelector('#module-jollyobby canvas');
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 11, pointerType: 'touch', clientX: 300, clientY: 360 }));
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 12, pointerType: 'touch', clientX: 500, clientY: 360 }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, pointerType: 'touch', clientX: 100, clientY: 360 }));
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 12, pointerType: 'touch', clientX: 700, clientY: 360 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 11, pointerType: 'touch', clientX: 100, clientY: 360 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 12, pointerType: 'touch', clientX: 700, clientY: 360 }));
    });
    await advanceTime(page, 0.25);
    const afterPinch = await getSnapshot(page);
    expect(afterPinch.camera.distance).toBeCloseTo(zoomedIn.camera.distance, 4);

    await zoomCameraByWheel(page, 900, 0.5);
    const zoomedOut = await getSnapshot(page);
    expect(zoomedOut.camera.distance).toBeGreaterThan(22.0);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-11 (F5 x F7 x F16): pausing mid-jump at apex freezes height across advanceTime, and resuming lands cleanly on CP0', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.25);

    const atApex = await clickChromePauseOrPlay(page);
    expect(atApex.paused).toBe(true);
    expect(atApex.player.grounded).toBe(false);
    expect(atApex.player.y).toBeGreaterThan(6.0);

    await advanceTime(page, 1.5);
    const stillAtApex = await getSnapshot(page);
    expect(stillAtApex.player.y).toBeCloseTo(atApex.player.y, 5);

    await clickOverlayPlay(page);
    await advanceTime(page, 0.35);
    const landed = await getSnapshot(page);
    expect(landed.player.grounded).toBe(true);
    expect(Math.abs(landed.player.y)).toBeLessThan(0.05);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-12 (F11 x F5 x F3): reaching CP2 (3·10), pausing via <santa-chrome>, and clicking #playagainButton resets to CP0 and 1·10', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 2);
    await expectBadgeLevel(page, 3);

    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);

    const reset = await getSnapshot(page);
    expect(reset.activeCheckpoint).toBe(0);
    expect(reset.currentSection).toBe(1);
    expect(Math.hypot(reset.player.x, reset.player.z)).toBeLessThan(0.05);
    await expectBadgeLevel(page, 1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-13 (F5 x F10): pausing while riding a Section 6 moving gift pad and resuming preserves grounded platform carry without void fall', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 5);

    // Align sec6_gift1 (118.5 + 3.2 sin(1.35t), 13.9, -57.8) near center and jump onto it
    for (let w = 0; w < 120; w++) {
      const tPred = getCourseElapsed(page) + 0.55;
      if (Math.abs(Math.sin(1.35 * tPred)) < 0.25) break;
      await advanceTime(page, 0.05);
    }
    const s0 = await getSnapshot(page);
    await orbitCameraToYaw(page, Math.atan2(-(118.5 - s0.player.x), -(-57.8 - s0.player.z)), {
      currentYaw: s0.camera.yaw,
    });
    await page.keyboard.down('KeyW');
    for (let i = 0; i < 60; i++) {
      const s = await getSnapshot(page);
      const dist = Math.hypot(118.5 - s.player.x, -57.8 - s.player.z);
      if (s.player.grounded && dist <= 9.2) {
        await page.keyboard.down('Space');
        await advanceTime(page, 1 / 60);
        await page.keyboard.up('Space');
        await advanceTime(page, 0.34);
        await page.keyboard.up('KeyW');
        await advanceTime(page, 0.25);
        break;
      }
      await advanceTime(page, 1 / 60);
    }
    await releaseAllGameKeys(page);
    const check = await getSnapshot(page);
    expect(check.player.grounded).toBe(true);
    expect(Math.abs(check.player.y - 13.9)).toBeLessThan(0.3);

    const pausedOnGift = await clickChromePauseOrPlay(page);
    expect(pausedOnGift.paused).toBe(true);
    await advanceTime(page, 0.8);
    expect((await getSnapshot(page)).player.x).toBeCloseTo(pausedOnGift.player.x, 5);

    await clickOverlayPlay(page);
    let maxCarryDx = 0;
    let resumedOnGift = pausedOnGift;
    for (let i = 0; i < 48; i++) {
      await advanceTime(page, 1 / 60);
      resumedOnGift = await getSnapshot(page);
      maxCarryDx = Math.max(maxCarryDx, Math.abs(resumedOnGift.player.x - pausedOnGift.player.x));
    }
    expect(resumedOnGift.player.grounded).toBe(true);
    expect(resumedOnGift.player.y).toBeCloseTo(13.9, 1);
    expect(maxCarryDx).toBeGreaterThan(0.8);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-14 (F4 x F8 x F9 x F12): Section 10 completion sets celebrate pose, disables santa-gameloader pointer pass-through, and locks elf on Summit Dais', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);

    await expect(page.locator('santa-gameloader')).toHaveAttribute('disabled', '');
    const atWin = await getSnapshot(page);
    expect(atWin.completed).toBe(true);
    expect(atWin.player.animState).toBe('celebrate');

    await holdKeysAndAdvance(page, ['KeyW', 'KeyD', 'Space'], 1.5);
    const afterKeys = await getSnapshot(page);
    expect(afterKeys.player.x).toBeCloseTo(atWin.player.x, 4);
    expect(afterKeys.player.z).toBeCloseTo(atWin.player.z, 4);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-15 (F11 x F15 x F3): hitting Section 3 crimson hazard from CP2 respawns at CP2 (3·10) with zero in-scene UI/text during particle burst', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 2);
    await expectBadgeLevel(page, 3);

    const hit = await triggerHazardRespawnAt(page, 10.25, -122.8, { jump: true });
    expect(hit.respawned).toBe(true);
    expect(hit.snapshot.activeCheckpoint).toBe(2);
    await expectBadgeLevel(page, 3);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-16 (F4 x F15): Section 10 completion renders <santa-overlay> strictly in host frame while #module-jollyobby passes zero UI/text audit', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-17 (F5 x F4): toggling <santa-chrome> mute active across CP1 and Section 10 completion, unmuting, and restarting produces zero errors', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(150000);
    const monitors = await loadJollyObby(page, baseURL);
    const initialMuted = await page.evaluate(() => Boolean(document.querySelector('santa-chrome').muted));
    if (!initialMuted) {
      await clickChromeMuteToggle(page);
    }
    expect(await page.evaluate(() => Boolean(document.querySelector('santa-chrome').muted))).toBe(true);

    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);
    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);

    await clickChromeMuteToggle(page);
    await clickOverlayPlayAgain(page);
    await expectBadgeLevel(page, 1);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-18 (F2 x F14 x F13): resizing 1440x900 -> 900x700 -> 1280x800 with orbit, zoom, and Section 1 gameplay passes zero-touch/UI audit', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await page.setViewportSize({ width: 1440, height: 900 });
    await orbitCameraByDrag(page, 50, 20);
    await page.setViewportSize({ width: 900, height: 700 });
    await zoomCameraByWheel(page, -200, 0.2);
    await page.setViewportSize({ width: 1280, height: 800 });

    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-19 (F1 x F2 x F16): localized route /intl/en/jollyobby.html sets Jolly Obby title, 1·10 badge, and navigates cleanly to CP1 (2·10)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL, { routePath: '/intl/en/jollyobby.html' });
    await expect(page).toHaveTitle(/Jolly Obby/);
    await expectBadgeLevel(page, 1);

    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-20 (F11 x F14 x F15): triggering both void wipeout and crimson hazard wipeout in one session preserves zero touch & zero canvas text', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await navigateToCheckpoint(page, 2);

    // Void wipeout
    await holdKeysAndAdvance(page, ['KeyA'], 0.8);
    await advanceTime(page, 2.2);
    expect((await getSnapshot(page)).activeCheckpoint).toBe(2);

    // Crimson hazard wipeout on sec3_c1_R
    const hit = await triggerHazardRespawnAt(page, 10.25, -122.8, { jump: true });
    expect(hit.respawned).toBe(true);
    expect(hit.snapshot.activeCheckpoint).toBe(2);
    await assertZeroUiTextAndTouch(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-21 (F12 x F13 x F7): holding Space across landings chains bunny-hop jumps across Section 1 hexagons to CP1 (2·10)', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const { x, y } = await getCanvasSafeCenter(page);
    await page.mouse.click(x, y);

    // Verify continuous Space hold chains jump -> grounded -> immediate re-jump while steering from CP0 onto sec1_hex1, then reach CP1
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    let jumpTransitions = 0;
    let prevGrounded = true;
    for (let i = 0; i < 65; i++) {
      await advanceTime(page, 1 / 60);
      const s = await getSnapshot(page);
      if (prevGrounded && !s.player.grounded && s.player.vy > 30) {
        jumpTransitions += 1;
      }
      prevGrounded = s.player.grounded;
      if (jumpTransitions >= 2) break;
    }
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyW');
    expect(jumpTransitions).toBeGreaterThanOrEqual(2);

    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);
    assertZeroRuntimeErrors(monitors);
  });

  test('T3-22 (F1 x F5 x F16): post-restart deterministic seed replay parity lands at identical Section 1 coordinates on fresh load vs after restart', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL, { seed: 'replay_seed_42' });

    const runScriptedOpening = async () => {
      const { x, y } = await getCanvasSafeCenter(page);
      await page.mouse.click(x, y);
      await page.keyboard.down('KeyW');
      await advanceTime(page, 0.30, { step: 1 / 60 });
      await page.keyboard.down('Space');
      await advanceTime(page, 1 / 60);
      await page.keyboard.up('Space');
      await advanceTime(page, 0.55, { step: 1 / 60 });
      await page.keyboard.up('KeyW');
      await advanceTime(page, 0.15, { step: 1 / 60 });
      return getSnapshot(page);
    };

    const run1 = await runScriptedOpening();
    expect(run1.player.grounded).toBe(true);
    expect(run1.player.z).toBeCloseTo(-13.8, 0);

    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);

    const run2 = await runScriptedOpening();
    expect(run2.player.grounded).toBe(true);
    expect(run2.player.x).toBeCloseTo(run1.player.x, 3);
    expect(run2.player.y).toBeCloseTo(run1.player.y, 3);
    expect(run2.player.z).toBeCloseTo(run1.player.z, 3);
    assertZeroRuntimeErrors(monitors);
  });
});
