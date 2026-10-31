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
 * 10-Section Clockwise Inward Serpentine Course Builder & Kinematic Updater for Jolly Obby.
 * Strictly zero text/glyphs anywhere in meshes or textures (R5).
 */

import * as THREE from 'three';
import { COLLIDER_KIND } from './constants.js';
import {
  createFallbackPropsLibrary,
  createSnowballHexMesh,
  createGiftPlatformMesh,
  createPeppermintDiscMesh,
  createCheckpointPadMesh,
  createCandyCaneProp,
  createSummitContraptionProp,
} from './props.js';

export const SECTION_WAYPOINTS = Object.freeze([
  // Section 1: Snowball Iceberg Hexagons
  { section: 1, x: 0.0,    y: 0.00,  z: 0.0,     kind: 'checkpoint' },
  { section: 1, x: 0.0,    y: 0.45,  z: -13.8,   kind: 'platform' },
  { section: 1, x: -2.0,   y: 0.90,  z: -24.8,   kind: 'platform' },
  { section: 1, x: 2.0,    y: 1.35,  z: -35.8,   kind: 'platform' },
  { section: 1, x: -1.6,   y: 1.80,  z: -46.8,   kind: 'platform' },
  { section: 1, x: 0.0,    y: 2.20,  z: -57.8,   kind: 'platform' },
  // Section 2: Rainbow Toy-Block Staircase
  { section: 2, x: 0.0,    y: 2.50,  z: -71.5,   kind: 'checkpoint' },
  { section: 2, x: 0.0,    y: 3.80,  z: -82.4,   kind: 'platform' },
  { section: 2, x: 0.0,    y: 5.10,  z: -88.9,   kind: 'platform' },
  { section: 2, x: 0.0,    y: 6.40,  z: -95.4,   kind: 'platform' },
  { section: 2, x: 0.0,    y: 7.70,  z: -101.9,  kind: 'platform' },
  { section: 2, x: 0.0,    y: 9.00,  z: -108.4,  kind: 'platform' },
  { section: 2, x: 0.0,    y: 10.30, z: -114.9,  kind: 'platform' },
  // Section 3: Safe-vs-Lava Checkerboard Grid (L-R-R-L-R)
  { section: 3, x: 0.0,    y: 11.50, z: -125.8,  kind: 'checkpoint' },
  { section: 3, x: 10.25,  y: 11.50, z: -128.8,  kind: 'platform' },
  { section: 3, x: 16.25,  y: 11.50, z: -122.8,  kind: 'platform' },
  { section: 3, x: 22.25,  y: 11.50, z: -122.8,  kind: 'platform' },
  { section: 3, x: 28.25,  y: 11.50, z: -128.8,  kind: 'platform' },
  { section: 3, x: 34.25,  y: 11.50, z: -122.8,  kind: 'platform' },
  // Section 4: Peppermint & Ring Stepping Discs
  { section: 4, x: 44.5,   y: 11.50, z: -125.8,  kind: 'checkpoint' },
  { section: 4, x: 57.1,   y: 11.80, z: -128.0,  kind: 'platform' },
  { section: 4, x: 66.0,   y: 12.10, z: -123.6,  kind: 'platform' },
  { section: 4, x: 76.2,   y: 12.45, z: -130.25, kind: 'ring_safe' },
  { section: 4, x: 87.6,   y: 12.80, z: -121.35, kind: 'ring_safe' },
  { section: 4, x: 97.8,   y: 13.15, z: -128.0,  kind: 'platform' },
  { section: 4, x: 106.6,  y: 13.40, z: -124.2,  kind: 'platform' },
  // Section 5: Sunshine Balance Beam & Red Hurdles
  { section: 5, x: 118.5,  y: 13.50, z: -125.8,  kind: 'checkpoint' },
  { section: 5, x: 118.5,  y: 13.50, z: -116.8,  kind: 'platform' },
  { section: 5, x: 118.5,  y: 13.50, z: -106.0,  kind: 'beam' },
  { section: 5, x: 118.5,  y: 13.50, z: -98.5,   kind: 'beam' },
  { section: 5, x: 118.5,  y: 13.50, z: -90.0,   kind: 'beam' },
  { section: 5, x: 115.3,  y: 13.50, z: -85.3,   kind: 'platform' },
  { section: 5, x: 118.5,  y: 13.50, z: -80.3,   kind: 'platform' },
  // Section 6: Sliding Gift-Box Moving Platforms
  { section: 6, x: 118.5,  y: 13.50, z: -70.8,   kind: 'checkpoint' },
  { section: 6, x: 118.5,  y: 13.90, z: -57.8,   kind: 'moving' },
  { section: 6, x: 118.5,  y: 14.30, z: -47.8,   kind: 'moving' },
  { section: 6, x: 118.5,  y: 14.70, z: -37.8,   kind: 'moving' },
  // Section 7: Spinning Windmill Crosses
  { section: 7, x: 118.5,  y: 15.00, z: -24.8,   kind: 'checkpoint' },
  { section: 7, x: 103.0,  y: 15.00, z: -24.8,   kind: 'rotating' },
  { section: 7, x: 89.0,   y: 15.00, z: -24.8,   kind: 'rotating' },
  { section: 7, x: 75.0,   y: 15.00, z: -24.8,   kind: 'rotating' },
  // Section 8: Neon Diamond Hops & Sky-Blue Truss Ramp
  { section: 8, x: 59.5,   y: 15.00, z: -24.8,   kind: 'checkpoint' },
  { section: 8, x: 46.8,   y: 15.25, z: -23.6,   kind: 'platform' },
  { section: 8, x: 38.8,   y: 15.50, z: -26.2,   kind: 'platform' },
  { section: 8, x: 31.2,   y: 15.75, z: -23.6,   kind: 'platform' },
  { section: 8, x: 26.0,   y: 16.00, z: -30.4,   kind: 'platform' },
  { section: 8, x: 26.0,   y: 16.00, z: -37.2,   kind: 'platform' },
  { section: 8, x: 26.0,   y: 18.00, z: -46.8,   kind: 'ramp' },
  { section: 8, x: 26.0,   y: 20.00, z: -55.8,   kind: 'platform' },
  // Section 9: Jump-Rope Sweeper Drums
  { section: 9, x: 26.0,   y: 20.00, z: -64.8,   kind: 'checkpoint' },
  { section: 9, x: 28.2,   y: 20.50, z: -79.8,   kind: 'sweeper_deck' },
  { section: 9, x: 26.0,   y: 20.75, z: -88.5,   kind: 'platform' },
  { section: 9, x: 28.2,   y: 21.00, z: -97.2,   kind: 'sweeper_deck' },
  // Section 10: Workshop Summit Finale Climb & Finish Goal
  { section: 10, x: 41.5,  y: 21.50, z: -97.2,   kind: 'checkpoint' },
  { section: 10, x: 45.0,  y: 22.80, z: -85.0,   kind: 'platform' },
  { section: 10, x: 50.5,  y: 24.10, z: -76.2,   kind: 'platform' },
  { section: 10, x: 55.0,  y: 25.30, z: -64.2,   kind: 'moving' },
  { section: 10, x: 59.0,  y: 26.30, z: -53.5,   kind: 'platform' },
  { section: 10, x: 67.8,  y: 27.20, z: -56.0,   kind: 'platform' },
  { section: 10, x: 82.0,  y: 28.00, z: -56.0,   kind: 'goal' },
]);

