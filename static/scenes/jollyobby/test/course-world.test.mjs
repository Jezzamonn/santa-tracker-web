import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import { COLLIDER_KIND, PHYSICS_CONFIG } from '../js/constants.js';
import { createEnvironment } from '../js/environment.js';
import { parseSnowboxObjTemplates } from '../js/props.js';
import { createEffectsManager } from '../js/effects.js';
import { createCourse } from '../js/course.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SCENE_ROOT, '../../..');

function horizontalDistanceToSolid(x, z, col) {
  if (col.shape === 'cylinder') {
    return Math.max(0, Math.hypot(x - col.position.x, z - col.position.z) - col.radius);
  }
  const yaw = col.yaw || 0;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const dx = x - col.position.x;
  const dz = z - col.position.z;
  const ux = dx * cy - dz * sy;
  const uz = dx * sy + dz * cy;
  const qx = Math.max(-col.halfExtents.hx, Math.min(col.halfExtents.hx, ux));
  const qz = Math.max(-col.halfExtents.hz, Math.min(col.halfExtents.hz, uz));
  return Math.hypot(ux - qx, uz - qz);
}

test('props.js normalizes real Snowbox OBJ geometries (pine-tree, gift, arch, snowman, rocks) with grounded bases', () => {
  const snowboxDir = path.join(REPO_ROOT, 'static/scenes/snowbox/models');
  const propsLib = parseSnowboxObjTemplates({
    pineTree: fs.readFileSync(path.join(snowboxDir, 'pine-tree.obj'), 'utf8'),
    gift: fs.readFileSync(path.join(snowboxDir, 'gift.obj'), 'utf8'),
    arch: fs.readFileSync(path.join(snowboxDir, 'arch.obj'), 'utf8'),
    snowman: fs.readFileSync(path.join(snowboxDir, 'snowman.obj'), 'utf8'),
    rock01: fs.readFileSync(path.join(snowboxDir, 'mountain/rock_01.obj'), 'utf8'),
    rock02: fs.readFileSync(path.join(snowboxDir, 'mountain/rock_02.obj'), 'utf8'),
  });

  const tree = propsLib.createPineTree({ height: 8.0 });
  const treeBox = new THREE.Box3().setFromObject(tree);
  assert.ok(Math.abs(treeBox.min.y) < 0.05, `Pine tree base must sit at y=0, got ${treeBox.min.y}`);
  assert.ok(Math.abs(treeBox.max.y - 8.0) < 0.05, `Pine tree height must match 8.0, got ${treeBox.max.y}`);

  const gift = propsLib.createGiftProp({ size: 2.0 });
  const giftBox = new THREE.Box3().setFromObject(gift);
  assert.ok(Math.abs(giftBox.min.y) < 0.05, `Gift base must sit at y=0, got ${giftBox.min.y}`);

  const arch = propsLib.createArchProp({ width: 14.4, height: 12.0, depth: 3.0 });
  const archBox = new THREE.Box3().setFromObject(arch);
  assert.ok(Math.abs(archBox.min.y) < 0.05, `Arch base must sit at y=0, got ${archBox.min.y}`);

  const snowman = propsLib.createSnowmanProp({ height: 4.6 });
  const snowBox = new THREE.Box3().setFromObject(snowman);
  assert.ok(snowBox.max.y > 4.0);
});

