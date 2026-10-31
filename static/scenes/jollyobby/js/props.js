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
 * 3D Holiday & Obby Prop Factory for Jolly Obby.
 * Loads normalized Snowbox `.obj` models (`pine-tree.obj`, `gift.obj`, `arch.obj`,
 * `snowman.obj`, `mountain/rock_01.obj`, `rock_02.obj`) with automatic procedural
 * fallbacks, alongside Snowball-inspired hexagonal snow prisms, cross-ribbon gift
 * platforms, peppermint/starburst discs, 3D chevron checkpoint pads, candy canes,
 * and the Section 10 Golden Summit Star contraption.
 *
 * Uses pure `Uint8Array` `THREE.DataTexture`s — strictly ZERO `CanvasRenderingContext2D`
 * calls and ZERO text/glyphs anywhere (R5).
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

function hexToRgbBytes(hex) {
  const c = new THREE.Color(hex);
  const srgb = {};
  c.getRGB(srgb, THREE.SRGBColorSpace);
  return [
    Math.round(Math.max(0, Math.min(1, srgb.r)) * 255),
    Math.round(Math.max(0, Math.min(1, srgb.g)) * 255),
    Math.round(Math.max(0, Math.min(1, srgb.b)) * 255),
  ];
}

export function createCrossRibbonDataTexture(boxColorHex, ribbonColorHex, size = 128) {
  const [br, bg, bb] = hexToRgbBytes(boxColorHex);
  const [rr, rg, rb] = hexToRgbBytes(ribbonColorHex);
  const data = new Uint8Array(size * size * 4);
  const bandMin = Math.floor(size * 0.41);
  const bandMax = Math.ceil(size * 0.59);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isRibbon = (x >= bandMin && x <= bandMax) || (y >= bandMin && y <= bandMax);
      const isBorder = x < 3 || x >= size - 3 || y < 3 || y >= size - 3;
      const idx = (y * size + x) * 4;
      if (isRibbon || isBorder) {
        data[idx] = rr;
        data[idx + 1] = rg;
        data[idx + 2] = rb;
      } else {
        data[idx] = br;
        data[idx + 1] = bg;
        data[idx + 2] = bb;
      }
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createRadialWedgeDataTexture(stripeColorHex, baseColorHex = 0xffffff, wedges = 12, size = 128) {
  const [sr, sg, sb] = hexToRgbBytes(stripeColorHex);
  const [br, bg, bb] = hexToRgbBytes(baseColorHex);
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx) + Math.PI + r * 0.45;
      const sector = Math.floor((ang / (Math.PI * 2)) * wedges) % wedges;
      const useStripe = sector % 2 === 0 || r > 0.90;
      const idx = (y * size + x) * 4;
      data[idx] = useStripe ? sr : br;
      data[idx + 1] = useStripe ? sg : bg;
      data[idx + 2] = useStripe ? sb : bb;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createDiagonalStripeDataTexture(stripeColorHex, baseColorHex = 0xffffff, size = 64) {
  const [sr, sg, sb] = hexToRgbBytes(stripeColorHex);
  const [br, bg, bb] = hexToRgbBytes(baseColorHex);
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const stripe = ((x + y * 2) % 16) < 8;
      const idx = (y * size + x) * 4;
      data[idx] = stripe ? sr : br;
      data[idx + 1] = stripe ? sg : bg;
      data[idx + 2] = stripe ? sb : bb;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 4);
  tex.needsUpdate = true;
  return tex;
}

