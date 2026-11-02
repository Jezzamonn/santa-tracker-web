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
 * Rigged Snowball 3D Elf Avatar + Procedural Airborne Pose + Analytical Contact Blob Shadow.
 * Zero missing-clip console warnings; zero CanvasRenderingContext2D text calls (R5).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { COLLIDER_KIND } from './constants.js';

const ELF_UNIFORM_SCALE = 0.80;
const ELF_SOLE_Y_OFFSET = 0.04; // Places minY (-0.0505 * 0.80) flush at y = 0.000
const SHADOW_RADIUS = 1.1;
const SHADOW_MAX_DROP = 16.0;

const PROCEDURAL_BONE_NAMES = [
  'elf_rig_upper_armL',
  'elf_rig_upper_armR',
  'elf_rig_forearmL',
  'elf_rig_forearmR',
  'elf_rig_thighL',
  'elf_rig_thighR',
  'elf_rig_shinL',
  'elf_rig_shinR',
];

function createSoftShadowDataTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - half) / half;
      const ny = (y - half) / half;
      const rSq = nx * nx + ny * ny;
      const falloff = rSq >= 1 ? 0 : (1 - rSq) * (1 - rSq);
      const idx = (y * size + x) * 4;
      data[idx] = 12;
      data[idx + 1] = 22;
      data[idx + 2] = 42;
      data[idx + 3] = Math.round(255 * falloff);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function findHighestSurfaceBelow(px, py, pz, colliders) {
  let bestY = -Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const col = colliders[i];
    if (col.kind !== COLLIDER_KIND.SOLID && col.kind !== COLLIDER_KIND.HAZARD) continue;

    if (col.shape === 'cylinder') {
      const topY = col.position.y + col.hy;
      if (topY > py + 0.25 || py - topY > SHADOW_MAX_DROP) continue;
      const dx = px - col.position.x;
      const dz = pz - col.position.z;
      if (dx * dx + dz * dz <= col.radius * col.radius) {
        if (topY > bestY) bestY = topY;
      }
    } else {
      const { hx, hy, hz } = col.halfExtents;
      const yaw = col.yaw || 0;
      const pitch = col.slopePitch || 0;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const dx = px - col.position.x;
      const dz = pz - col.position.z;
      const ux = dx * cy - dz * sy;
      const uz = dx * sy + dz * cy;
      if (Math.abs(ux) > hx) continue;

      if (Math.abs(pitch) < 1e-6) {
        if (Math.abs(uz) > hz) continue;
        const topY = col.position.y + hy;
        if (topY <= py + 0.25 && py - topY <= SHADOW_MAX_DROP && topY > bestY) {
          bestY = topY;
        }
      } else {
        const cp = Math.cos(pitch);
        const sp = Math.sin(pitch);
        const lzTop = (uz - hy * sp) / cp;
        if (Math.abs(lzTop) > hz) continue;
        const topY = col.position.y + hy * cp - lzTop * sp;
        if (topY <= py + 0.25 && py - topY <= SHADOW_MAX_DROP && topY > bestY) {
          bestY = topY;
        }
      }
    }
  }
  return bestY;
}