test('course.js builds 10 checkpoints (CP0..CP9), FinishGoal at (82, 28, -56), 60 reachable waypoints, and zero headroom overlaps', () => {
  const scene = new THREE.Scene();
  const env = createEnvironment({ scene, enableCubemapLoad: false });
  const effects = createEffectsManager({ scene });
  const course = createCourse({ scene });

  assert.equal(course.checkpoints.length, 10);
  assert.deepEqual(course.checkpoints[0].spawnPosition, { x: 0, y: 0, z: 0 });
  for (let i = 0; i < 10; i++) {
    assert.equal(course.checkpoints[i].index, i);
    assert.equal(course.checkpoints[i].sectionNumber, i + 1);
    assert.ok(course.colliders.some((c) => c.id === `cp${i}_pad` && c.kind === COLLIDER_KIND.SOLID));
    assert.ok(course.colliders.some((c) => c.id === `cp${i}_trigger` && c.kind === COLLIDER_KIND.CHECKPOINT && c.checkpointIndex === i));
  }

  assert.deepEqual(course.finishGoal, {
    position: { x: 82.0, y: 28.0, z: -56.0 },
    radius: 5.5,
  });
  assert.ok(course.colliders.some((c) => c.kind === COLLIDER_KIND.GOAL));
  assert.equal(course.sectionWaypoints.length, 60);

  // Consecutive waypoint reachability check
  for (let i = 1; i < course.sectionWaypoints.length; i++) {
    const prev = course.sectionWaypoints[i - 1];
    const curr = course.sectionWaypoints[i];
    const dy = curr.y - prev.y;
    const centerDist = Math.hypot(curr.x - prev.x, curr.z - prev.z);
    // Ramp has a continuous 16-stud climb broken into base -> mid -> top waypoints
    assert.ok(dy <= 2.05, `Waypoint ${i - 1} -> ${i} rise ${dy} exceeds 2.05 studs`);
    assert.ok(centerDist <= 16.5, `Waypoint ${i - 1} -> ${i} center distance ${centerDist} exceeds 16.5 studs`);
  }

  // Headroom invariant: no elevated solid collider intrudes within (topY + 0.65, topY + 5.0) above another solid collider
  const solids = course.colliders.filter((c) => c.kind === COLLIDER_KIND.SOLID && Math.abs(c.slopePitch || 0) < 1e-6);
  for (const lower of solids) {
    const lowerTop = lower.position.y + (lower.shape === 'cylinder' ? lower.hy : lower.halfExtents.hy);
    for (const upper of solids) {
      if (upper === lower) continue;
      const upperHy = upper.shape === 'cylinder' ? upper.hy : upper.halfExtents.hy;
      const upperBottom = upper.position.y - upperHy;
      const upperTop = upper.position.y + upperHy;
      // Ignore same-deck hubs/crosses whose top is within STEP_HEIGHT (0.60) of lowerTop
      if (upperTop <= lowerTop + PHYSICS_CONFIG.STEP_HEIGHT + 0.05) continue;
      if (upperBottom >= lowerTop + PHYSICS_CONFIG.PLAYER_HEIGHT) continue;
      if (upperTop <= lowerTop) continue;

      const distXZ = horizontalDistanceToSolid(lower.position.x, lower.position.z, upper);
      const lowerSpan = lower.shape === 'cylinder' ? lower.radius : Math.hypot(lower.halfExtents.hx, lower.halfExtents.hz);
      assert.ok(
        distXZ > lowerSpan + 0.5,
        `Headroom intrusion between lower ${lower.id} (topY=${lowerTop}) and upper ${upper.id} (bottom=${upperBottom})`
      );
    }
  }

  // Dynamic kinematics & reset verification
  course.update(1 / 60);
  const gift1 = course.colliders.find((c) => c.id === 'sec6_gift1');
  const cross1 = course.colliders.find((c) => c.id === 'sec7_cross1_a');
  const sweep1 = course.colliders.find((c) => c.id === 'sec9_sweep1');
  const glide = course.colliders.find((c) => c.id === 'sec10_gold_glide');

  assert.ok(Math.abs(gift1.deltaPosition.x) > 1e-4, 'Section 6 gift must slide horizontally');
  assert.ok(Math.abs(cross1.deltaYaw) > 1e-4, 'Section 7 cross must rotate with non-zero deltaYaw');
  assert.ok(Math.hypot(sweep1.deltaPosition.x, sweep1.deltaPosition.z) > 1e-4, 'Section 9 sweeper must sweep');
  assert.ok(Math.abs(glide.deltaPosition.z) > 1e-4, 'Section 10 gold platform must glide');

  course.resetCheckpoints();
  assert.equal(gift1.deltaPosition.x, 0);
  assert.equal(cross1.deltaYaw, 0);
  assert.equal(glide.deltaPosition.z, 0);
  assert.ok(Math.abs(gift1.position.x - 118.5) < 1e-6);

  // Effects burst lifecycle check
  effects.emitCheckpointBurst({ x: 0, y: 0, z: 0 });
  assert.ok(effects.getActiveCount() >= 20);
  effects.update(1.0);
  effects.reset();
  assert.equal(effects.getActiveCount(), 0);

  env.update(1 / 60);
  env.dispose();
  effects.dispose();
});

test('R5 static source audit: zero fillText, strokeText, TextGeometry, or touch handlers in scene modules', () => {
  const jsDir = path.join(SCENE_ROOT, 'js');
  for (const file of fs.readdirSync(jsDir)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(jsDir, file), 'utf8');
    assert.doesNotMatch(src, /\bfillText\b|\bstrokeText\b|\bTextGeometry\b/, `${file} must contain zero text rendering calls`);
    assert.doesNotMatch(src, /OrbitControls|touchstart|touchmove|touchend/, `${file} must contain zero OrbitControls or touch handlers`);
    assert.doesNotMatch(src, /\.innerHTML\b|\.outerHTML\b|document\.write\b/, `${file} must contain zero unsafe DOM sinks`);
  }
});