export function createSnowballHexMesh({ radius = 4.0, height = 2.2 } = {}) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 6);
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x9ce5f8, roughness: 0.45, metalness: 0.05 });
  const topMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.0 });
  const botMat = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.55, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, [sideMat, topMat, botMat]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createGiftPlatformMesh({
  width = 6.0,
  height = 1.6,
  depth = 6.0,
  boxColor = 0x00c853,
  ribbonColor = 0xffd600,
} = {}) {
  const tex = createCrossRibbonDataTexture(boxColor, ribbonColor, 128);
  const geo = new THREE.BoxGeometry(width, height, depth);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: 0.42,
    metalness: 0.06,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createPeppermintDiscMesh({
  radius = 2.6,
  height = 1.1,
  stripeColor = 0xff4081,
  baseColor = 0xffffff,
  solidColor = null,
  hasHazardDot = false,
  dotRadius = 0.80,
} = {}) {
  const group = new THREE.Group();
  const discGeo = new THREE.CylinderGeometry(radius, radius, height, 32);

  let topMat;
  let sideMat;
  if (solidColor !== null) {
    topMat = new THREE.MeshStandardMaterial({ color: solidColor, roughness: 0.38, metalness: 0.06 });
    sideMat = new THREE.MeshStandardMaterial({ color: solidColor, roughness: 0.48, metalness: 0.06 });
  } else {
    const tex = createRadialWedgeDataTexture(stripeColor, baseColor, 12, 128);
    topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.38, metalness: 0.05 });
    sideMat = new THREE.MeshStandardMaterial({ color: stripeColor, roughness: 0.48, metalness: 0.05 });
  }

  const disc = new THREE.Mesh(discGeo, [sideMat, topMat, sideMat]);
  disc.castShadow = true;
  disc.receiveShadow = true;
  group.add(disc);

  if (hasHazardDot) {
    const dotGeo = new THREE.CylinderGeometry(dotRadius, dotRadius, height + 0.28, 24);
    const dotMat = new THREE.MeshStandardMaterial({
      color: 0xff1744,
      emissive: 0xc6002b,
      emissiveIntensity: 0.45,
      roughness: 0.28,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.y = 0.07;
    dot.userData.isHazardPulse = true;
    group.add(dot);
  }

  return group;
}

export function createCheckpointPadMesh({ arrowYaw = 0 } = {}) {
  const group = new THREE.Group();

  // Outer 12x1.2x12 slate-silver frame
  const frameGeo = new THREE.BoxGeometry(12.0, 1.2, 12.0);
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x78909c,
    roughness: 0.48,
    metalness: 0.12,
  });
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  group.add(frameMesh);

  // Flush inner 10.2x1.22x10.2 pad
  const innerGeo = new THREE.BoxGeometry(10.2, 1.22, 10.2);
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0xf4f8fb,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    roughness: 0.42,
    metalness: 0.05,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.receiveShadow = true;
  group.add(innerMesh);

  // Purely geometric 3D directional arrow inlay (zero text; points local -Z when arrowYaw === 0)
  const arrowGroup = new THREE.Group();
  arrowGroup.rotation.y = arrowYaw;

  const arrowMat = new THREE.MeshStandardMaterial({
    color: 0xff9100, // Warm coral-amber when unvisited (never crimson hazard #FF1744)
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    roughness: 0.35,
  });

  const stemGeo = new THREE.BoxGeometry(1.1, 0.03, 3.0);
  const stemMesh = new THREE.Mesh(stemGeo, arrowMat);
  stemMesh.position.set(0, 0.62, 1.1);
  arrowGroup.add(stemMesh);

  const headShape = new THREE.Shape();
  headShape.moveTo(-2.2, -0.4);
  headShape.lineTo(2.2, -0.4);
  headShape.lineTo(0, 2.5);
  headShape.closePath();
  const headGeo = new THREE.ExtrudeGeometry(headShape, { depth: 0.03, bevelEnabled: false });
  // Rotate so shape +Y points along local -Z
  headGeo.rotateX(-Math.PI / 2);
  const headMesh = new THREE.Mesh(headGeo, arrowMat);
  headMesh.position.set(0, 0.605, -0.4);
  arrowGroup.add(headMesh);

  // Rear-corner festive beacon posts (clear of forward takeoff edge)
  const postGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.6, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x546e7a, roughness: 0.5 });
  const beaconGeo = new THREE.OctahedronGeometry(0.42, 0);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xb0bec5,
    emissive: 0x000000,
    emissiveIntensity: 0.0,
    roughness: 0.25,
  });

  for (const sx of [-5.1, 5.1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(sx, 1.4, 5.1);
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(sx, 2.45, 5.1);
    arrowGroup.add(post, beacon);
  }

  group.add(arrowGroup);

  function setActivated(active) {
    if (active) {
      innerMat.color.setHex(0x00e676);
      innerMat.emissive.setHex(0x00a152);
      innerMat.emissiveIntensity = 0.28;
      arrowMat.color.setHex(0xffffff);
      arrowMat.emissive.setHex(0x80cbc4);
      arrowMat.emissiveIntensity = 0.20;
      beaconMat.color.setHex(0x00e676);
      beaconMat.emissive.setHex(0x00e676);
      beaconMat.emissiveIntensity = 0.55;
    } else {
      innerMat.color.setHex(0xf4f8fb);
      innerMat.emissive.setHex(0x000000);
      innerMat.emissiveIntensity = 0.0;
      arrowMat.color.setHex(0xff9100);
      arrowMat.emissive.setHex(0x000000);
      arrowMat.emissiveIntensity = 0.0;
      beaconMat.color.setHex(0xb0bec5);
      beaconMat.emissive.setHex(0x000000);
      beaconMat.emissiveIntensity = 0.0;
    }
  }

  return { group, setActivated };
}

