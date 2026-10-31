const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');
const {
  WORKTREE_ROOT,
  SCENE_DIR,
  jollyobby,
  expectGameOverOverlay,
  resolveServerUrls,
  attachRuntimeMonitors,
  loadJollyObby,
  assertZeroRuntimeErrors,
  advanceTime,
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
  sampleWebGLFrame,
  triggerHazardRespawnAt,
  clickChromePauseOrPlay,
  clickOverlayPlay,
  clickOverlayPlayAgain,
  navigateToCheckpoint,
  navigateCourseToGoal,
} = require('./helpers');

test.describe('Tier 5 — Physics, Controls, Camera, 3D Assets & Course Adversarial Hardening', () => {
  test.setTimeout(150000);

  test('T5-01: adv_audio_preload_banks_cover_all_sound_events_including_cb_win', async ({
    page,
    baseURL,
  }) => {
    const audioResponses = [];
    page.on('response', (res) => {
      const url = res.url();
      if (/\.(ogg|mp3)(\?|$)/i.test(url)) {
        audioResponses.push({ status: res.status(), url });
      }
    });

    const monitors = await loadJollyObby(page, baseURL);
    await advanceTime(page, 0.25);
    const frame = await jollyobby.contentFrame(page);

    const soundEvents = await frame.evaluate(async () => {
      const { SOUND_EVENTS } = await import('./js/constants.js');
      return {
        PRELOAD_BANKS: [...SOUND_EVENTS.PRELOAD_BANKS],
        triggers: Object.fromEntries(
          Object.entries(SOUND_EVENTS).filter(([, v]) => !Array.isArray(v))
        ),
      };
    });

    const audit = await page.evaluate((se) => {
      const cfg = window.KLANG_CONFIG;
      if (!cfg || !cfg.events || !cfg.processes || !cfg.audio || !Array.isArray(cfg.files)) {
        return { klangLoaded: false };
      }

      const invalidBanks = [];
      const loadedGroups = new Set();
      for (const bank of se.PRELOAD_BANKS) {
        const pid = cfg.events[bank];
        if (!pid || !cfg.processes[pid]) {
          invalidBanks.push(bank);
          continue;
        }
        const src = String(cfg.processes[pid].action || '');
        const match = src.match(/Klang\.load\(\[([^\]]+)\]/);
        if (match) {
          for (const raw of match[1].split(',')) {
            const g = raw.trim().replace(/^['"]|['"]$/g, '');
            if (g) loadedGroups.add(g);
          }
        }
      }

      function traceFiles(id, visited = new Set()) {
        if (!id || visited.has(id)) return [];
        visited.add(id);
        const out = [];
        const ao = cfg.audio[id];
        const proc = cfg.processes[id];
        if (ao) {
          if (ao.file_id !== undefined) {
            const f = cfg.files.find((x) => String(x.id) === String(ao.file_id));
            out.push({
              fileId: String(ao.file_id),
              loadGroup: f ? f.load_group : null,
              urlToken: f ? f.url : null,
            });
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

      const unloadedTriggers = [];
      for (const [key, eventName] of Object.entries(se.triggers)) {
        const eid = cfg.events[eventName];
        if (!eid) {
          unloadedTriggers.push({ key, eventName, reason: 'missing_event' });
          continue;
        }
        const files = traceFiles(eid);
        for (const f of files) {
          if (!loadedGroups.has(f.loadGroup)) {
            unloadedTriggers.push({ key, eventName, ...f });
          }
        }
      }

      return {
        klangLoaded: true,
        preloadBanks: se.PRELOAD_BANKS,
        invalidBanks,
        loadedGroups: [...loadedGroups].sort(),
        unloadedTriggers,
      };
    }, soundEvents);

    assertZeroRuntimeErrors(monitors);
    expect(audit.klangLoaded).toBe(true);
    expect(audit.invalidBanks, 'All PRELOAD_BANKS entries must exist in KLANG_CONFIG.events').toEqual([]);
    expect(
      audit.unloadedTriggers,
      'Every SOUND_EVENTS trigger (including WIN cb_win -> load_group codeboogie) must be preloaded by PRELOAD_BANKS'
    ).toEqual([]);
    expect(
      audioResponses.some((r) => r.status === 200 && r.url.includes('codeboogie_win')),
      'Klang preload must fetch codeboogie_win audio asset with HTTP 200'
    ).toBe(true);
  });

  test('T5-02: adv_terminal_velocity_clamp_and_high_speed_sloped_thin_drop', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    // Traverse genuinely to CP8 (Section 8 top pad, y = 20.0) and let jump settle onto pad
    const nav = await navigateToCheckpoint(page, 8, { allowRespawn: false });
    expect(nav.reached).toBe(true);
    await advanceTime(page, 0.45);
    const cp8Snap = await getSnapshot(page);
    expect(cp8Snap.activeCheckpoint).toBe(8);
    expect(cp8Snap.player.grounded).toBe(true);
    expect(cp8Snap.player.y).toBeCloseTo(20.0, 2);

    // Walk South (+Z) to cp8_pad south edge (z >= -59.2) and jump-drop South over sec8_truss_top onto 14-deg sec8_truss_ramp under MAX_FRAME_DT (0.05s)
    await orbitCameraToYaw(page, Math.PI);
    let landedOnRamp = null;
    let peakDownwardVyOnRampDrop = 0;
    try {
      for (let i = 0; i < 65; i++) {
        const s = await getSnapshot(page);
        const dx = 26.0 - s.player.x;
        const dz = -48.0 - s.player.z;
        await orbitCameraToYaw(page, Math.atan2(-dx, -dz), { currentYaw: s.camera.yaw });
        await page.keyboard.down('KeyW');
        if (s.player.z >= -59.2 && s.player.grounded && peakDownwardVyOnRampDrop === 0) {
          await page.keyboard.down('Space');
          await advanceTime(page, 0.05, { step: 0.05 });
          await page.keyboard.up('Space');
          continue;
        }
        await advanceTime(page, 0.05, { step: 0.05 });
        const after = await getSnapshot(page);
        if (after.player.vy < peakDownwardVyOnRampDrop) {
          peakDownwardVyOnRampDrop = after.player.vy;
        }
        if (peakDownwardVyOnRampDrop < -40 && after.player.grounded && after.player.z > -54.5 && after.player.z < -38.5) {
          landedOnRamp = after;
          break;
        }
      }
    } finally {
      await releaseAllGameKeys(page);
    }

    expect(peakDownwardVyOnRampDrop).toBeLessThan(-45);
    expect(landedOnRamp).not.toBeNull();
    expect(landedOnRamp.player.y).toBeGreaterThan(16.0);
    expect(landedOnRamp.player.y).toBeLessThan(19.9);

    // Walk/jump East (+X) off the ramp into open void to achieve > 40-stud freefall and hit true TERMINAL_VELOCITY (-120.0)
    await orbitCameraToYaw(page, -Math.PI / 2);
    await page.keyboard.down('KeyW');
    let jumpedOff = false;
    let minObservedVy = 0;
    let hitExactTerminalVelocity = false;
    let respawnedAtCp8 = false;
    try {
      for (let i = 0; i < 150; i++) {
        const pre = await getSnapshot(page);
        if (!jumpedOff && pre.player.grounded) {
          await page.keyboard.down('Space');
          await advanceTime(page, 1 / 60);
          await page.keyboard.up('Space');
          jumpedOff = true;
          continue;
        }
        await advanceTime(page, 1 / 60);
        const cur = await getSnapshot(page);
        if (cur.player.vy < minObservedVy) {
          minObservedVy = cur.player.vy;
        }
        expect(cur.player.vy).toBeGreaterThanOrEqual(-120.0001);
        if (Math.abs(cur.player.vy - -120.0) < 1e-4) {
          hitExactTerminalVelocity = true;
        }
        if (hitExactTerminalVelocity && cur.player.grounded && Math.hypot(cur.player.x - 26.0, cur.player.z - -64.8) < 1.5) {
          respawnedAtCp8 = true;
          break;
        }
      }
    } finally {
      await releaseAllGameKeys(page);
    }

    expect(
      hitExactTerminalVelocity,
      `Expected freefall from y~24 to hit -120.0 terminal velocity, minObservedVy=${minObservedVy}`
    ).toBe(true);
    expect(respawnedAtCp8).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });

  test('T5-03: adv_physics_side_wall_snap_airborne_non_vault_and_low_overhang_bonk', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);

    const results = await frame.evaluate(async () => {
      const { COLLIDER_KIND, PHYSICS_CONFIG } = await import('./js/constants.js');
      const { createPhysicsController } = await import('./js/physics.js');
      const basisNorth = { forward: { x: 0, z: -1 }, right: { x: 1, z: 0 } };

      const boxWall = {
        id: 'box_wall',
        kind: COLLIDER_KIND.SOLID,
        shape: 'box',
        position: { x: 0, y: 5.0, z: 0 },
        halfExtents: { hx: 2.0, hy: 5.0, hz: 2.0 },
      };
      const cylWall = {
        id: 'cyl_wall',
        kind: COLLIDER_KIND.SOLID,
        shape: 'cylinder',
        position: { x: 0, y: 5.0, z: 0 },
        radius: 2.0,
        hy: 5.0,
      };

      const sideWallSnaps = [];
      for (const [shapeLabel, col] of [
        ['box', boxWall],
        ['cylinder', cylWall],
      ]) {
        for (let startX = -11.95; startX <= -11.75; startX += 0.02) {
          const ctrl = createPhysicsController();
          ctrl.reset({ x: startX, y: 46.22, z: 0 }, 0, []);
          let prev = { position: { x: startX, y: 46.22, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
          for (let f = 0; f < 100; f++) {
            const cur = ctrl.step(1 / 120, { moveX: 1, moveZ: 0, jumpHeld: false }, basisNorth, [col]);
            if (
              cur.grounded &&
              Math.abs(cur.position.y - 10.0) < 0.05 &&
              prev.position.x < -(2.0 + PHYSICS_CONFIG.PLAYER_RADIUS) &&
              prev.position.y < 10.0
            ) {
              sideWallSnaps.push({
                shape: shapeLabel,
                startX: Number(startX.toFixed(2)),
                prevX: Number(prev.position.x.toFixed(4)),
                prevY: Number(prev.position.y.toFixed(4)),
                curY: cur.position.y,
              });
              break;
            }
            prev = cur;
          }
        }
      }

      const floor = {
        id: 'floor',
        kind: COLLIDER_KIND.SOLID,
        shape: 'box',
        position: { x: 0, y: -0.5, z: 0 },
        halfExtents: { hx: 30, hy: 0.5, hz: 30 },
      };
      const wall745 = {
        id: 'wall_745',
        kind: COLLIDER_KIND.SOLID,
        shape: 'box',
        position: { x: 0, y: 3.725, z: -8.0 },
        halfExtents: { hx: 3.0, hy: 3.725, hz: 2.0 },
      };
      let vaultedOnto745 = false;
      for (let startZ = -1.0; startZ >= -5.0; startZ -= 0.1) {
        const ctrl = createPhysicsController();
        ctrl.reset({ x: 0, y: 0, z: startZ }, 0, [floor, wall745]);
        for (let f = 0; f < 60; f++) {
          const cur = ctrl.step(1 / 120, { moveX: 0, moveZ: -1, jumpHeld: f === 0 }, basisNorth, [floor, wall745]);
          if (cur.grounded && Math.abs(cur.position.y - 7.45) < 0.05) {
            vaultedOnto745 = true;
            break;
          }
        }
        if (vaultedOnto745) break;
      }

      const overhangChecks = [];
      for (const order of ['floor_first', 'roof_first']) {
        for (const cMinY of [4.88, 4.99, 5.00, 5.05]) {
          const roof = {
            id: 'roof',
            kind: COLLIDER_KIND.SOLID,
            shape: 'box',
            position: { x: 0, y: cMinY + 0.5, z: -4.0 },
            halfExtents: { hx: 3.0, hy: 0.5, hz: 2.0 },
          };
          const cols = order === 'floor_first' ? [floor, roof] : [roof, floor];
          const ctrl = createPhysicsController();
          ctrl.reset({ x: 0, y: 0, z: 0 }, 0, cols);
          let minY = 0;
          let passed = false;
          for (let f = 0; f < 45; f++) {
            const cur = ctrl.step(1 / 60, { moveX: 0, moveZ: -1, jumpHeld: false }, basisNorth, cols);
            minY = Math.min(minY, cur.position.y);
            if (cur.position.z < -3.5) passed = true;
          }
          overhangChecks.push({ order, cMinY, minY, passed, expectedPass: cMinY >= 5.0 });
        }
      }

      const ceiling = {
        id: 'ceiling',
        kind: COLLIDER_KIND.SOLID,
        shape: 'box',
        position: { x: 0, y: 6.60, z: 0 },
        halfExtents: { hx: 4.0, hy: 0.5, hz: 4.0 },
      };
      const bonkCtrl = createPhysicsController();
      bonkCtrl.reset({ x: 0, y: 0, z: 0 }, 0, [floor, ceiling]);
      let maxHeadY = 0;
      let bonkedCleanly = false;
      for (let f = 0; f < 45; f++) {
        const cur = bonkCtrl.step(1 / 60, { moveX: 0, moveZ: 0, jumpHeld: f === 0 }, basisNorth, [floor, ceiling]);
        maxHeadY = Math.max(maxHeadY, cur.position.y + PHYSICS_CONFIG.PLAYER_HEIGHT);
        if (f > 4 && cur.grounded && Math.abs(cur.position.y) < 1e-4) {
          bonkedCleanly = true;
          break;
        }
      }

      return {
        sideWallSnaps,
        vaultedOnto745,
        overhangMismatches: overhangChecks.filter((c) => c.passed !== c.expectedPass || c.minY < -1e-5),
        maxHeadY,
        bonkedCleanly,
      };
    });

    assertZeroRuntimeErrors(monitors);
    expect(results.overhangMismatches).toEqual([]);
    expect(results.maxHeadY).toBeLessThanOrEqual(6.10001);
    expect(results.maxHeadY).toBeGreaterThan(6.0);
    expect(results.bonkedCleanly).toBe(true);
    expect(
      results.sideWallSnaps,
      'Side-wall contact from below wall top (prevY < cMaxY, prevX outside -hx-R) must never snap upward onto roof'
    ).toEqual([]);
    expect(
      results.vaultedOnto745,
      'Airborne player must never step-up vault onto a 7.45-stud wall exceeding 6.89 max jump height'
    ).toBe(false);
  });

  test('T5-04: adv_step_up_invariance_grounded_trim_vs_tall_wall_rejection', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    const cp1Nav = await navigateToCheckpoint(page, 1, { allowRespawn: false });
    expect(cp1Nav.reached).toBe(true);
    await orbitCameraToYaw(page, 0);

    await page.keyboard.down('KeyW');
    let touchedPlank1TopWithoutJump = false;
    let respawnedBackToCp1 = false;
    try {
      for (let i = 0; i < 90; i++) {
        await advanceTime(page, 1 / 60);
        const s = await getSnapshot(page);
        if (Math.abs(s.player.y - 3.80) < 0.08 && s.player.grounded) {
          touchedPlank1TopWithoutJump = true;
        }
        if (i > 25 && s.player.grounded && Math.abs(s.player.y - 2.50) < 0.08 && Math.abs(s.player.z - -71.5) < 2.0) {
          respawnedBackToCp1 = true;
          break;
        }
      }
    } finally {
      await releaseAllGameKeys(page);
    }
    expect(touchedPlank1TopWithoutJump).toBe(false);
    expect(respawnedBackToCp1).toBe(true);

    const cp8Nav = await navigateToCheckpoint(page, 8, { allowRespawn: true });
    expect(cp8Nav.reached).toBe(true);

    let onDrum1 = false;
    let jumpedFromCp8 = false;
    try {
      for (let i = 0; i < 120; i++) {
        const s = await getSnapshot(page);
        const dx = 26.0 - s.player.x;
        const dz = -77.5 - s.player.z;
        await orbitCameraToYaw(page, Math.atan2(-dx, -dz), { currentYaw: s.camera.yaw });
        await page.keyboard.down('KeyW');
        if (!jumpedFromCp8 && s.player.grounded && s.player.z <= -69.2) {
          await page.keyboard.down('Space');
          await advanceTime(page, 1 / 60);
          await page.keyboard.up('Space');
          jumpedFromCp8 = true;
          continue;
        }
        await advanceTime(page, 1 / 60);
        const cur = await getSnapshot(page);
        if (jumpedFromCp8 && cur.player.grounded && Math.abs(cur.player.y - 20.5) < 0.08 && cur.player.z < -74.3) {
          onDrum1 = true;
          break;
        }
      }
    } finally {
      await releaseAllGameKeys(page);
    }
    expect(onDrum1).toBe(true);

    let steppedUpToHub = false;
    let stayedGroundedDuringStep = true;
    try {
      for (let i = 0; i < 90; i++) {
        const s = await getSnapshot(page);
        const dx = 26.0 - s.player.x;
        const dz = -79.8 - s.player.z;
        await orbitCameraToYaw(page, Math.atan2(-dx, -dz), { currentYaw: s.camera.yaw });
        await page.keyboard.down('KeyW');
        await advanceTime(page, 1 / 60);
        const after = await getSnapshot(page);
        if (!after.player.grounded) {
          stayedGroundedDuringStep = false;
        }
        if (after.player.grounded && Math.abs(after.player.y - 20.95) < 0.04) {
          steppedUpToHub = true;
          break;
        }
      }
    } finally {
      await releaseAllGameKeys(page);
    }

    expect(steppedUpToHub).toBe(true);
    expect(stayedGroundedDuringStep).toBe(true);
    assertZeroRuntimeErrors(monitors);
  });

  test('T5-05: adv_camera_outside_iframe_swallowed_mouseup_right_drag_and_middle_button', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);
    const center = await getCanvasSafeCenter(page);

    await frame.evaluate(() => {
      window.__ADV_MOUSEUP_COUNT__ = 0;
      window.__ADV_CONTEXTMENU_PREVENTED__ = false;
      window.addEventListener('mouseup', () => {
        window.__ADV_MOUSEUP_COUNT__ += 1;
      });
      document.querySelector('canvas').addEventListener('contextmenu', (e) => {
        window.__ADV_CONTEXTMENU_PREVENTED__ = e.defaultPrevented;
      });
    });

    const snap0 = await getSnapshot(page);
    await frame.evaluate(
      ({ cx, cy }) => {
        const canvas = document.querySelector('canvas');
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: cx, clientY: cy, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { button: 0, buttons: 1, clientX: cx + 120, clientY: cy, bubbles: true }));
      },
      { cx: center.x, cy: center.y }
    );
    await advanceTime(page, 1 / 60);
    const snapMidOrphanDrag = await getSnapshot(page);
    expect(Math.abs(shortestAngle(snap0.camera.yaw, snapMidOrphanDrag.camera.yaw))).toBeGreaterThan(0.5);
    expect(await frame.evaluate(() => window.__ADV_MOUSEUP_COUNT__)).toBe(0);

    await page.mouse.move(center.x - 140, center.y, { steps: 1 });
    await page.mouse.move(center.x + 180, center.y + 60, { steps: 8 });
    await advanceTime(page, 0.05);
    const snapAfterPassiveHover = await getSnapshot(page);
    expect(Math.abs(shortestAngle(snapMidOrphanDrag.camera.yaw, snapAfterPassiveHover.camera.yaw))).toBeLessThan(1e-6);
    expect(Math.abs(snapMidOrphanDrag.camera.pitch - snapAfterPassiveHover.camera.pitch)).toBeLessThan(1e-6);

    await frame.evaluate(
      ({ cx, cy }) => {
        const canvas = document.querySelector('canvas');
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: cx, clientY: cy, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { button: 0, buttons: 1, clientX: cx - 80, clientY: cy, bubbles: true }));
      },
      { cx: center.x, cy: center.y }
    );
    await advanceTime(page, 1 / 60);
    const snapBeforeMiddleClear = await getSnapshot(page);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(center.x + 150, center.y - 50, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    await advanceTime(page, 0.05);
    const snapAfterMiddleClear = await getSnapshot(page);
    expect(Math.abs(shortestAngle(snapBeforeMiddleClear.camera.yaw, snapAfterMiddleClear.camera.yaw))).toBeLessThan(1e-6);
    expect(Math.abs(snapBeforeMiddleClear.camera.pitch - snapAfterMiddleClear.camera.pitch)).toBeLessThan(1e-6);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(center.x - 110, center.y + 30, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await page.mouse.click(center.x, center.y, { button: 'right' });
    await advanceTime(page, 0.05);
    const snapAfterRightDrag = await getSnapshot(page);
    expect(Math.abs(shortestAngle(snapAfterMiddleClear.camera.yaw, snapAfterRightDrag.camera.yaw))).toBeGreaterThan(0.4);
    expect(await frame.evaluate(() => window.__ADV_CONTEXTMENU_PREVENTED__)).toBe(true);

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-06: adv_visibilitychange_clears_simultaneous_camera_drag_and_held_movement_keys', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);
    const center = await getCanvasSafeCenter(page);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(center.x + 90, center.y, { steps: 3 });
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await advanceTime(page, 0.1);

    const activeSnap = await getSnapshot(page);
    expect(Math.hypot(activeSnap.player.vx, activeSnap.player.vz)).toBeGreaterThan(8.0);
    expect(activeSnap.player.vy).toBeGreaterThan(10.0);

    await frame.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await advanceTime(page, 0.75);
    const settledSnap = await getSnapshot(page);
    expect(settledSnap.player.grounded).toBe(true);
    expect(settledSnap.player.vx).toBe(0);
    expect(settledSnap.player.vz).toBe(0);

    await page.mouse.move(center.x - 120, center.y + 40, { steps: 5 });
    const afterDragMoveSnap = await getSnapshot(page);
    expect(Math.abs(shortestAngle(settledSnap.camera.yaw, afterDragMoveSnap.camera.yaw))).toBeLessThan(1e-6);

    await page.mouse.up({ button: 'left' });
    await releaseAllGameKeys(page);
    await frame.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await holdKeysAndAdvance(page, ['KeyW'], 0.2);
    const recoveredSnap = await getSnapshot(page);
    expect(
      Math.hypot(recoveredSnap.player.x - settledSnap.player.x, recoveredSnap.player.z - settledSnap.player.z)
    ).toBeGreaterThan(1.5);
    assertZeroRuntimeErrors(monitors);
  });

  test('T5-07: adv_camera_and_clock_extreme_nonfinite_inputs_and_wheel_deltamodes', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);

    await frame.evaluate(() => {
      window.__TEST_CONTROL__.advanceTime(NaN);
      window.__TEST_CONTROL__.advanceTime(-50);
      window.__TEST_CONTROL__.advanceTime(0);
      const canvas = document.querySelector('canvas');
      const nanWheel = new CustomEvent('wheel', { cancelable: true });
      nanWheel.deltaY = NaN;
      canvas.dispatchEvent(nanWheel);
      const nanDown = new CustomEvent('mousedown', { cancelable: true });
      nanDown.button = 0;
      nanDown.clientX = NaN;
      nanDown.clientY = Infinity;
      canvas.dispatchEvent(nanDown);
    });

    const afterNonFinite = await getSnapshot(page);
    for (const v of [
      afterNonFinite.player.x,
      afterNonFinite.player.y,
      afterNonFinite.player.z,
      afterNonFinite.player.vx,
      afterNonFinite.player.vy,
      afterNonFinite.player.vz,
      afterNonFinite.camera.yaw,
      afterNonFinite.camera.pitch,
      afterNonFinite.camera.distance,
    ]) {
      expect(Number.isFinite(v)).toBe(true);
    }

    await frame.evaluate(() => {
      const canvas = document.querySelector('canvas');
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, cancelable: true }));
    });
    await advanceTime(page, 0.8);
    expect((await getSnapshot(page)).camera.distance).toBeCloseTo(19.0, 1);

    await frame.evaluate(() => {
      const canvas = document.querySelector('canvas');
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, deltaMode: 0, cancelable: true }));
    });
    await advanceTime(page, 0.8);
    expect((await getSnapshot(page)).camera.distance).toBeCloseTo(17.0, 1);

    await zoomCameraByWheel(page, 999999, 1.0);
    expect((await getSnapshot(page)).camera.distance).toBeCloseTo(45.0, 2);
    await zoomCameraByWheel(page, -999999, 1.0);
    expect((await getSnapshot(page)).camera.distance).toBeCloseTo(5.5, 2);

    await orbitCameraByDrag(page, 3600, 900, { steps: 4, settleSec: 0.1 });
    expect((await getSnapshot(page)).camera.pitch).toBeCloseTo((80 * Math.PI) / 180, 3);

    await orbitCameraByDrag(page, 0, -2400, { steps: 4, settleSec: 0.1 });
    expect((await getSnapshot(page)).camera.pitch).toBeCloseTo((-15 * Math.PI) / 180, 3);

    const preWalk = await getSnapshot(page);
    await holdKeysAndAdvance(page, ['KeyW'], 0.2);
    const postWalk = await getSnapshot(page);
    const moveDx = postWalk.player.x - preWalk.player.x;
    const moveDz = postWalk.player.z - preWalk.player.z;
    const moveLen = Math.hypot(moveDx, moveDz);
    expect(moveLen).toBeGreaterThan(1.2);
    const expectedFx = -Math.sin(preWalk.camera.yaw);
    const expectedFz = -Math.cos(preWalk.camera.yaw);
    expect((moveDx / moveLen) * expectedFx + (moveDz / moveLen) * expectedFz).toBeGreaterThan(0.995);

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-08: adv_dynamic_platform_carry_and_jump_across_phase_offsets_and_jittered_dt', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);

    await advanceTime(page, 2.37, { step: 0.03 });

    const cp6 = await navigateToCheckpoint(page, 6, { allowRespawn: true });
    expect(cp6.reached).toBe(true);

    await orbitCameraToYaw(page, Math.PI / 2);
    await page.keyboard.down('KeyW');
    let landedCross1 = null;
    try {
      for (let i = 0; i < 65; i++) {
        const s = await getSnapshot(page);
        if (s.player.x <= 113.5 && s.player.grounded && s.player.x > 110.5) {
          await page.keyboard.down('Space');
          await advanceTime(page, 1 / 60);
          await page.keyboard.up('Space');
          continue;
        }
        await advanceTime(page, 1 / 60);
        const cur = await getSnapshot(page);
        if (
          cur.player.grounded &&
          Math.hypot(cur.player.x - 103.0, cur.player.z - -24.8) < 4.5 &&
          Math.hypot(cur.player.x - 103.0, cur.player.z - -24.8) > 0.6
        ) {
          landedCross1 = cur;
          break;
        }
      }
    } finally {
      await releaseAllGameKeys(page);
    }
    expect(landedCross1).not.toBeNull();

    await advanceTime(page, 0.15);
    const crossStart = await getSnapshot(page);
    const startRadius = Math.hypot(crossStart.player.x - 103.0, crossStart.player.z - -24.8);
    for (const dt of [1 / 120, 1 / 30, 0.05, 1 / 60, 0.04, 1 / 90, 0.05, 1 / 45]) {
      await advanceTime(page, dt, { step: dt });
    }
    const crossEnd = await getSnapshot(page);
    const endRadius = Math.hypot(crossEnd.player.x - 103.0, crossEnd.player.z - -24.8);
    expect(crossEnd.player.grounded).toBe(true);
    expect(Math.abs(endRadius - startRadius)).toBeLessThan(0.05);
    expect(Math.hypot(crossEnd.player.x - crossStart.player.x, crossEnd.player.z - crossStart.player.z)).toBeGreaterThan(0.15);

    const fin = await navigateCourseToGoal(page, { allowRespawn: true });
    expect(fin.reached).toBe(true);
    await expectGameOverOverlay(page);
    assertZeroRuntimeErrors(monitors);
  });

  test('T5-09: adv_3d_assets_snowbox_obj_normalization_elf_rig_states_and_contact_shadow', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    await advanceTime(page, 0.25);

    const loadedUrls = monitors.localAssetLoads.filter((a) => a.status === 200).map((a) => a.url);
    const requiredAssetTokens = [
      '/scenes/snowball/models/elf-animated.gltf',
      '/scenes/snowball/models/elf-animated.bin',
      '/scenes/snowball/models/elf-tidy.png',
      '/scenes/snowbox/models/pine-tree.obj',
      '/scenes/snowbox/models/gift.obj',
      '/scenes/snowbox/models/arch.obj',
      '/scenes/snowbox/models/snowman.obj',
      '/scenes/snowbox/models/mountain/rock_01.obj',
      '/scenes/snowbox/models/mountain/rock_02.obj',
      '/scenes/snowbox/img/skybox_v09/xpos.jpg',
      '/scenes/snowbox/img/skybox_v09/xneg.jpg',
      '/scenes/snowbox/img/skybox_v09/ypos.jpg',
      '/scenes/snowbox/img/skybox_v09/yneg.jpg',
      '/scenes/snowbox/img/skybox_v09/zpos.jpg',
      '/scenes/snowbox/img/skybox_v09/zneg.jpg',
    ];
    for (const token of requiredAssetTokens) {
      expect(
        loadedUrls.some((u) => u.includes(token)),
        `Expected HTTP 200 asset load for ${token}`
      ).toBe(true);
    }

    await zoomCameraByWheel(page, -999999, 0.6);
    expect((await getSnapshot(page)).camera.distance).toBeCloseTo(5.5, 1);
    const closeIdleFrame = await sampleWebGLFrame(page);
    expect(closeIdleFrame.nonTransparentRatio).toBeGreaterThan(0.95);
    expect(closeIdleFrame.distinctColors).toBeGreaterThanOrEqual(8);

    expect((await getSnapshot(page)).player.animState).toBe('idle');
    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.1);
    expect((await getSnapshot(page)).player.animState).toBe('run');
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    expect((await getSnapshot(page)).player.animState).toBe('jump');
    await advanceTime(page, 0.56);
    expect((await getSnapshot(page)).player.animState).toBe('run');
    await page.keyboard.up('KeyW');
    await advanceTime(page, 0.25);
    expect((await getSnapshot(page)).player.animState).toBe('idle');

    const THREE = await import(pathToFileURL(path.join(WORKTREE_ROOT, 'node_modules/three/build/three.module.js')).href);
    const { GLTFLoader } = await import(
      pathToFileURL(path.join(WORKTREE_ROOT, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js')).href
    );
    const { COLLIDER_KIND } = await import(pathToFileURL(path.join(SCENE_DIR, 'js/constants.js')).href);
    const { parseSnowboxObjTemplates } = await import(pathToFileURL(path.join(SCENE_DIR, 'js/props.js')).href);
    const { loadElfPlayer } = await import(pathToFileURL(path.join(SCENE_DIR, 'js/player.js')).href);

    const snowboxDir = path.join(WORKTREE_ROOT, 'static/scenes/snowbox/models');
    const propLib = parseSnowboxObjTemplates({
      pineTree: fs.readFileSync(path.join(snowboxDir, 'pine-tree.obj'), 'utf8'),
      gift: fs.readFileSync(path.join(snowboxDir, 'gift.obj'), 'utf8'),
      arch: fs.readFileSync(path.join(snowboxDir, 'arch.obj'), 'utf8'),
      snowman: fs.readFileSync(path.join(snowboxDir, 'snowman.obj'), 'utf8'),
      rock01: fs.readFileSync(path.join(snowboxDir, 'mountain/rock_01.obj'), 'utf8'),
      rock02: fs.readFileSync(path.join(snowboxDir, 'mountain/rock_02.obj'), 'utf8'),
    });

    const instances = {
      pineTree: propLib.createPineTree({ height: 9.0 }),
      gift: propLib.createGiftProp({ size: 3.2 }),
      arch: propLib.createArchProp({ height: 11.5 }),
      snowman: propLib.createSnowmanProp({ height: 4.6 }),
      rock0: propLib.createRockProp({ radius: 1.8, variant: 0 }),
      rock1: propLib.createRockProp({ radius: 1.8, variant: 1 }),
    };

    for (const [key, obj] of Object.entries(instances)) {
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      expect(size.y, `${key} has positive normalized height`).toBeGreaterThan(1.0);
      expect(size.x, `${key} has positive normalized width`).toBeGreaterThan(0.5);
      if (!key.startsWith('rock')) {
        expect(box.min.y, `${key} grounded near y=0`).toBeGreaterThanOrEqual(-0.25);
        expect(box.min.y, `${key} grounded near y=0`).toBeLessThanOrEqual(0.25);
      }
    }

    const gltfJson = JSON.parse(
      fs.readFileSync(path.join(WORKTREE_ROOT, 'static/scenes/snowball/models/elf-animated.gltf'), 'utf8')
    );
    const binBuf = fs.readFileSync(path.join(WORKTREE_ROOT, 'static/scenes/snowball/models/elf-animated.bin'));
    gltfJson.buffers[0].uri = `data:application/octet-stream;base64,${binBuf.toString('base64')}`;
    delete gltfJson.images;
    delete gltfJson.textures;
    for (const mat of gltfJson.materials || []) {
      if (mat.pbrMetallicRoughness) delete mat.pbrMetallicRoughness.baseColorTexture;
    }
    globalThis.ProgressEvent ??= Event;
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(JSON.stringify(gltfJson), '');
    const testScene = new THREE.Scene();
    const elf = await loadElfPlayer({ scene: testScene, gltf });

    const solidPad = {
      id: 'pad',
      kind: COLLIDER_KIND.SOLID,
      shape: 'box',
      position: { x: 0, y: -0.6, z: 0 },
      halfExtents: { hx: 6, hy: 0.6, hz: 6 },
    };
    const checkpointOnly = {
      id: 'cp_trig',
      kind: COLLIDER_KIND.CHECKPOINT,
      shape: 'box',
      position: { x: 30, y: 2.0, z: 0 },
      halfExtents: { hx: 5, hy: 2.0, hz: 5 },
    };

    elf.update(
      1 / 60,
      { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, facingYaw: 0 },
      {},
      [solidPad, checkpointOnly]
    );
    const shadowGroundOpacity = elf.shadowMesh.material.opacity;
    const shadowGroundScale = elf.shadowMesh.scale.x;
    expect(elf.getAnimState()).toBe('idle');
    expect(elf.shadowMesh.visible).toBe(true);

    elf.update(
      1 / 60,
      { position: { x: 0, y: 6.0, z: -1 }, velocity: { x: 0, y: 20, z: -16 }, grounded: false, facingYaw: 0 },
      {},
      [solidPad, checkpointOnly]
    );
    expect(elf.getAnimState()).toBe('jump');
    expect(elf.shadowMesh.visible).toBe(true);
    expect(elf.shadowMesh.material.opacity).toBeLessThan(shadowGroundOpacity);
    expect(elf.shadowMesh.scale.x).toBeLessThan(shadowGroundScale);

    elf.update(
      1 / 60,
      { position: { x: 30, y: 5.0, z: 0 }, velocity: { x: 0, y: -5, z: 0 }, grounded: false, facingYaw: 0 },
      {},
      [solidPad, checkpointOnly]
    );
    expect(elf.shadowMesh.visible).toBe(false);

    elf.update(
      1 / 60,
      { position: { x: 0, y: 20.0, z: 0 }, velocity: { x: 0, y: -5, z: 0 }, grounded: false, facingYaw: 0 },
      {},
      [solidPad]
    );
    expect(elf.shadowMesh.visible).toBe(false);

    elf.triggerCelebrate();
    elf.update(
      1 / 60,
      { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, grounded: true, facingYaw: 0 },
      { celebrating: true },
      [solidPad]
    );
    expect(elf.getAnimState()).toBe('celebrate');
    elf.resetPose();
    expect(elf.getAnimState()).toBe('idle');
    elf.dispose();

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-10: adv_input_modifier_chords_synthetic_repeat_keyup_and_jump_buffer_expiry', async ({
    page,
    baseURL,
  }) => {
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);

    const s0 = await getSnapshot(page);
    await frame.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', ctrlKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', key: 'ArrowUp', altKey: true, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', metaKey: true, bubbles: true }));
    });
    await advanceTime(page, 0.15);
    const sAfterModChord = await getSnapshot(page);
    expect(sAfterModChord.player.x).toBeCloseTo(s0.player.x, 5);
    expect(sAfterModChord.player.z).toBeCloseTo(s0.player.z, 5);
    expect(sAfterModChord.player.y).toBeCloseTo(s0.player.y, 5);

    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.1);
    expect((await getSnapshot(page)).player.vz).toBeLessThan(-8.0);
    await frame.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', ctrlKey: true, bubbles: true }));
    });
    await advanceTime(page, 0.25);
    expect((await getSnapshot(page)).player.vz).toBe(0);
    await page.keyboard.up('KeyW');

    await frame.evaluate(() => {
      const down = new CustomEvent('keydown');
      down.code = 'ArrowUp';
      down.keyCode = 38;
      window.dispatchEvent(down);
    });
    await advanceTime(page, 0.1);
    expect((await getSnapshot(page)).player.vz).toBeLessThan(-8.0);
    await frame.evaluate(() => {
      const up = new CustomEvent('keyup');
      up.code = 'ArrowUp';
      up.keyCode = 38;
      up.repeat = true;
      window.dispatchEvent(up);
    });
    await advanceTime(page, 0.25);
    expect((await getSnapshot(page)).player.vz).toBe(0);

    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');
    await advanceTime(page, 0.20);
    await page.keyboard.down('Space');
    await advanceTime(page, 1 / 60);
    await page.keyboard.up('Space');

    await advanceTime(page, 0.42);
    const landedAfterExpiredBuffer = await getSnapshot(page);
    expect(landedAfterExpiredBuffer.player.grounded).toBe(true);
    expect(landedAfterExpiredBuffer.player.y).toBeCloseTo(0, 3);
    expect(landedAfterExpiredBuffer.player.vy).toBe(0);

    assertZeroRuntimeErrors(monitors);
  });
});