export async function loadElfPlayer({
  scene,
  gltfUrl = '../snowball/models/elf-animated.gltf',
  gltf: preloadedGltf = null,
  loader = null,
} = {}) {
  const gltf = preloadedGltf || await (loader || new GLTFLoader()).loadAsync(gltfUrl);

  const root = new THREE.Group();
  root.name = 'jollyobby-elf-player';

  const elfVisual = SkeletonUtils.clone(gltf.scene);
  elfVisual.scale.setScalar(ELF_UNIFORM_SCALE);
  elfVisual.position.set(0, ELF_SOLE_Y_OFFSET, 0);
  // elf-animated.gltf faces model +Z; rotating by PI aligns avatar local -Z with facingYaw = 0 (North).
  elfVisual.rotation.set(0, Math.PI, 0);

  elfVisual.traverse((child) => {
    if (child.isMesh || child.isSkinnedMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;
    }
  });
  root.add(elfVisual);

  const bones = {};
  elfVisual.traverse((obj) => {
    if (obj.isBone) {
      bones[obj.name] = obj;
    }
  });

  const postMixerQuats = {};
  for (const name of PROCEDURAL_BONE_NAMES) {
    if (bones[name]) {
      postMixerQuats[name] = bones[name].quaternion.clone();
    }
  }

  const mixer = new THREE.AnimationMixer(elfVisual);
  const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'elf_rig_idle');
  const runClip = THREE.AnimationClip.findByName(gltf.animations, 'elf_rig_running');
  const celebrateClip = THREE.AnimationClip.findByName(gltf.animations, 'elf_rig_throw');

  const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
  const runAction = runClip ? mixer.clipAction(runClip) : null;
  const celebrateAction = celebrateClip ? mixer.clipAction(celebrateClip) : null;

  let activeBaseClip = '';
  let animState = 'idle';
  let isCelebrating = false;
  let airBlend = 0;
  let airElapsed = 0;

  function activateBaseAction(nextName) {
    if (activeBaseClip === nextName) return;
    const prevAction =
      activeBaseClip === 'idle' ? idleAction :
      activeBaseClip === 'run' ? runAction :
      activeBaseClip === 'celebrate' ? celebrateAction : null;
    const nextAction =
      nextName === 'idle' ? idleAction :
      nextName === 'run' ? runAction :
      nextName === 'celebrate' ? celebrateAction : null;

    if (nextAction) {
      nextAction.enabled = true;
      nextAction.setEffectiveTimeScale(1.0);
      nextAction.setEffectiveWeight(1.0);
      if (prevAction && prevAction !== nextAction) {
        nextAction.reset().play();
        prevAction.crossFadeTo(nextAction, 0.12, false);
      } else {
        nextAction.reset().play();
      }
    }
    activeBaseClip = nextName;
  }

  activateBaseAction('idle');

  const shadowTexture = createSoftShadowDataTexture(64);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const shadowGeometry = new THREE.CircleGeometry(SHADOW_RADIUS, 24);
  const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadowMesh.name = 'jollyobby-player-shadow';
  shadowMesh.rotation.x = -Math.PI / 2;

  if (scene) {
    scene.add(root);
    scene.add(shadowMesh);
  }

  function cachePostMixerQuats() {
    for (const name of PROCEDURAL_BONE_NAMES) {
      if (bones[name]) {
        postMixerQuats[name].copy(bones[name].quaternion);
      }
    }
  }

  function restorePostMixerQuats() {
    for (const name of PROCEDURAL_BONE_NAMES) {
      if (bones[name]) {
        bones[name].quaternion.copy(postMixerQuats[name]);
      }
    }
  }

  function triggerCelebrate() {
    isCelebrating = true;
    airBlend = 0;
    animState = 'celebrate';
    activateBaseAction('celebrate');
  }

  function resetPose() {
    isCelebrating = false;
    airBlend = 0;
    airElapsed = 0;
    animState = 'idle';
    mixer.stopAllAction();
    activeBaseClip = '';
    activateBaseAction('idle');
    mixer.update(1 / 120);
    cachePostMixerQuats();
  }

  function update(dt, physicsResult, options = {}, colliders = []) {
    const safeDt = Math.max(0, Number(dt) || 0);
    const celebrating = Boolean(options.celebrating) || isCelebrating;
    if (celebrating && !isCelebrating) {
      triggerCelebrate();
    }

    const pos = physicsResult?.position || { x: 0, y: 0, z: 0 };
    const vel = physicsResult?.velocity || { x: 0, y: 0, z: 0 };
    const grounded = physicsResult?.grounded ?? true;
    const facingYaw = physicsResult?.facingYaw ?? 0;
    const speedXZ = Math.hypot(vel.x || 0, vel.z || 0);

    root.position.set(pos.x, pos.y, pos.z);
    root.rotation.y = facingYaw;

    if (celebrating) {
      animState = 'celebrate';
      activateBaseAction('celebrate');
      airBlend = 0;
      airElapsed = 0;
      if (celebrateAction) celebrateAction.setEffectiveTimeScale(1.15);
    } else if (!grounded) {
      animState = 'jump';
      activateBaseAction('run');
      airElapsed += safeDt;
      airBlend = safeDt > 0 ? airBlend + (1 - airBlend) * (1 - Math.exp(-18 * safeDt)) : 1;
      if (runAction) {
        runAction.setEffectiveTimeScale(0);
        runAction.time = 0.1667 + 0.03 * Math.sin(airElapsed * 7.5);
      }
    } else if (speedXZ > 0.6) {
      animState = 'run';
      activateBaseAction('run');
      airElapsed = 0;
      airBlend = safeDt > 0 ? airBlend * Math.exp(-20 * safeDt) : 0;
      if (runAction) {
        const speedRatio = Math.max(0.55, Math.min(1.35, (speedXZ / 16.0) * 1.25));
        runAction.setEffectiveTimeScale(speedRatio);
      }
    } else {
      animState = 'idle';
      activateBaseAction('idle');
      airElapsed = 0;
      airBlend = safeDt > 0 ? airBlend * Math.exp(-20 * safeDt) : 0;
    }

    // Undo last frame's procedural airborne offsets before sampling the mixer.
    // three.js PropertyMixer only writes a bone when its sampled value changes,
    // so while the run clip is frozen mid-air (timeScale 0) it can skip bones
    // and the offsets would otherwise compound every frame (spinning legs).
    restorePostMixerQuats();
    if (safeDt > 0) {
      mixer.update(safeDt);
      cachePostMixerQuats();
    }

    // Post-mixer joyful airborne leap/glide pose (idempotent even when dt === 0)
    if (airBlend > 0.005 && !celebrating) {
      const rise = Math.max(-1, Math.min(1, (vel.y || 0) / 52.0));
      const armLift = (0.85 + 0.20 * rise) * airBlend;
      bones.elf_rig_upper_armL?.rotateZ(+armLift);
      bones.elf_rig_upper_armR?.rotateZ(-armLift);
      bones.elf_rig_forearmL?.rotateX(0.25 * airBlend);
      bones.elf_rig_forearmR?.rotateX(0.25 * airBlend);

      bones.elf_rig_thighL?.rotateX((-0.25 - 0.10 * rise) * airBlend);
      bones.elf_rig_shinL?.rotateX(0.25 * airBlend);
      bones.elf_rig_thighR?.rotateX((0.15 - 0.15 * rise) * airBlend);
      bones.elf_rig_shinR?.rotateX(0.45 * airBlend);
    }

    // Update downward analytical contact shadow disc
    const surfY = findHighestSurfaceBelow(pos.x, pos.y, pos.z, colliders);
    if (Number.isFinite(surfY)) {
      const heightAbove = Math.max(0, pos.y - surfY);
      const fade = Math.max(0, 1 - heightAbove / SHADOW_MAX_DROP);
      shadowMesh.visible = fade > 0.02;
      shadowMesh.position.set(pos.x, surfY + 0.03, pos.z);
      shadowMesh.scale.setScalar(1.0 - 0.35 * (1 - fade));
      shadowMaterial.opacity = 0.36 * fade;
    } else {
      shadowMesh.visible = false;
    }
  }

  function getAnimState() {
    return animState;
  }

  function dispose() {
    mixer.stopAllAction();
    if (scene) {
      scene.remove(root);
      scene.remove(shadowMesh);
    }
    shadowGeometry.dispose();
    shadowMaterial.dispose();
    shadowTexture.dispose();
  }

  return Object.freeze({
    root,
    shadowMesh,
    update,
    triggerCelebrate,
    resetPose,
    getAnimState,
    dispose,
  });
}