export function createCandyCaneProp({ height = 4.8, radius = 0.26, stripeColor = 0x00bfa5 } = {}) {
  const s = height / 5.0;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 3.8 * s, 0),
    new THREE.Vector3(0.32 * s, 4.9 * s, 0),
    new THREE.Vector3(1.22 * s, 5.05 * s, 0),
    new THREE.Vector3(1.75 * s, 4.25 * s, 0),
  ]);
  const geo = new THREE.TubeGeometry(curve, 24, radius, 12, false);
  const tex = createDiagonalStripeDataTexture(stripeColor, 0xffffff, 64);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

export function createSummitContraptionProp() {
  const group = new THREE.Group();
  group.name = 'jollyobby-summit-contraption';

  // Pedestal ring on Dais
  const pedGeo = new THREE.CylinderGeometry(2.6, 3.1, 0.45, 24);
  const pedMat = new THREE.MeshStandardMaterial({ color: 0xffd54f, roughness: 0.32, metalness: 0.35 });
  const ped = new THREE.Mesh(pedGeo, pedMat);
  ped.position.y = 0.225;
  ped.receiveShadow = true;
  group.add(ped);

  // Extruded 3D 5-point Golden Star (pure polygon geometry, zero text)
  const starShape = new THREE.Shape();
  const outerR = 2.35;
  const innerR = 1.02;
  for (let i = 0; i < 10; i++) {
    const ang = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    if (i === 0) starShape.moveTo(x, y);
    else starShape.lineTo(x, y);
  }
  starShape.closePath();

  const starGeo = new THREE.ExtrudeGeometry(starShape, {
    depth: 0.62,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.10,
    bevelThickness: 0.12,
  });
  starGeo.center();
  const starMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    emissive: 0xffa000,
    emissiveIntensity: 0.38,
    roughness: 0.22,
    metalness: 0.45,
  });
  const starMesh = new THREE.Mesh(starGeo, starMat);
  starMesh.position.set(0, 4.2, 0);
  starMesh.castShadow = true;
  group.add(starMesh);

  // Two counter-rotating Workshop Un-Shrink Gyroscope Rings
  const ring1Geo = new THREE.TorusGeometry(3.15, 0.13, 12, 48);
  const ring1Mat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x00acc1,
    emissiveIntensity: 0.32,
    roughness: 0.28,
    metalness: 0.3,
  });
  const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
  ring1.position.set(0, 4.2, 0);
  group.add(ring1);

  const ring2Geo = new THREE.TorusGeometry(3.68, 0.11, 12, 48);
  const ring2Mat = new THREE.MeshStandardMaterial({
    color: 0xffd600,
    emissive: 0xffab00,
    emissiveIntensity: 0.25,
    roughness: 0.30,
    metalness: 0.35,
  });
  const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
  ring2.position.set(0, 4.2, 0);
  group.add(ring2);

  return { group, starMesh, ring1, ring2 };
}

