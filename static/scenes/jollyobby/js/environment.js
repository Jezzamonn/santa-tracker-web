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
 * Holiday daylight, sky gradient dome, Snowbox cubemap horizon, and drifting
 * low-poly clouds for Jolly Obby. Strictly zero text or UI elements (R5).
 */

import * as THREE from 'three';

const SKY_VERTEX_SHADER = `
  varying vec3 vLocalPos;
  void main() {
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = `
  varying vec3 vLocalPos;
  void main() {
    float h = normalize(vLocalPos).y;
    vec3 horizon = vec3(0.784, 0.953, 1.000);
    vec3 midSky  = vec3(0.486, 0.784, 0.973);
    vec3 zenith  = vec3(0.231, 0.510, 0.863);
    vec3 nadir   = vec3(0.620, 0.898, 0.976);

    vec3 col;
    if (h >= 0.0) {
      float t1 = smoothstep(0.0, 0.35, h);
      float t2 = smoothstep(0.30, 0.90, h);
      col = mix(horizon, midSky, t1);
      col = mix(col, zenith, t2);
    } else {
      col = mix(horizon, nadir, smoothstep(0.0, -0.5, h));
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createEnvironment({
  scene,
  skyboxBasePath = '../snowbox/img/skybox_v09/',
  enableCubemapLoad = typeof document !== 'undefined' && typeof Image !== 'undefined',
} = {}) {
  const group = new THREE.Group();
  group.name = 'jollyobby-environment';

  if (scene) {
    scene.background = new THREE.Color(0x7cc8f8);
    scene.fog = new THREE.FogExp2(0xb8ecfa, 0.0014);
  }

  // Inverted sky gradient dome (renders immediately on frame 0 and in offline/headless runs)
  const skyGeo = new THREE.SphereGeometry(420, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = 'jollyobby-sky-dome';
  skyDome.position.set(58, 10, -64);
  skyDome.renderOrder = -10;
  group.add(skyDome);

  // Optional Snowbox skybox_v09 cubemap backdrop (6 verified text-free winter faces)
  let cubeTexture = null;
  if (scene && skyboxBasePath && enableCubemapLoad) {
    try {
      const loader = new THREE.CubeTextureLoader();
      loader.setPath(skyboxBasePath);
      loader.load(
        ['xpos.jpg', 'xneg.jpg', 'ypos.jpg', 'yneg.jpg', 'zpos.jpg', 'zneg.jpg'],
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          cubeTexture = tex;
          scene.background = tex;
          // Hide opaque skyDome once cubemap loads so winter mountain horizon shows through
          skyDome.visible = false;
        },
        undefined,
        () => {
          // Keep procedural skyDome active if cubemap load is unavailable
        }
      );
    } catch (_) {
      // Keep procedural skyDome active
    }
  }

  // Bright Santa Tracker daylight rig (crisp top-vs-side face contrast)
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x7ec8e3, 0.90);
  hemiLight.position.set(0, 120, 0);
  group.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfffdf2, 1.10);
  sunLight.position.set(115, 150, 65);
  sunLight.target.position.set(58, 12, -64);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 20;
  sunLight.shadow.camera.far = 340;
  sunLight.shadow.camera.left = -95;
  sunLight.shadow.camera.right = 95;
  sunLight.shadow.camera.top = 95;
  sunLight.shadow.camera.bottom = -95;
  sunLight.shadow.bias = -0.0004;
  group.add(sunLight);
  group.add(sunLight.target);

  const fillLight = new THREE.DirectionalLight(0xd8f0ff, 0.35);
  fillLight.position.set(-65, 60, -145);
  group.add(fillLight);

  // Low-poly drifting clouds outside the playable perimeter
  const cloudPuffGeo = new THREE.IcosahedronGeometry(1.0, 1);
  const cloudMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
  });

  const clouds = [];
  const cloudCount = 14;
  for (let i = 0; i < cloudCount; i++) {
    const cloud = new THREE.Group();
    const baseAngle = (i / cloudCount) * Math.PI * 2;
    const orbitRadius = 112 + (i % 3) * 16;
    const baseY = -4 + (i % 5) * 9.5;
    const scale = 1.0 + (i % 3) * 0.28;

    const puffs = [
      [0, 0, 0, 3.6],
      [-2.8, -0.4, 0.4, 2.7],
      [2.9, -0.3, -0.3, 2.8],
      [0.6, 1.1, 0.8, 2.3],
    ];
    for (const [px, py, pz, pr] of puffs) {
      const m = new THREE.Mesh(cloudPuffGeo, cloudMat);
      m.position.set(px, py, pz);
      m.scale.set(pr, pr * 0.68, pr * 0.85);
      cloud.add(m);
    }
    cloud.scale.setScalar(scale);
    const x = 58 + Math.cos(baseAngle) * orbitRadius;
    const z = -64 + Math.sin(baseAngle) * orbitRadius;
    cloud.position.set(x, baseY, z);
    cloud.rotation.y = -baseAngle;
    group.add(cloud);
    clouds.push({ mesh: cloud, baseAngle, orbitRadius, baseY, phase: i * 0.9 });
  }

  if (scene) {
    scene.add(group);
  }

  let internalElapsed = 0;
  function update(dt, explicitElapsed) {
    const safeDt = Math.max(0, Number(dt) || 0);
    internalElapsed = Number.isFinite(explicitElapsed) ? explicitElapsed : internalElapsed + safeDt;

    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i];
      const ang = c.baseAngle + internalElapsed * 0.012;
      c.mesh.position.set(
        58 + Math.cos(ang) * c.orbitRadius,
        c.baseY + Math.sin(internalElapsed * 0.6 + c.phase) * 0.45,
        -64 + Math.sin(ang) * c.orbitRadius
      );
    }
  }

  function dispose() {
    if (scene) {
      scene.remove(group);
    }
    skyGeo.dispose();
    skyMat.dispose();
    cloudPuffGeo.dispose();
    cloudMat.dispose();
    if (cubeTexture) {
      cubeTexture.dispose();
    }
  }

  return Object.freeze({
    group,
    skyDome,
    sunLight,
    hemiLight,
    update,
    dispose,
  });
}