const CHECKPOINT_SPECS = [
  { index: 0, sectionNumber: 1,  x: 0.0,   topY: 0.00,  z: 0.0,    spawnYaw: 0 },
  { index: 1, sectionNumber: 2,  x: 0.0,   topY: 2.50,  z: -71.5,  spawnYaw: 0 },
  { index: 2, sectionNumber: 3,  x: 0.0,   topY: 11.50, z: -125.8, spawnYaw: -Math.PI / 2 },
  { index: 3, sectionNumber: 4,  x: 44.5,  topY: 11.50, z: -125.8, spawnYaw: -Math.PI / 2 },
  { index: 4, sectionNumber: 5,  x: 118.5, topY: 13.50, z: -125.8, spawnYaw: Math.PI },
  { index: 5, sectionNumber: 6,  x: 118.5, topY: 13.50, z: -70.8,  spawnYaw: Math.PI },
  { index: 6, sectionNumber: 7,  x: 118.5, topY: 15.00, z: -24.8,  spawnYaw: Math.PI / 2 },
  { index: 7, sectionNumber: 8,  x: 59.5,  topY: 15.00, z: -24.8,  spawnYaw: Math.PI / 2 },
  { index: 8, sectionNumber: 9,  x: 26.0,  topY: 20.00, z: -64.8,  spawnYaw: 0 },
  { index: 9, sectionNumber: 10, x: 41.5,  topY: 21.50, z: -97.2,  spawnYaw: Math.PI },
];