function buildFallbackFactory(parsedTemplates = {}) {
  function createPineTree({ height = 7.0, foliageColor = 0x0d9488 } = {}) {
    const group = new THREE.Group();
    const foliageMat = new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.65 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4438, roughness: 0.85 });

    if (parsedTemplates.pineTree) {
      const { foliageGeo, trunkGeo } = parsedTemplates.pineTree;
      const foliage = new THREE.Mesh(foliageGeo, foliageMat);
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      foliage.castShadow = true;
      trunk.castShadow = true;
      group.add(foliage, trunk);
      group.scale.setScalar(height);
      return group;
    }

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * height, 0.16 * height, 0.26 * height, 8), trunkMat);
    trunk.position.y = 0.13 * height;
    const cone1 = new THREE.Mesh(new THREE.ConeGeometry(0.38 * height, 0.52 * height, 8), foliageMat);
    cone1.position.y = 0.46 * height;
    const cone2 = new THREE.Mesh(new THREE.ConeGeometry(0.28 * height, 0.44 * height, 8), foliageMat);
    cone2.position.y = 0.76 * height;
    group.add(trunk, cone1, cone2);
    return group;
  }

  function createGiftProp({ size = 1.8, boxColor = 0x7c4dff, ribbonColor = 0xffd600 } = {}) {
    const group = new THREE.Group();
    const boxMat = new THREE.MeshStandardMaterial({ color: boxColor, roughness: 0.45 });
    const ribMat = new THREE.MeshStandardMaterial({ color: ribbonColor, roughness: 0.35 });

    if (parsedTemplates.gift) {
      for (const ribGeo of parsedTemplates.gift.ribbonGeos) {
        const m = new THREE.Mesh(ribGeo, ribMat);
        m.castShadow = true;
        group.add(m);
      }
      if (parsedTemplates.gift.boxGeo) {
        const b = new THREE.Mesh(parsedTemplates.gift.boxGeo, boxMat);
        b.castShadow = true;
        group.add(b);
      }
      group.scale.setScalar(size);
      return group;
    }

    const box = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), boxMat);
    box.position.y = size * 0.5;
    const r1 = new THREE.Mesh(new THREE.BoxGeometry(size * 1.03, size * 1.03, size * 0.22), ribMat);
    r1.position.y = size * 0.5;
    const r2 = new THREE.Mesh(new THREE.BoxGeometry(size * 0.22, size * 1.03, size * 1.03), ribMat);
    r2.position.y = size * 0.5;
    group.add(box, r1, r2);
    return group;
  }

  function createArchProp({ width = 14.4, height = 12.0, depth = 3.0, color = 0x80deea } = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.1 });
    if (parsedTemplates.archGeo) {
      const m = new THREE.Mesh(parsedTemplates.archGeo, mat);
      m.scale.set(width / 400.0, height / 200.0, depth / 200.0);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    }

    const group = new THREE.Group();
    const pillarGeo = new THREE.BoxGeometry(width * 0.22, height, depth);
    const left = new THREE.Mesh(pillarGeo, mat);
    left.position.set(-width * 0.39, height * 0.5, 0);
    const right = new THREE.Mesh(pillarGeo, mat);
    right.position.set(width * 0.39, height * 0.5, 0);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(width, height * 0.28, depth), mat);
    lintel.position.set(0, height * 0.86, 0);
    group.add(left, right, lintel);
    return group;
  }

  function createSnowmanProp({ height = 4.6 } = {}) {
    const group = new THREE.Group();
    const s = height / 4.6;
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 });
    const coalMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.5 });
    const carrotMat = new THREE.MeshStandardMaterial({ color: 0xff6d00, roughness: 0.45 });

    const baseSphere = new THREE.Mesh(new THREE.SphereGeometry(1.15 * s, 16, 14), snowMat);
    baseSphere.position.y = 1.05 * s;
    const midSphere = new THREE.Mesh(new THREE.SphereGeometry(0.86 * s, 16, 14), snowMat);
    midSphere.position.y = 2.65 * s;
    group.add(baseSphere, midSphere);

    if (parsedTemplates.snowmanHeadGeo) {
      // snowman.obj head sphere has radius 100 and nose pointing +X; scale to 0.64 * s
      const head = new THREE.Mesh(parsedTemplates.snowmanHeadGeo, [coalMat, carrotMat, snowMat]);
      head.scale.setScalar((0.64 * s) / 100.0);
      head.position.y = 3.92 * s;
      head.castShadow = true;
      group.add(head);
    } else {
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.64 * s, 16, 14), snowMat);
      head.position.y = 3.92 * s;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.14 * s, 0.65 * s, 10), carrotMat);
      nose.rotation.z = -Math.PI / 2;
      nose.position.set(0.75 * s, 3.92 * s, 0);
      group.add(head, nose);
    }
    return group;
  }

  function createRockProp({ radius = 1.6, variant = 0 } = {}) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.82 });
    const rocks = parsedTemplates.rocks || [];
    if (rocks.length > 0) {
      const geo = rocks[Math.abs(variant) % rocks.length];
      const m = new THREE.Mesh(geo, mat);
      m.scale.setScalar(radius);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    }
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), mat);
    m.castShadow = true;
    return m;
  }

  return Object.freeze({
    createPineTree,
    createGiftProp,
    createArchProp,
    createSnowmanProp,
    createRockProp,
  });
}