/**
 * Installs passive wire-level spies inside `/scenes/jollyobby/` BEFORE module execution:
 * - `window.__E2E_PORT_OUTBOUND__`: every `{ type, payload }` sent via scene `MessagePort.postMessage`
 * - `window.__E2E_PORT_INBOUND__`: every `{ type, payload }` received via scene `MessagePort.onmessage`
 * - `window.__E2E_KEY_COUNTS__`: `{ keydown, keyup, codesDown, codesUp }`
 * - `window.__E2E_LISTENER_STATS__`: `{ added, removed }`
 * - `window.__E2E_RAF_STATS__`: `{ pendingCount, maxPendingCount, activeCallbacks, maxConcurrentCallbacks }`
 * - `window.__E2E_OFFSCREEN_TEXT_CALLS__`: `OffscreenCanvasRenderingContext2D` `fillText`/`strokeText` calls
 */
async function installAdversarialHostSpies(page) {
  await page.addInitScript(() => {
    if (!location.pathname.includes('/scenes/jollyobby/')) return;
    if (window.__E2E_HOST_ADV_SPIES__) return;
    Object.defineProperty(window, '__E2E_HOST_ADV_SPIES__', {
      value: true,
      writable: false,
      configurable: false,
    });

    const outbound = [];
    const inbound = [];
    const keyCounts = { keydown: 0, keyup: 0, codesDown: [], codesUp: [] };
    const listenerStats = { added: 0, removed: 0 };
    const pendingRafs = new Set();
    const rafStats = {
      get pendingCount() {
        return pendingRafs.size;
      },
      maxPendingCount: 0,
      activeCallbacks: 0,
      maxConcurrentCallbacks: 0,
    };
    const offscreenTextCalls = [];

    Object.defineProperty(window, '__E2E_PORT_OUTBOUND__', { value: outbound, configurable: false, writable: false });
    Object.defineProperty(window, '__E2E_PORT_INBOUND__', { value: inbound, configurable: false, writable: false });
    Object.defineProperty(window, '__E2E_KEY_COUNTS__', { value: keyCounts, configurable: false, writable: false });
    Object.defineProperty(window, '__E2E_LISTENER_STATS__', { value: listenerStats, configurable: false, writable: false });
    Object.defineProperty(window, '__E2E_RAF_STATS__', { value: rafStats, configurable: false, writable: false });
    Object.defineProperty(window, '__E2E_OFFSCREEN_TEXT_CALLS__', {
      value: offscreenTextCalls,
      configurable: false,
      writable: false,
    });

    const OrigMessageChannel = window.MessageChannel;
    if (typeof OrigMessageChannel === 'function') {
      window.MessageChannel = function(...args) {
        const ch = new OrigMessageChannel(...args);
        const origPost = ch.port1.postMessage.bind(ch.port1);
        ch.port1.postMessage = function(msg, transfer) {
          try {
            outbound.push(msg ? JSON.parse(JSON.stringify(msg)) : msg);
          } catch (_) {
            outbound.push({ type: msg && msg.type, nonCloneable: true });
          }
          return transfer !== undefined ? origPost(msg, transfer) : origPost(msg);
        };
        let userOnMessage = null;
        let attachedWrapper = false;
        Object.defineProperty(ch.port1, 'onmessage', {
          configurable: true,
          enumerable: true,
          get() {
            return userOnMessage;
          },
          set(fn) {
            userOnMessage = fn;
            if (!attachedWrapper) {
              attachedWrapper = true;
              MessagePort.prototype.addEventListener.call(ch.port1, 'message', (ev) => {
                try {
                  inbound.push(ev.data ? JSON.parse(JSON.stringify(ev.data)) : ev.data);
                } catch (_) {
                  inbound.push({ type: ev.data && ev.data.type });
                }
                if (typeof userOnMessage === 'function') {
                  userOnMessage.call(ch.port1, ev);
                }
              });
              ch.port1.start();
            }
          },
        });
        return ch;
      };
      window.MessageChannel.prototype = OrigMessageChannel.prototype;
    }

    window.addEventListener(
      'keydown',
      (ev) => {
        keyCounts.keydown += 1;
        keyCounts.codesDown.push(ev.code || ev.key || '');
      },
      true
    );
    window.addEventListener(
      'keyup',
      (ev) => {
        keyCounts.keyup += 1;
        keyCounts.codesUp.push(ev.code || ev.key || '');
      },
      true
    );
    document.addEventListener(
      'keydown',
      (ev) => {
        if (ev instanceof CustomEvent) {
          keyCounts.keydown += 1;
          keyCounts.codesDown.push(ev.code || ev.key || '');
        }
      },
      true
    );
    document.addEventListener(
      'keyup',
      (ev) => {
        if (ev instanceof CustomEvent) {
          keyCounts.keyup += 1;
          keyCounts.codesUp.push(ev.code || ev.key || '');
        }
      },
      true
    );

    const origAdd = EventTarget.prototype.addEventListener;
    const origRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      listenerStats.added += 1;
      return origAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      listenerStats.removed += 1;
      return origRemove.call(this, type, listener, options);
    };

    const origRaf = window.requestAnimationFrame.bind(window);
    const origCaf = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = function(cb) {
      let id = 0;
      id = origRaf((ts) => {
        pendingRafs.delete(id);
        rafStats.activeCallbacks += 1;
        if (rafStats.activeCallbacks > rafStats.maxConcurrentCallbacks) {
          rafStats.maxConcurrentCallbacks = rafStats.activeCallbacks;
        }
        try {
          return cb(ts);
        } finally {
          rafStats.activeCallbacks -= 1;
        }
      });
      pendingRafs.add(id);
      if (pendingRafs.size > rafStats.maxPendingCount) {
        rafStats.maxPendingCount = pendingRafs.size;
      }
      return id;
    };
    window.cancelAnimationFrame = function(id) {
      pendingRafs.delete(id);
      return origCaf(id);
    };

    if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
      for (const method of ['fillText', 'strokeText']) {
        const orig = OffscreenCanvasRenderingContext2D.prototype[method];
        if (typeof orig === 'function') {
          OffscreenCanvasRenderingContext2D.prototype[method] = function(text, ...rest) {
            offscreenTextCalls.push({ method, text: String(text) });
            return orig.call(this, text, ...rest);
          };
        }
      }
    }
  });
}

