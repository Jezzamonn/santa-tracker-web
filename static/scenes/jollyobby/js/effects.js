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
 * Pooled non-text 3D star/confetti particle & shockwave ring effects for Jolly Obby.
 * Strictly zero sprites, zero textures, and zero text (R5).
 */

import * as THREE from 'three';

const POOL_SIZE = 96;
const RING_POOL_SIZE = 4;

// Deterministic LCG so particle bursts behave reproducibly under manual-time tests
function createDeterministicRng(seed = 1234567) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createEffectsManager({ scene, goalPosition = { x: 82.0, y: 28.0, z: -56.0 } } = {}) {
  const group = new THREE.Group();
  group.name = 'jollyobby-effects';

  const octaGeo = new THREE.OctahedronGeometry(0.28, 0);
  const cubeGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  const ringGeo = new THREE.RingGeometry(0.8, 1.15, 32);
  ringGeo.rotateX(-Math.PI / 2);

  const particles = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
      roughness: 0.3,
    });
    const mesh = new THREE.Mesh(i % 2 === 0 ? octaGeo : cubeGeo, mat);
    mesh.visible = false;
    group.add(mesh);
    particles.push({
      mesh,
      mat,
      active: false,
      age: 0,
      ttl: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      gravity: -30,
      spinX: 0,
      spinY: 0,
      baseScale: 1,
    });
  }

  const rings = [];
  for (let i = 0; i < RING_POOL_SIZE; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00e676,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false;
    group.add(mesh);
    rings.push({
      mesh,
      mat,
      active: false,
      age: 0,
      ttl: 0.6,
      maxScale: 5.5,
    });
  }

  if (scene) {
    scene.add(group);
  }

  const rand = createDeterministicRng(20261225);
  let cursor = 0;
  let ringCursor = 0;
  let sparkleAccum = 0;

  function spawnParticle({ x, y, z, vx, vy, vz, colorHex, ttl, gravity = -30, scale = 1 }) {
    const p = particles[cursor];
    cursor = (cursor + 1) % POOL_SIZE;
    p.active = true;
    p.age = 0;
    p.ttl = ttl;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.gravity = gravity;
    p.spinX = (rand() - 0.5) * 10;
    p.spinY = (rand() - 0.5) * 10;
    p.baseScale = scale;
    p.mat.color.setHex(colorHex);
    p.mat.emissive.setHex(colorHex);
    p.mesh.position.set(x, y, z);
    p.mesh.scale.setScalar(scale);
    p.mesh.visible = true;
  }

  function spawnRing({ x, y, z, colorHex, ttl = 0.55, maxScale = 5.5 }) {
    const r = rings[ringCursor];
    ringCursor = (ringCursor + 1) % RING_POOL_SIZE;
    r.active = true;
    r.age = 0;
    r.ttl = ttl;
    r.maxScale = maxScale;
    r.mat.color.setHex(colorHex);
    r.mat.opacity = 0.85;
    r.mesh.position.set(x, y, z);
    r.mesh.scale.setScalar(1.0);
    r.mesh.visible = true;
  }

  function emitCheckpointBurst({ x, y, z }) {
    const palette = [0x00e676, 0xffd600, 0xffffff];
    for (let i = 0; i < 20; i++) {
      const ang = (i / 20) * Math.PI * 2 + rand() * 0.25;
      const spd = 3.2 + rand() * 3.8;
      spawnParticle({
        x,
        y: y + 0.6,
        z,
        vx: Math.cos(ang) * spd,
        vy: 9.5 + rand() * 6.5,
        vz: Math.sin(ang) * spd,
        colorHex: palette[i % palette.length],
        ttl: 0.85,
        gravity: -30,
        scale: 1.05,
      });
    }
    spawnRing({ x, y: y + 0.08, z, colorHex: 0x00e676, ttl: 0.55, maxScale: 5.5 });
  }

  function emitRespawnPop({ x, y, z }) {
    const palette = [0x80d8ff, 0xffffff, 0x40c4ff];
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const spd = 2.4 + rand() * 2.5;
      spawnParticle({
        x,
        y: y + 2.2,
        z,
        vx: Math.cos(ang) * spd,
        vy: 3.5 + rand() * 4.5,
        vz: Math.sin(ang) * spd,
        colorHex: palette[i % palette.length],
        ttl: 0.50,
        gravity: -18,
        scale: 0.9,
      });
    }
  }

  function emitGoalCelebration({ x, y, z }) {
    const palette = [0xffd700, 0x00e676, 0x00e5ff, 0xff4081, 0x7c4dff];
    for (let i = 0; i < 48; i++) {
      const ang = (i / 48) * Math.PI * 2 + rand() * 0.3;
      const spd = 4.0 + rand() * 6.5;
      spawnParticle({
        x,
        y: y + 1.0,
        z,
        vx: Math.cos(ang) * spd,
        vy: 14.0 + rand() * 12.0,
        vz: Math.sin(ang) * spd,
        colorHex: palette[i % palette.length],
        ttl: 1.80,
        gravity: -26,
        scale: 1.25,
      });
    }
    spawnRing({ x, y: y + 0.10, z, colorHex: 0xffd700, ttl: 0.75, maxScale: 7.5 });
    spawnRing({ x, y: y + 0.14, z, colorHex: 0x00e5ff, ttl: 0.95, maxScale: 8.5 });
  }

  function emitAmbientSparkle({ x, y, z }) {
    const ang = rand() * Math.PI * 2;
    const r = 1.5 + rand() * 3.2;
    spawnParticle({
      x: x + Math.cos(ang) * r,
      y: y + 0.4 + rand() * 1.2,
      z: z + Math.sin(ang) * r,
      vx: (rand() - 0.5) * 0.8,
      vy: 2.8 + rand() * 1.2,
      vz: (rand() - 0.5) * 0.8,
      colorHex: 0xffd700,
      ttl: 1.35,
      gravity: 0,
      scale: 0.65,
    });
  }

  function update(dt) {
    const safeDt = Math.max(0, Number(dt) || 0);
    if (safeDt === 0) return;

    sparkleAccum += safeDt;
    while (sparkleAccum >= 0.16) {
      sparkleAccum -= 0.16;
      if (goalPosition) {
        emitAmbientSparkle(goalPosition);
      }
    }

    for (let i = 0; i < POOL_SIZE; i++) {
      const p = particles[i];
      if (!p.active) continue;
      p.age += safeDt;
      if (p.age >= p.ttl) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vy += p.gravity * safeDt;
      p.mesh.position.x += p.vx * safeDt;
      p.mesh.position.y += p.vy * safeDt;
      p.mesh.position.z += p.vz * safeDt;
      p.mesh.rotation.x += p.spinX * safeDt;
      p.mesh.rotation.y += p.spinY * safeDt;

      const lifeFrac = p.age / p.ttl;
      const shrink = lifeFrac > 0.65 ? (1 - lifeFrac) / 0.35 : 1.0;
      p.mesh.scale.setScalar(Math.max(0.01, p.baseScale * shrink));
    }

    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const r = rings[i];
      if (!r.active) continue;
      r.age += safeDt;
      if (r.age >= r.ttl) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const t = r.age / r.ttl;
      r.mesh.scale.setScalar(1.0 + (r.maxScale - 1.0) * t);
      r.mat.opacity = 0.85 * (1 - t);
    }
  }

  function reset() {
    sparkleAccum = 0;
    for (const p of particles) {
      p.active = false;
      p.mesh.visible = false;
    }
    for (const r of rings) {
      r.active = false;
      r.mesh.visible = false;
    }
  }

  function getActiveCount() {
    let n = 0;
    for (const p of particles) {
      if (p.active) n += 1;
    }
    return n;
  }

  function dispose() {
    reset();
    if (scene) {
      scene.remove(group);
    }
    octaGeo.dispose();
    cubeGeo.dispose();
    ringGeo.dispose();
    for (const p of particles) p.mat.dispose();
    for (const r of rings) r.mat.dispose();
  }

  return Object.freeze({
    group,
    emitCheckpointBurst,
    emitRespawnPop,
    emitGoalCelebration,
    emitAmbientSparkle,
    update,
    reset,
    getActiveCount,
    dispose,
  });
}