export function createCourse({ scene, propsLibrary = null } = {}) {
  const props = propsLibrary || createFallbackPropsLibrary();
  const group = new THREE.Group();
  group.name = 'jollyobby-course';

  const colliders = [];
  const checkpoints = [];
  const checkpointControllers = [];
  const dynamicUpdaters = [];
  const hazardMaterials = [];

  function makeHazardMaterial() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff1744,
      emissive: 0xc6002b,
      emissiveIntensity: 0.42,
      roughness: 0.28,
      metalness: 0.08,
    });
    hazardMaterials.push(mat);
    return mat;
  }

  function addBoxCollider({
    id,
    kind = COLLIDER_KIND.SOLID,
    x,
    y,
    z,
    hx,
    hy,
    hz,
    yaw = 0,
    slopePitch = 0,
    sectionIndex,
    checkpointIndex,
    color = null,
    mesh = null,
  }) {
    const col = {
      id,
      kind,
      shape: 'box',
      position: { x, y, z },
      halfExtents: { hx, hy, hz },
      yaw,
      slopePitch,
      deltaPosition: { x: 0, y: 0, z: 0 },
      deltaYaw: 0,
      sectionIndex,
    };
    if (checkpointIndex !== undefined) {
      col.checkpointIndex = checkpointIndex;
    }
    colliders.push(col);

    let visual = mesh;
    if (!visual && color !== null) {
      const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
      const mat = kind === COLLIDER_KIND.HAZARD
        ? makeHazardMaterial()
        : new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05 });
      visual = new THREE.Mesh(geo, mat);
      visual.castShadow = true;
      visual.receiveShadow = true;
    }
    if (visual) {
      visual.position.set(x, y, z);
      visual.rotation.order = 'YXZ';
      visual.rotation.y = yaw;
      visual.rotation.x = slopePitch;
      group.add(visual);
    }
    return { collider: col, mesh: visual };
  }

  function addCylinderCollider({
    id,
    kind = COLLIDER_KIND.SOLID,
    x,
    y,
    z,
    radius,
    hy,
    sectionIndex,
    color = null,
    mesh = null,
  }) {
    const col = {
      id,
      kind,
      shape: 'cylinder',
      position: { x, y, z },
      radius,
      hy,
      yaw: 0,
      slopePitch: 0,
      deltaPosition: { x: 0, y: 0, z: 0 },
      deltaYaw: 0,
      sectionIndex,
    };
    colliders.push(col);

    let visual = mesh;
    if (!visual && color !== null) {
      const geo = new THREE.CylinderGeometry(radius, radius, hy * 2, 28);
      const mat = kind === COLLIDER_KIND.HAZARD
        ? makeHazardMaterial()
        : new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.05 });
      visual = new THREE.Mesh(geo, mat);
      visual.castShadow = true;
      visual.receiveShadow = true;
    }
    if (visual) {
      visual.position.set(x, y, z);
      group.add(visual);
    }
    return { collider: col, mesh: visual };
  }

  // 0. Checkpoints CP0..CP9
  for (const cp of CHECKPOINT_SPECS) {
    const padVisual = createCheckpointPadMesh({ arrowYaw: cp.spawnYaw });
    addBoxCollider({
      id: `cp${cp.index}_pad`,
      kind: COLLIDER_KIND.SOLID,
      x: cp.x,
      y: cp.topY - 0.6,
      z: cp.z,
      hx: 6.0,
      hy: 0.6,
      hz: 6.0,
      sectionIndex: cp.sectionNumber,
      checkpointIndex: cp.index,
      mesh: padVisual.group,
    });
    addBoxCollider({
      id: `cp${cp.index}_trigger`,
      kind: COLLIDER_KIND.CHECKPOINT,
      x: cp.x,
      y: cp.topY + 2.0,
      z: cp.z,
      hx: 5.2,
      hy: 2.0,
      hz: 5.2,
      sectionIndex: cp.sectionNumber,
      checkpointIndex: cp.index,
    });
    checkpoints.push({
      index: cp.index,
      sectionNumber: cp.sectionNumber,
      spawnPosition: { x: cp.x, y: cp.topY, z: cp.z },
      spawnYaw: cp.spawnYaw,
    });
    checkpointControllers.push(padVisual);
  }

  // Section 1: Snowball Iceberg Hexagons (North -Z)
  const sec1Hexes = [
    ['sec1_hex1', 0.0,  -0.65, -13.8],
    ['sec1_hex2', -2.0, -0.20, -24.8],
    ['sec1_hex3', 2.0,   0.25, -35.8],
    ['sec1_hex4', -1.6,  0.70, -46.8],
    ['sec1_hex5', 0.0,   1.10, -57.8],
  ];
  for (const [id, x, y, z] of sec1Hexes) {
    addCylinderCollider({
      id,
      x,
      y,
      z,
      radius: 3.70,
      hy: 1.10,
      sectionIndex: 1,
      mesh: createSnowballHexMesh({ radius: 4.0, height: 2.2 }),
    });
  }

  // Section 2: Rainbow Toy-Block Staircase (North -Z)
  const sec2Planks = [
    ['sec2_plank1', 3.20, -82.4,  0xff8f00],
    ['sec2_plank2', 4.50, -88.9,  0xffd600],
    ['sec2_plank3', 5.80, -95.4,  0x00e676],
    ['sec2_plank4', 7.10, -101.9, 0x00e5ff],
    ['sec2_plank5', 8.40, -108.4, 0x2979ff],
    ['sec2_plank6', 9.70, -114.9, 0x7c4dff],
  ];
  for (const [id, y, z, color] of sec2Planks) {
    addBoxCollider({
      id,
      x: 0.0,
      y,
      z,
      hx: 4.0,
      hy: 0.6,
      hz: 1.6,
      sectionIndex: 2,
      color,
    });
  }

  // Section 3: Safe-vs-Lava Checkerboard Grid (East +X, safe pattern L-R-R-L-R)
  const sec3Cols = [
    [1, 10.25, true],
    [2, 16.25, false],
    [3, 22.25, false],
    [4, 28.25, true],
    [5, 34.25, false],
  ];
  for (const [colNum, x, northIsSafe] of sec3Cols) {
    const rows = [
      ['L', -128.8, northIsSafe],
      ['R', -122.8, !northIsSafe],
    ];
    for (const [suffix, z, isSafe] of rows) {
      if (isSafe) {
        addBoxCollider({
          id: `sec3_c${colNum}_${suffix}`,
          kind: COLLIDER_KIND.SOLID,
          x,
          y: 11.00,
          z,
          hx: 2.25,
          hy: 0.50,
          hz: 2.25,
          sectionIndex: 3,
          color: 0xf8fbff,
        });
      } else {
        const hazVisual = new THREE.Mesh(
          new THREE.BoxGeometry(4.5, 1.0, 4.5),
          makeHazardMaterial()
        );
        hazVisual.castShadow = true;
        addBoxCollider({
          id: `sec3_c${colNum}_${suffix}`,
          kind: COLLIDER_KIND.HAZARD,
          x,
          y: 11.05,
          z,
          hx: 2.05,
          hy: 0.50,
          hz: 2.05,
          sectionIndex: 3,
          mesh: hazVisual,
        });
      }
    }
  }

  // Section 4: Peppermint & Ring Stepping Discs (East +X)
  const sec4Discs = [
    { id: 'sec4_disc1', x: 57.1,  y: 11.25, z: -128.0, r: 2.60, hy: 0.55, mesh: createPeppermintDiscMesh({ radius: 2.60, height: 1.10, stripeColor: 0xff4081 }) },
    { id: 'sec4_disc2', x: 66.0,  y: 11.55, z: -123.6, r: 2.60, hy: 0.55, mesh: createPeppermintDiscMesh({ radius: 2.60, height: 1.10, solidColor: 0x29b6f6 }) },
    { id: 'sec4_disc3', x: 76.2,  y: 11.90, z: -127.8, r: 4.00, hy: 0.55, hasDot: true, dotY: 11.97, mesh: createPeppermintDiscMesh({ radius: 4.00, height: 1.10, solidColor: 0x1e64f0, hasHazardDot: true, dotRadius: 0.80 }) },
    { id: 'sec4_disc4', x: 87.6,  y: 12.25, z: -123.8, r: 4.00, hy: 0.55, hasDot: true, dotY: 12.32, mesh: createPeppermintDiscMesh({ radius: 4.00, height: 1.10, solidColor: 0xffffff, hasHazardDot: true, dotRadius: 0.80 }) },
    { id: 'sec4_disc5', x: 97.8,  y: 12.60, z: -128.0, r: 2.60, hy: 0.55, mesh: createPeppermintDiscMesh({ radius: 2.60, height: 1.10, stripeColor: 0x00e676 }) },
    { id: 'sec4_disc6', x: 106.6, y: 12.85, z: -124.2, r: 2.60, hy: 0.55, mesh: createPeppermintDiscMesh({ radius: 2.60, height: 1.10, solidColor: 0xff80ab }) },
  ];
  for (const d of sec4Discs) {
    d.mesh.traverse((child) => {
      if (child.isMesh && child.userData.isHazardPulse) {
        hazardMaterials.push(child.material);
      }
    });
    addCylinderCollider({
      id: d.id,
      x: d.x,
      y: d.y,
      z: d.z,
      radius: d.r,
      hy: d.hy,
      sectionIndex: 4,
      mesh: d.mesh,
    });
    if (d.hasDot) {
      addCylinderCollider({
        id: `${d.id}_dot`,
        kind: COLLIDER_KIND.HAZARD,
        x: d.x,
        y: d.dotY,
        z: d.z,
        radius: 0.80,
        hy: 0.62,
        sectionIndex: 4,
      });
    }
  }

  // Section 5: Sunshine Balance Beam & Red Hurdles (South +Z)
  const sec5Boxes = [
    ['sec5_fork_in',     COLLIDER_KIND.SOLID,  118.5, 12.90, -116.8, 5.0, 0.60, 1.00, 0xffd600],
    ['sec5_prong_W',     COLLIDER_KIND.SOLID,  114.7, 12.90, -113.3, 1.1, 0.60, 2.50, 0xffd600],
    ['sec5_prong_C',     COLLIDER_KIND.SOLID,  118.5, 12.90, -113.3, 1.3, 0.60, 2.50, 0xffd600],
    ['sec5_prong_E',     COLLIDER_KIND.SOLID,  122.3, 12.90, -113.3, 1.1, 0.60, 2.50, 0xffd600],
    ['sec5_fork_out',    COLLIDER_KIND.SOLID,  118.5, 12.90, -109.8, 5.0, 0.60, 1.00, 0xffd600],
    ['sec5_beam',        COLLIDER_KIND.SOLID,  118.5, 12.90, -98.8,  1.3, 0.60, 10.0, 0xffd600],
    ['sec5_hurdle1',     COLLIDER_KIND.HAZARD, 118.5, 14.00, -102.5, 1.4, 0.50, 0.45, 0xff1744],
    ['sec5_hurdle2',     COLLIDER_KIND.HAZARD, 118.5, 14.00, -94.5,  1.4, 0.50, 0.45, 0xff1744],
    ['sec5_ring_N',      COLLIDER_KIND.SOLID,  118.5, 12.90, -87.8,  4.2, 0.60, 1.00, 0xffd600],
    ['sec5_ring_W',      COLLIDER_KIND.SOLID,  115.3, 12.90, -85.3,  1.0, 0.60, 1.50, 0xffd600],
    ['sec5_ring_E',      COLLIDER_KIND.SOLID,  121.7, 12.90, -85.3,  1.0, 0.60, 1.50, 0xffd600],
    ['sec5_ring_S',      COLLIDER_KIND.SOLID,  118.5, 12.90, -82.8,  4.2, 0.60, 1.00, 0xffd600],
    ['sec5_cyan_bridge', COLLIDER_KIND.SOLID,  118.5, 12.90, -80.3,  1.6, 0.60, 1.50, 0x00e5ff],
  ];
  for (const [id, kind, x, y, z, hx, hy, hz, color] of sec5Boxes) {
    addBoxCollider({ id, kind, x, y, z, hx, hy, hz, sectionIndex: 5, color });
  }

  // Section 6: Sliding Gift-Box Moving Platforms (South +Z)
  const sec6Gifts = [
    ['sec6_gift1', 118.5, 13.10, -57.8, 0,       0x00c853, 0xffd600],
    ['sec6_gift2', 118.5, 13.50, -47.8, Math.PI, 0xff4081, 0xffffff],
    ['sec6_gift3', 118.5, 13.90, -37.8, 0,       0xffb300, 0x00b0ff],
  ];
  const sec6Omega = (Math.PI * 2) / 4.2;
  for (const [id, baseX, y, z, phase, boxColor, ribbonColor] of sec6Gifts) {
    const giftMesh = createGiftPlatformMesh({ width: 6.0, height: 1.6, depth: 6.0, boxColor, ribbonColor });
    const initX = baseX + 4.5 * Math.sin(phase);
    const entry = addBoxCollider({
      id,
      x: initX,
      y,
      z,
      hx: 3.0,
      hy: 0.8,
      hz: 3.0,
      sectionIndex: 6,
      mesh: giftMesh,
    });
    dynamicUpdaters.push((t, zeroDelta) => {
      const nextX = baseX + 4.5 * Math.sin(sec6Omega * t + phase);
      const dx = zeroDelta ? 0 : nextX - entry.collider.position.x;
      entry.collider.deltaPosition.x = dx;
      entry.collider.deltaPosition.y = 0;
      entry.collider.deltaPosition.z = 0;
      entry.collider.deltaYaw = 0;
      entry.collider.position.x = nextX;
      entry.mesh.position.x = nextX;
    });
  }

  // Section 7: Spinning Windmill Crosses (West -X)
  const sec7Crosses = [
    ['sec7_cross1', 103.0, 14.40, -24.8,  0.55, 0,           0xff8f00],
    ['sec7_cross2', 89.0,  14.40, -24.8, -0.55, Math.PI / 4, 0x76ff03],
    ['sec7_cross3', 75.0,  14.40, -24.8,  0.65, 0,           0xff8f00],
  ];
  for (const [prefix, x, y, z, omega, phase, color] of sec7Crosses) {
    const crossGroup = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.40, metalness: 0.06 });
    const armAMesh = new THREE.Mesh(new THREE.BoxGeometry(11.0, 1.2, 2.8), mat);
    const armBMesh = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.2, 11.0), mat);
    const hubCap = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 1.9, 1.24, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 })
    );
    armAMesh.castShadow = true;
    armAMesh.receiveShadow = true;
    armBMesh.castShadow = true;
    armBMesh.receiveShadow = true;
    hubCap.receiveShadow = true;
    crossGroup.add(armAMesh, armBMesh, hubCap);
    crossGroup.position.set(x, y, z);
    crossGroup.rotation.y = phase;
    group.add(crossGroup);

    const armA = addBoxCollider({ id: `${prefix}_a`, x, y, z, hx: 5.5, hy: 0.6, hz: 1.4, yaw: phase, sectionIndex: 7 });
    const armB = addBoxCollider({ id: `${prefix}_b`, x, y, z, hx: 1.4, hy: 0.6, hz: 5.5, yaw: phase, sectionIndex: 7 });
    const hub = addCylinderCollider({ id: `${prefix}_hub`, x, y, z, radius: 1.9, hy: 0.6, sectionIndex: 7 });

    dynamicUpdaters.push((t, zeroDelta) => {
      const nextYaw = phase + omega * t;
      const dYaw = zeroDelta ? 0 : nextYaw - armA.collider.yaw;
      for (const c of [armA.collider, armB.collider, hub.collider]) {
        c.deltaYaw = dYaw;
        c.yaw = nextYaw;
      }
      crossGroup.rotation.y = nextYaw;
    });
  }

  // Section 8: Neon Diamond Hops & Sky-Blue Truss Ramp (West -X -> North -Z)
  const sec8Diamonds = [
    ['sec8_dia1', 46.8, 14.75, -23.6, 0xff4081],
    ['sec8_dia2', 38.8, 15.00, -26.2, 0x7c4dff],
    ['sec8_dia3', 31.2, 15.25, -23.6, 0xff4081],
    ['sec8_dia4', 26.0, 15.50, -30.4, 0x7c4dff],
  ];
  for (const [id, x, y, z, color] of sec8Diamonds) {
    addBoxCollider({
      id,
      x,
      y,
      z,
      hx: 2.1,
      hy: 0.5,
      hz: 2.1,
      yaw: Math.PI / 4,
      sectionIndex: 8,
      color,
    });
  }

  addBoxCollider({
    id: 'sec8_truss_base',
    x: 26.0,
    y: 15.50,
    z: -37.2,
    hx: 2.2,
    hy: 0.5,
    hz: 1.7,
    sectionIndex: 8,
    color: 0x29b6f6,
  });

  // 14.04-degree lattice truss ramp climbing +4.00 studs due North (-Z)
  const rampPitch = Math.atan2(4.0, 16.0);
  const rampGroup = new THREE.Group();
  const rampMat = new THREE.MeshStandardMaterial({ color: 0x29b6f6, roughness: 0.38, metalness: 0.12 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xe1f5fe, roughness: 0.45 });
  const deckMesh = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.0, 16.4924), rampMat);
  deckMesh.castShadow = true;
  deckMesh.receiveShadow = true;
  rampGroup.add(deckMesh);
  for (let r = -7.0; r <= 7.0; r += 2.0) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(3.32, 0.14, 0.28), railMat);
    rung.position.set(0, 0.46, r);
    rampGroup.add(rung);
  }
  addBoxCollider({
    id: 'sec8_truss_ramp',
    x: 26.0,
    y: 17.5149,
    z: -46.9213,
    hx: 1.6,
    hy: 0.5,
    hz: 8.2462,
    yaw: 0,
    slopePitch: rampPitch,
    sectionIndex: 8,
    mesh: rampGroup,
  });

  addBoxCollider({
    id: 'sec8_truss_top',
    x: 26.0,
    y: 19.50,
    z: -55.8,
    hx: 1.6,
    hy: 0.5,
    hz: 1.1,
    sectionIndex: 8,
    color: 0x29b6f6,
  });

  // Section 9: Jump-Rope Sweeper Drums (North -Z -> East +X to CP9)
  const sec9Drums = [
    { num: 1, x: 26.0, drumY: 19.75, hubY: 20.50, sweepY: 21.05, z: -79.8, omega:  1.30, phase: 0 },
    { num: 2, x: 26.0, drumY: 20.25, hubY: 21.00, sweepY: 21.55, z: -97.2, omega: -1.30, phase: Math.PI },
  ];
  const pegMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, roughness: 0.35 });
  const pegGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.26, 16);

  for (const d of sec9Drums) {
    const drumGroup = new THREE.Group();
    const drumMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(5.50, 5.50, 1.50, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e64f0, roughness: 0.42 })
    );
    drumMesh.castShadow = true;
    drumMesh.receiveShadow = true;
    drumGroup.add(drumMesh);

    for (const deg of [35, 145, 215, 325]) {
      const rad = (deg * Math.PI) / 180;
      const peg = new THREE.Mesh(pegGeo, pegMat);
      peg.position.set(Math.cos(rad) * 4.5, 0.85, -Math.sin(rad) * 4.5);
      drumGroup.add(peg);
    }

    addCylinderCollider({
      id: `sec9_drum${d.num}`,
      x: d.x,
      y: d.drumY,
      z: d.z,
      radius: 5.50,
      hy: 0.75,
      sectionIndex: 9,
      mesh: drumGroup,
    });

    addCylinderCollider({
      id: `sec9_hub${d.num}`,
      x: d.x,
      y: d.hubY,
      z: d.z,
      radius: 0.85,
      hy: 0.45,
      sectionIndex: 9,
      color: 0xffffff,
    });

    const initTheta = d.phase;
    const initArmX = d.x + 2.60 * Math.cos(initTheta);
    const initArmZ = d.z - 2.60 * Math.sin(initTheta);
    const sweepEntry = addBoxCollider({
      id: `sec9_sweep${d.num}`,
      kind: COLLIDER_KIND.HAZARD,
      x: initArmX,
      y: d.sweepY,
      z: initArmZ,
      hx: 2.40,
      hy: 0.40,
      hz: 0.35,
      yaw: initTheta,
      sectionIndex: 9,
      color: 0xff1744,
    });

    dynamicUpdaters.push((t, zeroDelta) => {
      const theta = d.phase + d.omega * t;
      const nextX = d.x + 2.60 * Math.cos(theta);
      const nextZ = d.z - 2.60 * Math.sin(theta);
      sweepEntry.collider.deltaPosition.x = zeroDelta ? 0 : nextX - sweepEntry.collider.position.x;
      sweepEntry.collider.deltaPosition.y = 0;
      sweepEntry.collider.deltaPosition.z = zeroDelta ? 0 : nextZ - sweepEntry.collider.position.z;
      sweepEntry.collider.deltaYaw = zeroDelta ? 0 : theta - sweepEntry.collider.yaw;
      sweepEntry.collider.position.x = nextX;
      sweepEntry.collider.position.z = nextZ;
      sweepEntry.collider.yaw = theta;
      sweepEntry.mesh.position.set(nextX, d.sweepY, nextZ);
      sweepEntry.mesh.rotation.y = theta;
    });
  }

  addBoxCollider({
    id: 'sec9_bridge',
    x: 26.0,
    y: 20.15,
    z: -88.5,
    hx: 1.80,
    hy: 0.60,
    hz: 1.70,
    sectionIndex: 9,
    color: 0x00e5ff,
  });

  // Section 10: Workshop Summit Finale Climb & FinishGoal
  addBoxCollider({
    id: 'sec10_block1',
    x: 45.0,
    y: 22.10,
    z: -85.0,
    hx: 2.6,
    hy: 0.7,
    hz: 2.6,
    sectionIndex: 10,
    color: 0x69f0ae,
  });
  addBoxCollider({
    id: 'sec10_block2',
    x: 50.5,
    y: 23.40,
    z: -76.2,
    hx: 2.6,
    hy: 0.7,
    hz: 2.6,
    sectionIndex: 10,
    color: 0xb388ff,
  });

  const glideMesh = createGiftPlatformMesh({
    width: 5.8,
    height: 1.4,
    depth: 5.8,
    boxColor: 0xffd54f,
    ribbonColor: 0xfff8e1,
  });
  const glideEntry = addBoxCollider({
    id: 'sec10_gold_glide',
    x: 55.0,
    y: 24.60,
    z: -64.2,
    hx: 2.9,
    hy: 0.7,
    hz: 2.9,
    sectionIndex: 10,
    mesh: glideMesh,
  });
  dynamicUpdaters.push((t, zeroDelta) => {
    const nextZ = -64.2 + 3.0 * Math.sin(1.45 * t);
    glideEntry.collider.deltaPosition.x = 0;
    glideEntry.collider.deltaPosition.y = 0;
    glideEntry.collider.deltaPosition.z = zeroDelta ? 0 : nextZ - glideEntry.collider.position.z;
    glideEntry.collider.deltaYaw = 0;
    glideEntry.collider.position.z = nextZ;
    glideEntry.mesh.position.z = nextZ;
  });

  addCylinderCollider({
    id: 'sec10_disc1',
    x: 59.0,
    y: 25.70,
    z: -53.5,
    radius: 2.70,
    hy: 0.60,
    sectionIndex: 10,
    mesh: createPeppermintDiscMesh({ radius: 2.70, height: 1.20, stripeColor: 0x00e676, baseColor: 0xffffff }),
  });

  addCylinderCollider({
    id: 'sec10_disc2',
    x: 67.8,
    y: 26.60,
    z: -56.0,
    radius: 2.70,
    hy: 0.60,
    sectionIndex: 10,
    mesh: createPeppermintDiscMesh({ radius: 2.70, height: 1.20, stripeColor: 0xffd600, baseColor: 0x00e5ff }),
  });

  // Grand 16x16 Summit Dais
  const daisGroup = new THREE.Group();
  const daisFrame = new THREE.Mesh(
    new THREE.BoxGeometry(16.0, 1.6, 16.0),
    new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.35, metalness: 0.25 })
  );
  daisFrame.castShadow = true;
  daisFrame.receiveShadow = true;
  const daisInner = new THREE.Mesh(
    new THREE.BoxGeometry(14.2, 1.62, 14.2),
    new THREE.MeshStandardMaterial({ color: 0xfffdf7, roughness: 0.45 })
  );
  daisInner.receiveShadow = true;
  daisGroup.add(daisFrame, daisInner);

  addBoxCollider({
    id: 'sec10_dais_solid',
    x: 82.0,
    y: 27.20,
    z: -56.0,
    hx: 8.0,
    hy: 0.8,
    hz: 8.0,
    sectionIndex: 10,
    mesh: daisGroup,
  });

  addCylinderCollider({
    id: 'finish_goal_trigger',
    kind: COLLIDER_KIND.GOAL,
    x: 82.0,
    y: 31.00,
    z: -56.0,
    radius: 5.50,
    hy: 3.00,
    sectionIndex: 10,
  });

  const finishGoal = Object.freeze({
    position: Object.freeze({ x: 82.0, y: 28.0, z: -56.0 }),
    radius: 5.5,
  });

  const summitContraption = createSummitContraptionProp();
  summitContraption.group.position.set(82.0, 28.0, -56.0);
  group.add(summitContraption.group);

  // Decorative Non-Blocking Holiday & Workshop Props
  const decorGroup = new THREE.Group();
  decorGroup.name = 'jollyobby-decor';

  // CP0 rear welcome candy canes & gift
  const caneL = createCandyCaneProp({ height: 4.5, stripeColor: 0x00bfa5 });
  caneL.position.set(-5.0, 0.0, 4.6);
  caneL.rotation.y = 0.3;
  const caneR = createCandyCaneProp({ height: 4.5, stripeColor: 0xff4081 });
  caneR.position.set(5.0, 0.0, 4.6);
  caneR.rotation.y = Math.PI - 0.3;
  const cp0Gift = props.createGiftProp({ size: 1.5, boxColor: 0x29b6f6, ribbonColor: 0xffd600 });
  cp0Gift.position.set(-4.6, 0.0, 3.4);
  decorGroup.add(caneL, caneR, cp0Gift);

  // Scenic West Ice Island beside Section 1
  const westIsland = createSnowballHexMesh({ radius: 9.0, height: 3.5 });
  westIsland.position.set(-18.0, -3.25, -42.0);
  const westTree1 = props.createPineTree({ height: 8.5, foliageColor: 0x0d9488 });
  westTree1.position.set(-20.5, -1.5, -44.5);
  const westTree2 = props.createPineTree({ height: 6.8, foliageColor: 0x03b4ca });
  westTree2.position.set(-16.0, -1.5, -37.5);
  const westSnowman = props.createSnowmanProp({ height: 4.8 });
  westSnowman.position.set(-14.5, -1.5, -42.0); // +X nose faces Section 1
  const westRock = props.createRockProp({ radius: 1.7, variant: 0 });
  westRock.position.set(-21.0, -0.9, -39.0);
  decorGroup.add(westIsland, westTree1, westTree2, westSnowman, westRock);

  // Corner checkpoint trees & gifts (strictly on outer rear corners)
  const cornerPlacements = [
    [-4.8,  11.50, -130.6, 0x0d9488, 0xff4081],
    [123.3, 13.50, -130.6, 0x03b4ca, 0x7c4dff],
    [123.3, 15.00, -20.0,  0x0d9488, 0x00e676],
    [21.2,  20.00, -60.0,  0x03b4ca, 0xffd600],
  ];
  for (const [cx, cy, cz, treeCol, giftCol] of cornerPlacements) {
    const t = props.createPineTree({ height: 5.8, foliageColor: treeCol });
    t.position.set(cx, cy, cz);
    const g = props.createGiftProp({ size: 1.35, boxColor: giftCol, ribbonColor: 0xffffff });
    g.position.set(cx + (cx < 50 ? 1.5 : -1.5), cy, cz);
    decorGroup.add(t, g);
  }

  // Central Courtyard Toy Island (well below Section 10)
  const centerIsland = createSnowballHexMesh({ radius: 10.5, height: 4.0 });
  centerIsland.position.set(62.0, 2.0, -96.0);
  const giantGift = props.createGiftProp({ size: 4.2, boxColor: 0x7c4dff, ribbonColor: 0xffd600 });
  giantGift.position.set(62.0, 4.0, -96.0);
  const centerTree1 = props.createPineTree({ height: 9.2, foliageColor: 0x0d9488 });
  centerTree1.position.set(56.5, 4.0, -99.5);
  const centerTree2 = props.createPineTree({ height: 7.6, foliageColor: 0x03b4ca });
  centerTree2.position.set(67.2, 4.0, -92.5);
  const centerRock = props.createRockProp({ radius: 2.0, variant: 1 });
  centerRock.position.set(65.5, 4.8, -99.8);
  decorGroup.add(centerIsland, giantGift, centerTree1, centerTree2, centerRock);

  // Section 10 Summit Dais Crown (East backdrop + outer corners; West entry kept 100% open)
  const summitArch = props.createArchProp({ width: 14.4, height: 12.0, depth: 3.0, color: 0x80deea });
  summitArch.position.set(88.4, 28.0, -56.0);
  summitArch.rotation.y = Math.PI / 2;
  const sumTreeNE = props.createPineTree({ height: 7.4, foliageColor: 0x0d9488 });
  sumTreeNE.position.set(88.2, 28.0, -62.4);
  const sumTreeSE = props.createPineTree({ height: 7.4, foliageColor: 0x0d9488 });
  sumTreeSE.position.set(88.2, 28.0, -49.6);
  const sumSnowman = props.createSnowmanProp({ height: 4.5 });
  sumSnowman.position.set(76.2, 28.0, -62.4);
  sumSnowman.rotation.y = Math.PI; // Nose faces West toward arriving player
  const sumGift = props.createGiftProp({ size: 1.8, boxColor: 0xff4081, ribbonColor: 0xffd600 });
  sumGift.position.set(76.2, 28.0, -49.6);
  decorGroup.add(summitArch, sumTreeNE, sumTreeSE, sumSnowman, sumGift);

  group.add(decorGroup);

  if (scene) {
    scene.add(group);
  }

  let internalElapsed = 0;

  function setActiveCheckpoint(checkpointIndex) {
    const idx = Math.max(0, Math.min(checkpointControllers.length - 1, Math.floor(checkpointIndex)));
    for (let k = 0; k < checkpointControllers.length; k++) {
      checkpointControllers[k].setActivated(k <= idx);
    }
  }

  function applyKinematicsAtTime(t, zeroDelta) {
    for (let i = 0; i < dynamicUpdaters.length; i++) {
      dynamicUpdaters[i](t, zeroDelta);
    }
    const pulse = 0.40 + 0.20 * Math.sin(t * 4.5);
    for (let i = 0; i < hazardMaterials.length; i++) {
      hazardMaterials[i].emissiveIntensity = pulse;
    }
    summitContraption.starMesh.rotation.y = t * 1.35;
    summitContraption.starMesh.position.y = 4.2 + 0.35 * Math.sin(t * 2.4);
    summitContraption.ring1.rotation.x = 0.65 + t * 1.1;
    summitContraption.ring1.rotation.y = t * 0.85;
    summitContraption.ring2.rotation.x = -0.55 - t * 0.9;
    summitContraption.ring2.rotation.z = t * 1.05;
  }

  function resetCheckpoints() {
    internalElapsed = 0;
    applyKinematicsAtTime(0, true);
    setActiveCheckpoint(0);
  }

  function update(dt, explicitElapsed) {
    const safeDt = Math.max(0, Number(dt) || 0);
    internalElapsed = Number.isFinite(explicitElapsed) ? explicitElapsed : internalElapsed + safeDt;
    applyKinematicsAtTime(internalElapsed, safeDt === 0);
  }

  // Initialize CP0 active & t = 0 kinematics
  resetCheckpoints();

  return Object.freeze({
    group,
    colliders,
    checkpoints,
    finishGoal,
    sectionWaypoints: SECTION_WAYPOINTS,
    setActiveCheckpoint,
    resetCheckpoints,
    update,
  });
}