/**
 * Boots `/jollyobby.html` in pure real-time browser `requestAnimationFrame` mode (`__MANUAL_TIME__` unset).
 */
async function loadJollyObbyRealTime(page, baseURL) {
  await installAdversarialHostSpies(page);
  const monitors = await attachRuntimeMonitors(page);
  const { prodOrigin } = resolveServerUrls(baseURL);
  await page.goto(`${prodOrigin}/jollyobby.html`, { waitUntil: 'domcontentloaded' });
  await jollyobby.gameElem(page).waitFor({ state: 'attached', timeout: 45000 });
  const frame = await jollyobby.contentFrame(page);
  await frame.evaluate(async () => {
    const deadline = Date.now() + 45000;
    while (!(window.__TEST_CONTROL__ && window.__TEST_CONTROL__.isReady())) {
      if (Date.now() > deadline) throw new Error('Real-time isReady() timed out');
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
  await page.waitForTimeout(100);
  return { monitors, frame };
}

test.describe('Tier 5 Adversarial — Host Integration, Lifecycle, Focus Races, Security & R1/R4/R5', () => {
  test('T5-Host-01 (adv_1c2_single_keydown_checkpoint_echo): Single-keydown KeyW+Space survives real MessagePort score->resume+unmuted echo across CP1 activation', async ({
    page,
    baseURL,
  }) => {
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);
    const center = await getCanvasSafeCenter(page);

    await navigateToCheckpoint(page, 1, {
      onCheckpoint: undefined,
    });
    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);

    const preCp1Waypoints = [
      { x: 0.0, z: -13.8 },
      { x: -2.0, z: -24.8 },
      { x: 2.0, z: -35.8 },
      { x: -1.6, z: -46.8 },
      { x: 0.0, z: -57.8 },
    ];
    await page.mouse.click(center.x, center.y);
    for (const wp of preCp1Waypoints) {
      let jumpedLeg = false;
      for (let step = 0; step < 260; step += 1) {
        const s = await getSnapshot(page);
        const dx = wp.x - s.player.x;
        const dz = wp.z - s.player.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.2 && s.player.grounded) {
          break;
        }
        const desiredYaw = Math.atan2(-dx, -dz);
        if (Math.abs(shortestAngle(desiredYaw, s.camera.yaw)) > 0.04) {
          await releaseAllGameKeys(page);
          await orbitCameraToYaw(page, desiredYaw, { currentYaw: s.camera.yaw, centerInfo: center });
        }
        if (!s.player.grounded && dist < 1.0) {
          await page.keyboard.up('KeyW');
        } else {
          await page.keyboard.down('KeyW');
        }
        if (!jumpedLeg && s.player.grounded && dist > 5.2 && dist <= 9.2) {
          await page.keyboard.down('Space');
          await advanceTime(page, 1 / 60);
          await page.keyboard.up('Space');
          jumpedLeg = true;
        } else {
          await advanceTime(page, 1 / 60);
        }
      }
      await releaseAllGameKeys(page);
      await advanceTime(page, 0.12);
    }

    await orbitCameraToYaw(page, 0, { centerInfo: center });
    await page.mouse.click(center.x, center.y);
    await page.keyboard.down('KeyW');
    await advanceTime(page, 0.12);
    await page.keyboard.up('KeyW');
    await advanceTime(page, 0.12);

    const preSnap = await getSnapshot(page);
    expect(preSnap.activeCheckpoint).toBe(0);
    expect(preSnap.player.grounded).toBe(true);
    expect(preSnap.player.z).toBeLessThan(-57.5);
    expect(preSnap.player.z).toBeGreaterThan(-61.2);

    await frame.evaluate(() => {
      window.__E2E_KEY_COUNTS__.keydown = 0;
      window.__E2E_KEY_COUNTS__.keyup = 0;
      window.__E2E_KEY_COUNTS__.codesDown.length = 0;
      window.__E2E_KEY_COUNTS__.codesUp.length = 0;
    });
    const inboundBeforeHold = await frame.evaluate(() => window.__E2E_PORT_INBOUND__.length);

    try {
      await page.keyboard.down('KeyW');
      await page.keyboard.down('Space');

      let crossedCp1 = false;
      for (let step = 0; step < 90; step += 1) {
        await advanceTime(page, 1 / 60);
        const s = await getSnapshot(page);
        if (s.activeCheckpoint === 1) {
          crossedCp1 = true;
          break;
        }
      }
      expect(crossedCp1).toBe(true);
      await expectBadgeLevel(page, 2);

      await page.waitForTimeout(90);
      const inboundEchoes = await frame.evaluate(
        (idx) => window.__E2E_PORT_INBOUND__.slice(idx).map((m) => m && m.type),
        inboundBeforeHold
      );
      expect(inboundEchoes).toContain('resume');
      expect(inboundEchoes).toContain('unmuted');

      let minPostEchoSpeed = Infinity;
      let sawPostEchoAutoJump = false;
      const initialPostEchoSnap = await getSnapshot(page);
      let prevGrounded = initialPostEchoSnap.player.grounded;
      let prevVy = initialPostEchoSnap.player.vy;

      for (let step = 0; step < 45; step += 1) {
        await advanceTime(page, 1 / 60);
        const s = await getSnapshot(page);
        const horizSpeed = Math.hypot(s.player.vx, s.player.vz);
        if (horizSpeed < minPostEchoSpeed) {
          minPostEchoSpeed = horizSpeed;
        }
        if ((prevGrounded || prevVy <= 0) && s.player.vy > 20) {
          sawPostEchoAutoJump = true;
        }
        prevGrounded = s.player.grounded;
        prevVy = s.player.vy;
      }

      expect(minPostEchoSpeed).toBeGreaterThanOrEqual(15.5);
      expect(sawPostEchoAutoJump).toBe(true);

      const keyStats = await frame.evaluate(() => window.__E2E_KEY_COUNTS__);
      expect(keyStats.keydown).toBe(2);
      expect(keyStats.keyup).toBe(0);
      expect(keyStats.codesDown).toEqual(['KeyW', 'Space']);
    } finally {
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyW');
      await releaseAllGameKeys(page);
    }

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-02 (adv_6a_zero_ms_playagain_race): 0ms #playagainButton click -> immediate KeyW hold with 0 canvas click works from BOTH Pause overlay and Section 10 Game Over overlay', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90000);
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);

    await navigateToCheckpoint(page, 1);
    await expectBadgeLevel(page, 2);

    await clickChromePauseOrPlay(page);
    const overlay = page.locator('santa-overlay');
    await expect(overlay).not.toHaveAttribute('hidden', '');

    const inboundIdxA = await frame.evaluate(() => window.__E2E_PORT_INBOUND__.length);

    try {
      await overlay.locator('#playagainButton').click();
      await page.keyboard.down('KeyW');

      await page.waitForTimeout(90);
      await jollyobby.advanceTime(page, 0.35);

      const snapA = await getSnapshot(page);
      const inboundWaveA = await frame.evaluate(
        (idx) => window.__E2E_PORT_INBOUND__.slice(idx).map((m) => m && m.type),
        inboundIdxA
      );
      expect(inboundWaveA).toContain('restart');
      expect(inboundWaveA.filter((t) => t === 'resume').length).toBeGreaterThanOrEqual(2);
      expect(snapA.paused).toBe(false);
      expect(snapA.activeCheckpoint).toBe(0);
      expect(snapA.currentSection).toBe(1);
      expect(snapA.player.z).toBeLessThan(-4.0);
      expect(snapA.player.vz).toBeLessThanOrEqual(-15.5);
      await expectBadgeLevel(page, 1);
    } finally {
      await page.keyboard.up('KeyW');
      await releaseAllGameKeys(page);
    }

    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);

    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);
    const snapCompleted = await getSnapshot(page);
    expect(snapCompleted.completed).toBe(true);

    const inboundIdxB = await frame.evaluate(() => window.__E2E_PORT_INBOUND__.length);

    try {
      await overlay.locator('#playagainButton').click();
      await page.keyboard.down('KeyW');

      await page.waitForTimeout(90);
      await jollyobby.advanceTime(page, 0.35);

      const snapB = await getSnapshot(page);
      const inboundWaveB = await frame.evaluate(
        (idx) => window.__E2E_PORT_INBOUND__.slice(idx).map((m) => m && m.type),
        inboundIdxB
      );
      expect(inboundWaveB).toContain('restart');
      expect(inboundWaveB.filter((t) => t === 'resume').length).toBeGreaterThanOrEqual(2);
      expect(snapB.completed).toBe(false);
      expect(snapB.paused).toBe(false);
      expect(snapB.activeCheckpoint).toBe(0);
      expect(snapB.currentSection).toBe(1);
      expect(snapB.player.z).toBeLessThan(-4.0);
      expect(snapB.player.vz).toBeLessThanOrEqual(-15.5);
      await expectBadgeLevel(page, 1);
    } finally {
      await page.keyboard.up('KeyW');
      await releaseAllGameKeys(page);
    }

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-03 (adv_6a_realtime_raf_pause_restart): Pure real-time rAF mode (__MANUAL_TIME__ unset) freezes during Pause, keeps rAF concurrency === 1, and honors 0ms #playagainButton -> KeyW+Space hold', async ({
    page,
    baseURL,
  }) => {
    const { monitors, frame } = await loadJollyObbyRealTime(page, baseURL);

    const center = await getCanvasSafeCenter(page);
    await page.mouse.click(center.x, center.y);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(420);
    await page.keyboard.up('KeyW');
    const snapMoved = await getSnapshot(page);
    expect(snapMoved.player.z).toBeLessThan(-1.5);

    await clickChromePauseOrPlay(page);
    const snapPaused0 = await getSnapshot(page);
    expect(snapPaused0.paused).toBe(true);

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(240);
    const snapPaused1 = await getSnapshot(page);
    await page.keyboard.up('KeyW');
    expect(snapPaused1.player.x).toBeCloseTo(snapPaused0.player.x, 5);
    expect(snapPaused1.player.y).toBeCloseTo(snapPaused0.player.y, 5);
    expect(snapPaused1.player.z).toBeCloseTo(snapPaused0.player.z, 5);

    const overlay = page.locator('santa-overlay');
    try {
      await overlay.locator('#playagainButton').click();
      await page.keyboard.down('KeyW');
      await page.keyboard.down('Space');

      await page.waitForTimeout(450);
      const snapLive = await getSnapshot(page);
      expect(snapLive.paused).toBe(false);
      expect(snapLive.activeCheckpoint).toBe(0);
      expect(snapLive.player.z).toBeLessThan(-1.5);
      expect(snapLive.player.y).toBeGreaterThan(0.05);
    } finally {
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyW');
      await releaseAllGameKeys(page);
    }

    for (let i = 0; i < 3; i += 1) {
      await clickChromePauseOrPlay(page);
      await clickOverlayPlay(page);
      await clickChromePauseOrPlay(page);
      await overlay.locator('#playagainButton').click();
      await page.waitForTimeout(60);
    }

    const rafStats = await frame.evaluate(() => ({
      pendingCount: window.__E2E_RAF_STATS__.pendingCount,
      maxPendingCount: window.__E2E_RAF_STATS__.maxPendingCount,
      maxConcurrentCallbacks: window.__E2E_RAF_STATS__.maxConcurrentCallbacks,
    }));
    expect(rafStats.pendingCount).toBe(1);
    expect(rafStats.maxPendingCount).toBe(1);
    expect(rafStats.maxConcurrentCallbacks).toBe(1);

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-04 (adv_6b_mute_toggle_zero_click_space): Raw <santa-chrome> mute button click -> 0-click Space jumps elf WITHOUT re-toggling santa-chrome.muted at both async-settle and 0ms', async ({
    page,
    baseURL,
  }) => {
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);

    const chrome = page.locator('santa-chrome');
    const audioBtn = page.locator('santa-chrome header santa-button').nth(1);

    const mutedInitial = await chrome.evaluate((el) => Boolean(el.muted));

    await audioBtn.click();
    await expect
      .poll(() => chrome.evaluate((el) => Boolean(el.muted)), { timeout: 3000 })
      .toBe(!mutedInitial);
    const mutedAfterFirst = await chrome.evaluate((el) => Boolean(el.muted));

    await page.keyboard.down('Space');
    await advanceTime(page, 3 / 60);
    await page.keyboard.up('Space');
    const snapJump1 = await getSnapshot(page);
    expect(snapJump1.player.vy).toBeGreaterThan(20);
    expect(snapJump1.player.y).toBeGreaterThan(0.3);
    expect(await chrome.evaluate((el) => Boolean(el.muted))).toBe(mutedAfterFirst);

    await advanceTime(page, 0.95);
    const snapLanded = await getSnapshot(page);
    expect(snapLanded.player.grounded).toBe(true);

    await audioBtn.click();
    await page.keyboard.down('Space');
    await page.waitForTimeout(30);
    await advanceTime(page, 3 / 60);
    await page.keyboard.up('Space');

    const snapJump2 = await getSnapshot(page);
    const mutedAfterSecond = await chrome.evaluate((el) => Boolean(el.muted));
    expect(mutedAfterSecond).toBe(!mutedAfterFirst);
    expect(snapJump2.player.vy).toBeGreaterThan(20);
    expect(snapJump2.player.y).toBeGreaterThan(0.3);

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-05 (adv_lifecycle_spam_listeners_and_mute_burst): 20x mid-air Pause/Resume spam + 30x rapid Mute/Unmute burst + 0 listener leaks + immediate 0-click 3-key chord', async ({
    page,
    baseURL,
  }) => {
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);

    const baselineListeners = await frame.evaluate(
      () => window.__E2E_LISTENER_STATS__.added - window.__E2E_LISTENER_STATS__.removed
    );

    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await advanceTime(page, 0.14);
    const midAirStart = await getSnapshot(page);
    expect(midAirStart.player.grounded).toBe(false);
    expect(midAirStart.player.y).toBeGreaterThan(2.0);

    for (let i = 0; i < 20; i += 1) {
      await clickChromePauseOrPlay(page);
      if (i === 0) {
        await page.keyboard.up('Space');
        await page.keyboard.up('KeyW');
      }
      const pausedSnapA = await getSnapshot(page);
      expect(pausedSnapA.paused).toBe(true);
      await jollyobby.advanceTime(page, 0.05);
      const pausedSnapB = await getSnapshot(page);
      expect(pausedSnapB.player.x).toBeCloseTo(pausedSnapA.player.x, 6);
      expect(pausedSnapB.player.y).toBeCloseTo(pausedSnapA.player.y, 6);
      expect(pausedSnapB.player.z).toBeCloseTo(pausedSnapA.player.z, 6);

      await clickOverlayPlay(page);
      const resumedSnap = await getSnapshot(page);
      expect(resumedSnap.paused).toBe(false);
    }

    await advanceTime(page, 1.0);
    const landedAfterSpam = await getSnapshot(page);
    expect(landedAfterSpam.player.grounded).toBe(true);
    expect(Math.hypot(landedAfterSpam.player.vx, landedAfterSpam.player.vz)).toBeLessThan(0.05);

    await clickChromePauseOrPlay(page);
    await clickOverlayPlayAgain(page);

    const chrome = page.locator('santa-chrome');
    const audioBtn = page.locator('santa-chrome header santa-button').nth(1);
    const m0 = await chrome.evaluate((el) => Boolean(el.muted));
    await audioBtn.click();
    await expect.poll(() => chrome.evaluate((el) => Boolean(el.muted)), { timeout: 3000 }).toBe(!m0);
    const mutedBefore30 = await chrome.evaluate((el) => Boolean(el.muted));

    const inboundBeforeMuteSpam = await frame.evaluate(() => window.__E2E_PORT_INBOUND__.length);
    for (let i = 0; i < 30; i += 1) {
      await audioBtn.click();
    }
    await page.waitForTimeout(40);
    const mutedAfter30 = await chrome.evaluate((el) => Boolean(el.muted));
    expect(mutedAfter30).toBe(mutedBefore30);

    const muteInboundEvents = await frame.evaluate(
      (idx) =>
        window.__E2E_PORT_INBOUND__
          .slice(idx)
          .filter((m) => m && (m.type === 'muted' || m.type === 'unmuted')).length,
      inboundBeforeMuteSpam
    );
    expect(muteInboundEvents).toBeGreaterThanOrEqual(30);

    const afterAllSpamListeners = await frame.evaluate(
      () => window.__E2E_LISTENER_STATS__.added - window.__E2E_LISTENER_STATS__.removed
    );
    expect(afterAllSpamListeners).toBe(baselineListeners);

    try {
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyD');
      await page.keyboard.down('Space');
      await advanceTime(page, 0.14);
      const chordSnap = await getSnapshot(page);
      expect(Math.hypot(chordSnap.player.vx, chordSnap.player.vz)).toBeGreaterThanOrEqual(15.5);
      expect(chordSnap.player.vy).toBeGreaterThan(15);
      expect(await chrome.evaluate((el) => Boolean(el.muted))).toBe(mutedAfter30);
    } finally {
      await page.keyboard.up('Space');
      await page.keyboard.up('KeyD');
      await page.keyboard.up('KeyW');
      await releaseAllGameKeys(page);
    }

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-06 (adv_host_body_staggered_chord_and_editable_guard): Host document.body focus forwards staggered KeyW+KeyD+Space chord, partial release, click-into-canvas handoff, and editable target guard', async ({
    page,
    baseURL,
  }) => {
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);

    await page.evaluate(() => {
      const inp = document.createElement('input');
      inp.id = 'e2e-temp-host-input';
      inp.type = 'text';
      inp.style.cssText = 'position:fixed;top:0;left:0;width:40px;height:20px;z-index:99999;opacity:0.01;';
      document.body.appendChild(inp);
      inp.focus();
    });
    await page.keyboard.type('wasd ');
    await page.waitForTimeout(30);
    await advanceTime(page, 0.15);
    const snapEditable = await getSnapshot(page);
    expect(snapEditable.player.x).toBeCloseTo(0, 5);
    expect(snapEditable.player.y).toBeCloseTo(0, 5);
    expect(snapEditable.player.z).toBeCloseTo(0, 5);
    await page.evaluate(() => {
      const inp = document.getElementById('e2e-temp-host-input');
      if (inp) inp.remove();
    });

    await page.evaluate(() => {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      document.body.tabIndex = -1;
      document.body.focus();
    });
    expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).toBe('BODY');

    try {
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyD');
      await page.keyboard.down('Space');
      await page.waitForTimeout(30);
      await advanceTime(page, 0.12);

      const snapChord = await getSnapshot(page);
      expect(snapChord.player.vx).toBeGreaterThan(10.5);
      expect(snapChord.player.vz).toBeLessThan(-10.5);
      expect(Math.hypot(snapChord.player.vx, snapChord.player.vz)).toBeCloseTo(16.0, 1);
      expect(snapChord.player.vy).toBeGreaterThan(15);

      expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).toBe('BODY');

      await page.keyboard.up('Space');
      await page.keyboard.up('KeyD');
      await page.waitForTimeout(25);
      expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).toBe('BODY');

      await advanceTime(page, 0.10);
      const snapPureW = await getSnapshot(page);
      expect(Math.abs(snapPureW.player.vx)).toBeLessThan(0.5);
      expect(snapPureW.player.vz).toBeLessThan(-15.5);

      await page.keyboard.up('KeyW');
      await page.waitForTimeout(25);
      expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).toBe(
        'SANTA-GAMELOADER'
      );
      await advanceTime(page, 0.9);
      const snapSettled = await getSnapshot(page);
      expect(Math.hypot(snapSettled.player.vx, snapSettled.player.vz)).toBeLessThan(0.05);
    } finally {
      await releaseAllGameKeys(page);
    }

    await page.evaluate(() => {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      document.body.focus();
    });
    const center = await getCanvasSafeCenter(page);
    try {
      await page.keyboard.down('KeyS');
      await page.waitForTimeout(25);
      await advanceTime(page, 0.08);
      await page.mouse.click(center.x, center.y);
      await page.waitForTimeout(25);
      await advanceTime(page, 0.08);
      const duringHold = await getSnapshot(page);
      expect(duringHold.player.vz).toBeGreaterThan(15.0);

      await page.keyboard.up('KeyS');
      await page.waitForTimeout(25);
      await advanceTime(page, 0.20);
      const afterUp = await getSnapshot(page);
      expect(Math.hypot(afterUp.player.vx, afterUp.player.vz)).toBeLessThan(0.05);
    } finally {
      await releaseAllGameKeys(page);
    }

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-07 (adv_outside_iframe_mouseup_middle_click_and_tab_hide): Swallowed mouseup on <santa-chrome>, middle-button rejection, and multi-tab visibilitychange clear active drag + 3-key chord', async ({
    page,
    baseURL,
  }) => {
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);
    const center = await getCanvasSafeCenter(page);

    const snap0 = await getSnapshot(page);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(center.x + 90, center.y + 45, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    await advanceTime(page, 1 / 60);
    const snapAfterMiddle = await getSnapshot(page);
    expect(snapAfterMiddle.camera.yaw).toBeCloseTo(snap0.camera.yaw, 5);
    expect(snapAfterMiddle.camera.pitch).toBeCloseTo(snap0.camera.pitch, 5);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(center.x + 80, center.y, { steps: 4 });
    await advanceTime(page, 1 / 60);
    const snapMidDrag = await getSnapshot(page);
    expect(Math.abs(snapMidDrag.camera.yaw - snap0.camera.yaw)).toBeGreaterThan(0.3);

    const audioBox = await page.locator('santa-chrome header santa-button').nth(1).boundingBox();
    const outsideX = audioBox ? Math.max(20, audioBox.x - 40) : 200;
    const outsideY = audioBox ? audioBox.y + audioBox.height / 2 : 24;
    await page.mouse.move(outsideX, outsideY, { steps: 3 });
    await page.mouse.up({ button: 'left' });
    const yawAtOutsideRelease = (await getSnapshot(page)).camera.yaw;

    await page.mouse.move(center.x - 70, center.y, { steps: 4 });
    await page.mouse.move(center.x + 70, center.y, { steps: 6 });
    await advanceTime(page, 1 / 60);
    const snapAfterUnpressedHover = await getSnapshot(page);
    expect(Math.abs(snapAfterUnpressedHover.camera.yaw - yawAtOutsideRelease)).toBeLessThan(0.015);

    await page.mouse.move(center.x, center.y);
    await page.mouse.click(center.x, center.y);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyD');
    await page.keyboard.down('Space');
    await page.mouse.down({ button: 'left' });
    await page.mouse.move(center.x + 40, center.y, { steps: 3 });
    await advanceTime(page, 0.08);

    const bgTab = await page.context().newPage();
    await bgTab.goto('about:blank');
    await bgTab.bringToFront();
    await page.waitForTimeout(60);

    const hiddenTriggered = await frame.evaluate(() => document.hidden || document.visibilityState === 'hidden');
    if (!hiddenTriggered) {
      await frame.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        Object.defineProperty(document, 'hidden', { value: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        delete document.visibilityState;
        delete document.hidden;
      });
    }

    await page.keyboard.up('Space');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    await page.mouse.up({ button: 'left' });

    await page.bringToFront();
    await bgTab.close();
    await page.waitForTimeout(50);

    const postTabSnap = await getSnapshot(page);
    if (postTabSnap.paused) {
      await clickOverlayPlay(page);
    }

    const yawBeforeSweep = (await getSnapshot(page)).camera.yaw;
    await page.mouse.move(center.x - 60, center.y, { steps: 4 });
    await advanceTime(page, 0.9);
    const finalSnap = await getSnapshot(page);
    expect(Math.abs(finalSnap.camera.yaw - yawBeforeSweep)).toBeLessThan(0.015);
    expect(Math.hypot(finalSnap.player.vx, finalSnap.player.vz)).toBeLessThan(0.05);

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-08 (adv_completion_wire_idempotency_and_zero_fdl): Section 10 completion emits strictly 1 gameover() with undefined payload, 0 score keys on all score messages, 0 FDL calls, and freezes WASD+Space across 180 post-win frames', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90000);
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);

    await navigateCourseToGoal(page);
    await expectGameOverOverlay(page);
    await expectBadgeLevel(page, 10);

    const winSnap = await getSnapshot(page);
    expect(winSnap.completed).toBe(true);
    expect(winSnap.currentSection).toBe(10);

    try {
      await page.keyboard.down('KeyW');
      await page.keyboard.down('KeyA');
      await page.keyboard.down('KeyS');
      await page.keyboard.down('KeyD');
      await page.keyboard.down('Space');
      await advanceTime(page, 3.0, { step: 1 / 60 });
    } finally {
      await releaseAllGameKeys(page);
    }

    await page.waitForTimeout(60);
    const postWinSnap = await getSnapshot(page);
    expect(postWinSnap.player.x).toBeCloseTo(winSnap.player.x, 5);
    expect(postWinSnap.player.y).toBeCloseTo(winSnap.player.y, 5);
    expect(postWinSnap.player.z).toBeCloseTo(winSnap.player.z, 5);
    expect(Math.hypot(postWinSnap.player.vx, postWinSnap.player.vy, postWinSnap.player.vz)).toBe(0);

    const wireAudit = await frame.evaluate(() => {
      const msgs = window.__E2E_PORT_OUTBOUND__;
      const gameovers = msgs.filter((m) => m && m.type === 'gameover');
      const scores = msgs.filter((m) => m && m.type === 'score');
      const plays = msgs.filter((m) => m && m.type === 'play').map((m) => m.payload && m.payload[0]);
      return {
        gameoverCount: gameovers.length,
        gameoverPayloads: gameovers.map((m) => (m.payload === undefined ? 'UNDEFINED' : m.payload)),
        scoreCount: scores.length,
        anyScoreHasScoreProp: scores.some(
          (m) => m.payload && Object.prototype.hasOwnProperty.call(m.payload, 'score')
        ),
        allScoresHaveMaxLevel10: scores.every((m) => m.payload && m.payload.maxLevel === 10),
        winSoundCount: plays.filter((p) => p === 'cb_win').length,
        gameoverMusicCount: plays.filter((p) => p === 'music_ingame_gameover').length,
      };
    });

    expect(wireAudit.gameoverCount).toBe(1);
    expect(wireAudit.gameoverPayloads).toEqual(['UNDEFINED']);
    expect(wireAudit.scoreCount).toBeGreaterThanOrEqual(10);
    expect(wireAudit.anyScoreHasScoreProp).toBe(false);
    expect(wireAudit.allScoresHaveMaxLevel10).toBe(true);
    expect(wireAudit.winSoundCount).toBe(1);
    expect(wireAudit.gameoverMusicCount).toBe(1);

    expect(monitors.firebaseShortLinkCalls).toBe(0);
    const shareUi = await page.locator('santa-overlay').evaluate((el) => {
      const sr = el.shadowRoot;
      const urlEl = sr && sr.querySelector('.url');
      return {
        shareUrl: el.shareUrl || null,
        urlVisible: Boolean(urlEl && getComputedStyle(urlEl).display !== 'none' && !urlEl.hidden),
      };
    });
    expect(shareUi.shareUrl).toBeNull();
    expect(shareUi.urlVisible).toBe(false);

    const badge = await getBadgeState(page);
    expect(badge.altActive).toBe(true);
    expect(badge.altHidden).toBe(false);
    expect(badge.level).toBe(10);
    expect(badge.maxLevel).toBe(10);
    expect(badge.score).toBe(0);

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-09 (adv_test_hook_strict_immutability_and_nan_hardening): Non-configurable descriptors, strict-mode TypeError across every nested snapshot object, zero cheat hooks, and NaN/Infinity input resilience', async ({
    page,
    baseURL,
  }) => {
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);

    const immutabilityAudit = await frame.evaluate(() => {
      'use strict';
      const tcDesc = Object.getOwnPropertyDescriptor(window, '__TEST_CONTROL__');
      const stateDesc = Object.getOwnPropertyDescriptor(window, '__JOLLYOBBY_STATE__');
      const tcKeys = Object.keys(window.__TEST_CONTROL__).sort();

      const snap = window.__TEST_CONTROL__.getSnapshot();
      const mutationAttempts = [
        () => {
          delete window.__TEST_CONTROL__;
        },
        () => {
          window.__TEST_CONTROL__ = {};
        },
        () => {
          window.__TEST_CONTROL__.teleport = () => {};
        },
        () => {
          window.__TEST_CONTROL__.advanceTime = () => {};
        },
        () => {
          delete window.__JOLLYOBBY_STATE__;
        },
        () => {
          window.__JOLLYOBBY_STATE__ = {};
        },
        () => {
          snap.currentSection = 10;
        },
        () => {
          snap.completed = true;
        },
        () => {
          snap.player.x = 999;
        },
        () => {
          snap.camera.yaw = 2.5;
        },
        () => {
          snap.finishGoal.radius = 9999;
        },
        () => {
          snap.checkpoints.push({ index: 99 });
        },
        () => {
          snap.checkpoints[0].x = 500;
        },
        () => {
          snap.sectionWaypoints.pop();
        },
        () => {
          snap.sectionWaypoints[0].z = 500;
        },
      ];

      const results = mutationAttempts.map((fn) => {
        try {
          fn();
          return 'MUTATED';
        } catch (err) {
          return err instanceof TypeError ? 'TypeError' : err.name;
        }
      });

      const suspiciousGlobals = Object.getOwnPropertyNames(window).filter((k) =>
        /teleport|setPlayer|setCheckpoint|godMode|forceWin|completeCourse|debugGame/i.test(k)
      );

      return {
        tcConfigurable: tcDesc.configurable,
        tcWritable: tcDesc.writable,
        tcFrozen: Object.isFrozen(window.__TEST_CONTROL__),
        tcKeys,
        stateConfigurable: stateDesc.configurable,
        stateHasGetter: typeof stateDesc.get === 'function',
        stateHasSetter: stateDesc.set !== undefined,
        results,
        suspiciousGlobals,
      };
    });

    expect(immutabilityAudit.tcConfigurable).toBe(false);
    expect(immutabilityAudit.tcWritable).toBe(false);
    expect(immutabilityAudit.tcFrozen).toBe(true);
    expect(immutabilityAudit.tcKeys).toEqual(['advanceTime', 'getSnapshot', 'isReady']);
    expect(immutabilityAudit.stateConfigurable).toBe(false);
    expect(immutabilityAudit.stateHasGetter).toBe(true);
    expect(immutabilityAudit.stateHasSetter).toBe(false);
    expect(immutabilityAudit.results).toEqual(Array(15).fill('TypeError'));
    expect(immutabilityAudit.suspiciousGlobals).toEqual([]);

    const finiteAfterFuzz = await frame.evaluate(() => {
      const tc = window.__TEST_CONTROL__;
      for (const badDt of [NaN, Infinity, -Infinity, -10, 0, undefined, null, 'abc', {}]) {
        tc.advanceTime(badDt);
      }

      const canvas = document.querySelector('#module-jollyobby canvas');
      canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 200, clientY: 200, bubbles: true }));
      const badMove = new Event('mousemove');
      Object.assign(badMove, { clientX: NaN, clientY: Infinity, buttons: 1 });
      window.dispatchEvent(badMove);
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));

      const badWheel1 = new Event('wheel');
      Object.assign(badWheel1, { deltaY: NaN, deltaMode: 0 });
      canvas.dispatchEvent(badWheel1);
      const badWheel2 = new Event('wheel');
      Object.assign(badWheel2, { deltaY: Infinity, deltaMode: 0 });
      canvas.dispatchEvent(badWheel2);

      tc.advanceTime(1 / 60);
      const s = tc.getSnapshot();
      const nums = [
        s.player.x,
        s.player.y,
        s.player.z,
        s.player.vx,
        s.player.vy,
        s.player.vz,
        s.player.facingYaw,
        s.camera.yaw,
        s.camera.pitch,
        s.camera.distance,
      ];
      return {
        allFinite: nums.every((n) => Number.isFinite(n)),
        currentSection: s.currentSection,
        completed: s.completed,
      };
    });

    expect(finiteAfterFuzz.allFinite).toBe(true);
    expect(finiteAfterFuzz.currentSection).toBe(1);
    expect(finiteAfterFuzz.completed).toBe(false);

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-10 (adv_r4_cdp_multitouch_and_r5_deep_shadow_burst_audit): R4 TouchEvent + PointerEvent + CDP multi-touch pinch/swipe inertness & R5 deep ShadowDOM + OffscreenCanvas + immediate 1/60s burst zero-text audit', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90000);
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);
    const frame = await jollyobby.contentFrame(page);
    const center = await getCanvasSafeCenter(page);

    const touchHandlerProps = await frame.evaluate(() => {
      const targets = [
        window,
        document,
        document.documentElement,
        document.body,
        document.getElementById('module-jollyobby'),
        document.querySelector('#module-jollyobby canvas'),
      ];
      const propNames = ['ontouchstart', 'ontouchmove', 'ontouchend', 'ontouchcancel'];
      const nonNull = [];
      for (const t of targets) {
        if (!t) continue;
        for (const p of propNames) {
          if (t[p] !== null && t[p] !== undefined) {
            nonNull.push(`${t.tagName || 'window/doc'}.${p}`);
          }
        }
      }
      const forbiddenRegs = (window.__E2E_REGISTERED_EVENTS__ || []).filter((e) =>
        /^(touchstart|touchmove|touchend|touchcancel|gesturestart|gesturechange|gestureend)$/i.test(e.type)
      );
      return { nonNull, forbiddenRegs };
    });
    expect(touchHandlerProps.nonNull).toEqual([]);
    expect(touchHandlerProps.forbiddenRegs).toEqual([]);

    const snapBeforeTouch = await getSnapshot(page);

    await frame.evaluate(() => {
      const canvas = document.querySelector('#module-jollyobby canvas');
      if (typeof Touch === 'function' && typeof TouchEvent === 'function') {
        const t1 = new Touch({ identifier: 1, target: canvas, clientX: 220, clientY: 220 });
        const t2 = new Touch({ identifier: 2, target: canvas, clientX: 340, clientY: 260 });
        canvas.dispatchEvent(
          new TouchEvent('touchstart', {
            touches: [t1, t2],
            targetTouches: [t1, t2],
            changedTouches: [t1, t2],
            bubbles: true,
            cancelable: true,
          })
        );
        const t1Moved = new Touch({ identifier: 1, target: canvas, clientX: 310, clientY: 180 });
        canvas.dispatchEvent(
          new TouchEvent('touchmove', {
            touches: [t1Moved, t2],
            targetTouches: [t1Moved, t2],
            changedTouches: [t1Moved],
            bubbles: true,
            cancelable: true,
          })
        );
        canvas.dispatchEvent(
          new TouchEvent('touchend', {
            touches: [],
            targetTouches: [],
            changedTouches: [t1Moved, t2],
            bubbles: true,
            cancelable: true,
          })
        );
      }
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        canvas.dispatchEvent(
          new PointerEvent(type, { pointerId: 11, pointerType: 'touch', clientX: 280, clientY: 220, bubbles: true })
        );
      }
    });

    const cdp = await page.context().newCDPSession(page);
    const cx = Math.round(center.x);
    const cy = Math.round(center.y);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy, radiusX: 4, radiusY: 4, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx - 60, y: cy, id: 2 }],
    });
    for (let step = 1; step <= 4; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cx - 60 + step * 35, y: cy - step * 10, id: 2 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: cx - 25, y: cy, id: 3 },
        { x: cx + 25, y: cy, id: 4 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: cx - 90, y: cy - 20, id: 3 },
        { x: cx + 90, y: cy + 20, id: 4 },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();

    await advanceTime(page, 0.20);
    const snapAfterTouch = await getSnapshot(page);
    expect(snapAfterTouch.player.x).toBeCloseTo(snapBeforeTouch.player.x, 5);
    expect(snapAfterTouch.player.y).toBeCloseTo(snapBeforeTouch.player.y, 5);
    expect(snapAfterTouch.player.z).toBeCloseTo(snapBeforeTouch.player.z, 5);
    expect(snapAfterTouch.camera.yaw).toBeCloseTo(snapBeforeTouch.camera.yaw, 5);
    expect(snapAfterTouch.camera.pitch).toBeCloseTo(snapBeforeTouch.camera.pitch, 5);
    expect(snapAfterTouch.camera.distance).toBeCloseTo(snapBeforeTouch.camera.distance, 5);

    const assertDeepZeroSceneUiAndText = async (phaseLabel) => {
      const report = await frame.evaluate(() => {
        const root = document.documentElement;
        const extraElements = [];
        const textHits = [];
        const pseudoHits = [];
        const attrHits = [];

        function walkTree(node) {
          if (!node) return;
          if (node.nodeType === Node.TEXT_NODE) {
            const parentTag = node.parentElement ? node.parentElement.tagName.toLowerCase() : '';
            if (parentTag !== 'script' && parentTag !== 'style' && parentTag !== 'title') {
              const t = (node.nodeValue || '').trim();
              if (t.length > 0) textHits.push(`${parentTag}:${t}`);
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = /** @type {Element} */ (node);
            const tag = el.tagName.toLowerCase();
            if (
              el.closest('#module-jollyobby') &&
              el.id !== 'module-jollyobby' &&
              !(tag === 'canvas' && el.parentElement && el.parentElement.id === 'module-jollyobby')
            ) {
              extraElements.push(tag);
            }
            for (const attr of ['aria-label', 'title', 'placeholder', 'alt']) {
              const val = (el.getAttribute(attr) || '').trim();
              if (val) attrHits.push(`${tag}[${attr}]=${val}`);
            }
            for (const pseudo of ['::before', '::after']) {
              const c = getComputedStyle(el, pseudo).content;
              if (c && c !== 'none' && c !== 'normal' && c !== '""' && c !== "''") {
                pseudoHits.push(`${tag}${pseudo}=${c}`);
              }
            }
            if (el.shadowRoot) {
              walkTree(el.shadowRoot);
            }
          }
          for (let child = node.firstChild; child; child = child.nextSibling) {
            walkTree(child);
          }
        }

        walkTree(root);
        return {
          canvasCount: document.querySelectorAll('#module-jollyobby > canvas').length,
          extraElements,
          textHits,
          pseudoHits,
          attrHits,
          canvas2dTextCalls: window.__E2E_CANVAS_TEXT_CALLS__ || [],
          offscreen2dTextCalls: window.__E2E_OFFSCREEN_TEXT_CALLS__ || [],
        };
      });

      expect(report, `R5 violation during ${phaseLabel}`).toEqual({
        canvasCount: 1,
        extraElements: [],
        textHits: [],
        pseudoHits: [],
        attrHits: [],
        canvas2dTextCalls: [],
        offscreen2dTextCalls: [],
      });
    };

    await navigateToCheckpoint(page, 1);
    await assertDeepZeroSceneUiAndText('CP1 checkpoint burst');

    await navigateToCheckpoint(page, 2);
    const hazRes = await triggerHazardRespawnAt(page, 2);
    expect(hazRes.respawned).toBe(true);
    await assertDeepZeroSceneUiAndText('Section 3 hazard respawn pop');

    await clickChromePauseOrPlay(page);
    await assertDeepZeroSceneUiAndText('Pause overlay active');
    await clickOverlayPlay(page);

    await navigateCourseToGoal(page);
    await assertDeepZeroSceneUiAndText('Section 10 goal celebration');

    assertZeroRuntimeErrors(monitors);
  });

  test('T5-Host-11 (adv_host_keys_blur_and_shift_case_stuck_bug): Host window blur OR Shift+W empty-code case mismatch while host holds focus MUST NOT leave WASD stuck in iframe', async ({
    page,
    baseURL,
  }) => {
    await installAdversarialHostSpies(page);
    const monitors = await loadJollyObby(page, baseURL);

    await page.evaluate(() => {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      document.body.tabIndex = -1;
      document.body.focus();
    });

    await page.keyboard.down('KeyW');
    await page.waitForTimeout(25);
    await advanceTime(page, 0.10);
    expect((await getSnapshot(page)).player.vz).toBeLessThan(-15.0);

    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await page.waitForTimeout(25);
    await advanceTime(page, 0.20);
    const snapAfterHostBlur = await getSnapshot(page);

    await page.keyboard.up('KeyW');
    await page.waitForTimeout(25);
    await advanceTime(page, 0.20);
    const snapAfterPhysicalKeyUp = await getSnapshot(page);

    expect(Math.hypot(snapAfterHostBlur.player.vx, snapAfterHostBlur.player.vz)).toBeLessThan(0.05);
    expect(Math.hypot(snapAfterPhysicalKeyUp.player.vx, snapAfterPhysicalKeyUp.player.vz)).toBeLessThan(0.05);

    await page.evaluate(() => {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      document.body.focus();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'W', bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(25);
    await advanceTime(page, 0.10);
    expect((await getSnapshot(page)).player.vz).toBeLessThan(-15.0);

    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(25);
    await advanceTime(page, 0.20);
    const snapAfterCaseChangeKeyUp = await getSnapshot(page);
    expect(Math.hypot(snapAfterCaseChangeKeyUp.player.vx, snapAfterCaseChangeKeyUp.player.vz)).toBeLessThan(0.05);

    assertZeroRuntimeErrors(monitors);
  });
});