export function parseSnowboxObjTemplates(rawObjMap = {}) {
  const loader = new OBJLoader();
  const templates = { rocks: [] };

  if (rawObjMap.pineTree) {
    const obj = typeof rawObjMap.pineTree === 'string' ? loader.parse(rawObjMap.pineTree) : rawObjMap.pineTree;
    const meshes = [];
    obj.traverse((c) => { if (c.isMesh) meshes.push(c); });
    if (meshes.length >= 2) {
      const foliageGeo = meshes[0].geometry.clone();
      const trunkGeo = meshes[1].geometry.clone();
      // pine-tree.obj base sits at Y = +100.0, height = 407.242
      foliageGeo.translate(0, -100.0, 0);
      foliageGeo.scale(1 / 407.242, 1 / 407.242, 1 / 407.242);
      trunkGeo.translate(0, -100.0, 0);
      trunkGeo.scale(1 / 407.242, 1 / 407.242, 1 / 407.242);
      templates.pineTree = { foliageGeo, trunkGeo };
    }
  }

  if (rawObjMap.gift) {
    const obj = typeof rawObjMap.gift === 'string' ? loader.parse(rawObjMap.gift) : rawObjMap.gift;
    const ribbonGeos = [];
    let boxGeo = null;
    obj.traverse((c) => {
      if (!c.isMesh) return;
      const g = c.geometry.clone();
      g.translate(16.701, 102.042, -8.691);
      g.scale(1 / 202.0, 1 / 202.0, 1 / 202.0);
      if (c.name === 'box') boxGeo = g;
      else ribbonGeos.push(g);
    });
    if (boxGeo || ribbonGeos.length > 0) {
      templates.gift = { boxGeo, ribbonGeos };
    }
  }

  if (rawObjMap.arch) {
    const obj = typeof rawObjMap.arch === 'string' ? loader.parse(rawObjMap.arch) : rawObjMap.arch;
    obj.traverse((c) => {
      if (c.isMesh && !templates.archGeo) {
        const g = c.geometry.clone();
        g.translate(-1.539, 1.028, 0.007);
        templates.archGeo = g;
      }
    });
  }

  if (rawObjMap.snowman) {
    const obj = typeof rawObjMap.snowman === 'string' ? loader.parse(rawObjMap.snowman) : rawObjMap.snowman;
    obj.traverse((c) => {
      if (c.isMesh && !templates.snowmanHeadGeo) {
        templates.snowmanHeadGeo = c.geometry.clone();
      }
    });
  }

  for (const key of ['rock01', 'rock02']) {
    if (rawObjMap[key]) {
      const obj = typeof rawObjMap[key] === 'string' ? loader.parse(rawObjMap[key]) : rawObjMap[key];
      obj.traverse((c) => {
        if (c.isMesh) {
          const g = c.geometry.clone();
          g.center();
          g.scale(1 / 25.0, 1 / 25.0, 1 / 25.0);
          templates.rocks.push(g);
        }
      });
    }
  }

  return buildFallbackFactory(templates);
}

export async function loadPropsLibrary({
  objBasePath = '../snowbox/models/',
  loader = null,
} = {}) {
  const objLoader = loader || new OBJLoader();
  const entries = [
    ['pineTree', `${objBasePath}pine-tree.obj`],
    ['gift', `${objBasePath}gift.obj`],
    ['arch', `${objBasePath}arch.obj`],
    ['snowman', `${objBasePath}snowman.obj`],
    ['rock01', `${objBasePath}mountain/rock_01.obj`],
    ['rock02', `${objBasePath}mountain/rock_02.obj`],
  ];

  const loaded = {};
  await Promise.all(
    entries.map(async ([key, url]) => {
      try {
        loaded[key] = await objLoader.loadAsync(url);
      } catch (_) {
        // Fallback procedural mesh will be used automatically for any unavailable asset
      }
    })
  );

  return parseSnowboxObjTemplates(loaded);
}

export function createFallbackPropsLibrary() {
  return buildFallbackFactory({});
}
