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
 * Substepped Roblox-feel kinematic character physics & dynamic platform carry solver.
 * Canonical scale: 1 World Unit = 1 Roblox Stud.
 */

import { PHYSICS_CONFIG, COLLIDER_KIND } from './constants.js';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function shortestAngleDelta(from, to) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function createPhysicsController(config = PHYSICS_CONFIG) {
  let px = 0;
  let py = 0;
  let pz = 0;
  let vx = 0;
  let vy = 0;
  let vz = 0;
  let grounded = false;
  let supportColliderId = null;
  let coyoteTimer = 0;
  let jumpBufferTimer = 0;
  let facingYaw = 0;

  function findFlushGroundSupport(x, y, z, colliders) {
    if (!Array.isArray(colliders) || colliders.length === 0) return null;
    const R = config.PLAYER_RADIUS;
    let bestCol = null;
    let bestTopY = -Infinity;

    for (let i = 0; i < colliders.length; i++) {
      const col = colliders[i];
      if (col.kind !== COLLIDER_KIND.SOLID) continue;
      const pitch = col.slopePitch || 0;

      if (col.shape === 'cylinder') {
        const topY = col.position.y + col.hy;
        if (Math.abs(topY - y) > 0.03) continue;
        const dx = x - col.position.x;
        const dz = z - col.position.z;
        const rSum = R + col.radius;
        if (dx * dx + dz * dz < rSum * rSum && topY >= bestTopY) {
          bestTopY = topY;
          bestCol = col;
        }
      } else if (Math.abs(pitch) < 1e-6) {
        const { hx, hy, hz } = col.halfExtents;
        const topY = col.position.y + hy;
        if (Math.abs(topY - y) > 0.03) continue;
        const yaw = col.yaw || 0;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const dx = x - col.position.x;
        const dz = z - col.position.z;
        const ux = dx * cy - dz * sy;
        const uz = dx * sy + dz * cy;
        const qx = clamp(ux, -hx, hx);
        const qz = clamp(uz, -hz, hz);
        if ((ux - qx) ** 2 + (uz - qz) ** 2 < R * R && topY >= bestTopY) {
          bestTopY = topY;
          bestCol = col;
        }
      }
    }
    return bestCol ? { id: bestCol.id, topY: bestTopY } : null;
  }

  function checkHeadroomBlocked(candX, candY, candZ, colliders, ignoreId) {
    const r = config.PLAYER_RADIUS - 5e-5;
    const yMin = candY + 0.02;
    const yMax = candY + config.PLAYER_HEIGHT - 1e-4;

    for (let i = 0; i < colliders.length; i++) {
      const col = colliders[i];
      if (col.kind !== COLLIDER_KIND.SOLID || col.id === ignoreId) continue;
      if (Math.abs(col.slopePitch || 0) >= 1e-6) continue;

      const hy = col.shape === 'cylinder' ? col.hy : col.halfExtents.hy;
      if (yMax <= col.position.y - hy || yMin >= col.position.y + hy) continue;

      if (col.shape === 'cylinder') {
        const dx = candX - col.position.x;
        const dz = candZ - col.position.z;
        const rSum = r + col.radius;
        if (dx * dx + dz * dz < rSum * rSum) return true;
      } else {
        const yaw = col.yaw || 0;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const dx = candX - col.position.x;
        const dz = candZ - col.position.z;
        const ux = dx * cy - dz * sy;
        const uz = dx * sy + dz * cy;
        const qx = clamp(ux, -col.halfExtents.hx, col.halfExtents.hx);
        const qz = clamp(uz, -col.halfExtents.hz, col.halfExtents.hz);
        if ((ux - qx) ** 2 + (uz - qz) ** 2 < r * r) return true;
      }
    }
    return false;
  }

  function testTriggerOrHazardOverlap(x, y, z, radius, height, col, yPadBottom = 0, yPadTop = 0) {
    const pMinY = y - yPadBottom;
    const pMaxY = y + height + yPadTop;

    if (col.shape === 'cylinder') {
      if (pMaxY < col.position.y - col.hy || pMinY > col.position.y + col.hy) return false;
      const dx = x - col.position.x;
      const dz = z - col.position.z;
      const rSum = radius + col.radius;
      return dx * dx + dz * dz <= rSum * rSum;
    }

    const { hx, hy, hz } = col.halfExtents;
    const yaw = col.yaw || 0;
    const pitch = col.slopePitch || 0;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const dx = x - col.position.x;
    const dz = z - col.position.z;
    const ux = dx * cy - dz * sy;
    const uz = dx * sy + dz * cy;

    if (Math.abs(pitch) < 1e-6) {
      if (pMaxY < col.position.y - hy || pMinY > col.position.y + hy) return false;
      const qx = clamp(ux, -hx, hx);
      const qz = clamp(uz, -hz, hz);
      return (ux - qx) ** 2 + (uz - qz) ** 2 <= radius * radius;
    }

    if (Math.abs(ux) > hx + radius) return false;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const samples = [pMinY + radius, 0.5 * (pMinY + pMaxY), pMaxY - radius];
    for (let i = 0; i < samples.length; i++) {
      const vyRel = samples[i] - col.position.y;
      const ly = vyRel * cp + uz * sp;
      const lz = -vyRel * sp + uz * cp;
      const qlx = clamp(ux, -hx, hx);
      const qly = clamp(ly, -hy, hy);
      const qlz = clamp(lz, -hz, hz);
      if ((ux - qlx) ** 2 + (ly - qly) ** 2 + (lz - qlz) ** 2 <= radius * radius) {
        return true;
      }
    }
    return false;
  }

  function reset(spawnPosition, spawnYaw = 0, colliders = null) {
    px = spawnPosition.x;
    py = spawnPosition.y;
    pz = spawnPosition.z;
    vx = 0;
    vy = 0;
    vz = 0;
    facingYaw = Number.isFinite(spawnYaw) ? spawnYaw : 0;
    jumpBufferTimer = 0;

    const support = findFlushGroundSupport(px, py, pz, colliders);
    if (support) {
      py = support.topY;
      grounded = true;
      supportColliderId = support.id;
      coyoteTimer = config.COYOTE_TIME;
    } else {
      grounded = false;
      supportColliderId = null;
      coyoteTimer = 0;
    }
  }

  function step(dt, inputState = {}, cameraBasis = null, colliders = []) {
    const clampedDt = Math.min(Math.max(0, Number(dt) || 0), config.MAX_FRAME_DT);

    if (typeof inputState.consumeJumpPressed === 'function' && inputState.consumeJumpPressed()) {
      jumpBufferTimer = config.JUMP_BUFFER;
    }

    // If freshly spawned flush on a solid pad without colliders passed to reset(), establish resting contact
    if (!grounded && vy === 0 && supportColliderId === null) {
      const support = findFlushGroundSupport(px, py, pz, colliders);
      if (support) {
        py = support.topY;
        grounded = true;
        supportColliderId = support.id;
        coyoteTimer = config.COYOTE_TIME;
      }
    }

    if (clampedDt === 0) {
      return {
        position: { x: px, y: py, z: pz },
        velocity: { x: vx, y: vy, z: vz },
        grounded,
        jumped: false,
        landed: false,
        touchedCheckpoint: null,
        hitHazard: false,
        fellInVoid: py < config.VOID_KILL_Y,
        reachedGoal: false,
        facingYaw,
      };
    }

    const wasGroundedAtStepStart = grounded;

    // 1. Dynamic platform carry (applied ONCE per step before substeps; Three.js +Y right-hand rule).
    if (grounded && supportColliderId !== null) {
      for (let i = 0; i < colliders.length; i++) {
        const sup = colliders[i];
        if (sup.id === supportColliderId) {
          const dPos = sup.deltaPosition || { x: 0, y: 0, z: 0 };
          const dYaw = sup.deltaYaw || 0;
          if (dYaw !== 0) {
            const prevCx = sup.position.x - (dPos.x || 0);
            const prevCz = sup.position.z - (dPos.z || 0);
            const relX = px - prevCx;
            const relZ = pz - prevCz;
            const c = Math.cos(dYaw);
            const s = Math.sin(dYaw);
            px = sup.position.x + (relX * c + relZ * s);
            pz = sup.position.z + (-relX * s + relZ * c);
            py += dPos.y || 0;
            facingYaw += dYaw;
          } else {
            px += dPos.x || 0;
            py += dPos.y || 0;
            pz += dPos.z || 0;
          }
          break;
        }
      }
    }

    // 2. Camera-relative horizontal wish velocity (W => moveZ = -1 => forwardAmount = -moveZ = +1).
    let moveX = Number(inputState.moveX) || 0;
    let moveZ = Number(inputState.moveZ) || 0;
    const moveMag = Math.hypot(moveX, moveZ);
    if (moveMag > 1) {
      moveX /= moveMag;
      moveZ /= moveMag;
    }

    const fwd = (cameraBasis && cameraBasis.forward) || { x: 0, z: -1 };
    const rgt = (cameraBasis && cameraBasis.right) || { x: 1, z: 0 };
    const wishDirX = (-moveZ) * fwd.x + moveX * rgt.x;
    const wishDirZ = (-moveZ) * fwd.z + moveX * rgt.z;
    const wishLen = Math.hypot(wishDirX, wishDirZ);
    const hasMoveInput = wishLen > 1e-5;
    const clampedWishLen = Math.min(1, wishLen);

    const targetVx = hasMoveInput ? (wishDirX / wishLen) * clampedWishLen * config.WALK_SPEED : 0;
    const targetVz = hasMoveInput ? (wishDirZ / wishLen) * clampedWishLen * config.WALK_SPEED : 0;

    if (hasMoveInput) {
      const desiredYaw = Math.atan2(-wishDirX, -wishDirZ);
      const maxTurn = 16.0 * clampedDt;
      const deltaYaw = shortestAngleDelta(facingYaw, desiredYaw);
      facingYaw += Math.abs(deltaYaw) <= maxTurn ? deltaYaw : Math.sign(deltaYaw) * maxTurn;
    }

    // 3. Fixed-substep integration & collision resolution (subDt <= 1/120s).
    const numSubsteps = Math.max(1, Math.ceil(clampedDt / config.MAX_SUBSTEP_DT));
    const subDt = clampedDt / numSubsteps;

    let jumpedThisStep = false;
    let touchedCheckpoint = null;
    let hitHazard = false;
    let reachedGoal = false;

    for (let sub = 0; sub < numSubsteps; sub++) {
      const wasGroundedSub = grounded;
      coyoteTimer = grounded ? config.COYOTE_TIME : Math.max(0, coyoteTimer - subDt);

      const wantsJump = jumpBufferTimer > 0 || Boolean(inputState.jumpHeld);
      if (wantsJump && (grounded || coyoteTimer > 0)) {
        vy = config.JUMP_VELOCITY;
        grounded = false;
        supportColliderId = null;
        coyoteTimer = 0;
        jumpBufferTimer = 0;
        jumpedThisStep = true;
      } else {
        jumpBufferTimer = Math.max(0, jumpBufferTimer - subDt);
      }
      const groundedBeforeIntegrate = grounded;

      const accelRate = grounded
        ? (hasMoveInput ? config.GROUND_ACCEL : config.GROUND_DECEL)
        : (hasMoveInput ? config.AIR_ACCEL : config.AIR_DECEL);
      const dvX = targetVx - vx;
      const dvZ = targetVz - vz;
      const dvLen = Math.hypot(dvX, dvZ);
      const maxDv = accelRate * subDt;
      if (dvLen <= maxDv || dvLen < 1e-8) {
        vx = targetVx;
        vz = targetVz;
      } else {
        vx += (dvX / dvLen) * maxDv;
        vz += (dvZ / dvLen) * maxDv;
      }

      // Trapezoidal / Velocity-Verlet vertical integration preserves exact h_jump = v0^2 / (2|g|) = 6.8909 studs.
      const prevX = px;
      const prevY = py;
      const prevZ = pz;
      const nextVy = Math.max(config.TERMINAL_VELOCITY, vy + config.GRAVITY * subDt);
      px += vx * subDt;
      py += 0.5 * (vy + nextVy) * subDt;
      pz += vz * subDt;
      vy = nextVy;
      const preResolveVy = vy;

      let newGrounded = false;
      let newSupportId = null;
      let bestSupportTopY = -Infinity;

      const R = config.PLAYER_RADIUS;
      const H = config.PLAYER_HEIGHT;

      for (let i = 0; i < colliders.length; i++) {
        const col = colliders[i];
        if (col.kind !== COLLIDER_KIND.SOLID) continue;

        const pitch = col.slopePitch || 0;

        // Case A: Sloped oriented box (e.g., Section 8 14° truss ramp)
        if (col.shape === 'box' && Math.abs(pitch) >= 1e-6) {
          const { hx, hy, hz } = col.halfExtents;
          const yaw = col.yaw || 0;
          const cy = Math.cos(yaw);
          const sy = Math.sin(yaw);
          const dx = px - col.position.x;
          const dz = pz - col.position.z;
          const ux = dx * cy - dz * sy;
          const uz = dx * sy + dz * cy;
          if (Math.abs(ux) >= hx + R) continue;

          const cp = Math.cos(pitch);
          const sp = Math.sin(pitch);
          const lzTop = (uz - hy * sp) / cp;

          if (Math.abs(lzTop) <= hz + R * 0.75) {
            const lzClamped = clamp(lzTop, -hz, hz);
            const ySurf = col.position.y + hy * cp - lzClamped * sp;
            const snapDown = wasGroundedSub && preResolveVy <= 0 ? 0.14 : 0.04;
            const diff = ySurf - py;
            const maxSlopeSnap =
              preResolveVy <= 0 && prevY >= ySurf - 0.25
                ? Math.max(config.STEP_HEIGHT + 0.12, -preResolveVy * subDt + 0.30)
                : config.STEP_HEIGHT + 0.12;

            if (
              vy <= 4.0 &&
              diff >= -snapDown &&
              diff <= maxSlopeSnap &&
              prevY >= ySurf - config.STEP_HEIGHT - 0.08
            ) {
              if (ySurf >= bestSupportTopY) {
                py = ySurf;
                if (vy < 0) vy = 0;
                newGrounded = true;
                newSupportId = col.id;
                bestSupportTopY = ySurf;
              }
              continue;
            }
          }

          // Underside / lateral wall push-out for sloped box
          const midRelY = py + H * 0.5 - col.position.y;
          const ly = midRelY * cp + uz * sp;
          const lz = -midRelY * sp + uz * cp;
          if (Math.abs(ly) < hy + H * 0.5 && Math.abs(lz) < hz + R) {
            const penLat = hx + R - Math.abs(ux);
            if (penLat > 0 && penLat < R) {
              const signX = ux >= 0 ? 1 : -1;
              const nwx = signX * cy;
              const nwz = -signX * sy;
              px += nwx * penLat;
              pz += nwz * penLat;
              const vn = vx * nwx + vz * nwz;
              if (vn < 0) {
                vx -= vn * nwx;
                vz -= vn * nwz;
              }
            }
          }
          continue;
        }

        // Case B: Horizontal oriented box or vertical cylinder
        let penXZ = 0;
        let nwx = 0;
        let nwz = 0;
        let cMinY = 0;
        let cMaxY = 0;

        if (col.shape === 'cylinder') {
          cMinY = col.position.y - col.hy;
          cMaxY = col.position.y + col.hy;
          const dx = px - col.position.x;
          const dz = pz - col.position.z;
          const dSq = dx * dx + dz * dz;
          const rSum = R + col.radius;
          if (dSq >= rSum * rSum) continue;
          const d = Math.sqrt(dSq);
          penXZ = rSum - d;
          if (d > 1e-8) {
            nwx = dx / d;
            nwz = dz / d;
          } else {
            nwx = 1;
            nwz = 0;
          }
        } else {
          const { hx, hy, hz } = col.halfExtents;
          cMinY = col.position.y - hy;
          cMaxY = col.position.y + hy;
          const yaw = col.yaw || 0;
          const cy = Math.cos(yaw);
          const sy = Math.sin(yaw);
          const dx = px - col.position.x;
          const dz = pz - col.position.z;
          const ux = dx * cy - dz * sy;
          const uz = dx * sy + dz * cy;
          const qx = clamp(ux, -hx, hx);
          const qz = clamp(uz, -hz, hz);
          const ex = ux - qx;
          const ez = uz - qz;
          const dSq = ex * ex + ez * ez;
          if (dSq >= R * R) continue;

          let nlx = 0;
          let nlz = 0;
          if (dSq > 1e-10) {
            const d = Math.sqrt(dSq);
            penXZ = R - d;
            nlx = ex / d;
            nlz = ez / d;
          } else {
            const remX = hx - Math.abs(ux);
            const remZ = hz - Math.abs(uz);
            if (remX < remZ) {
              penXZ = R + remX;
              nlx = ux >= 0 ? 1 : -1;
            } else {
              penXZ = R + remZ;
              nlz = uz >= 0 ? 1 : -1;
            }
          }
          nwx = nlx * cy + nlz * sy;
          nwz = -nlx * sy + nlz * cy;
        }

        const snapEps = wasGroundedSub && preResolveVy <= 0 ? 0.05 : 0.02;
        const pTopY = groundedBeforeIntegrate ? Math.max(py, prevY) + H : py + H;
        if (pTopY <= cMinY || py > cMaxY + snapEps) continue;

        const topDiff = cMaxY - py;
        const maxLandingSnap = Math.max(0.35, -preResolveVy * subDt + 0.15);

        // 1) Top landing / standing support (requires prior XZ overlap or swept entry above top surface)
        let enteredFromAboveTop = wasGroundedSub;
        if (!enteredFromAboveTop) {
          if (col.shape === 'cylinder') {
            const pdx = prevX - col.position.x;
            const pdz = prevZ - col.position.z;
            const rSum = R + col.radius;
            const prevDist = Math.hypot(pdx, pdz);
            if (prevDist < rSum + 1e-4) {
              enteredFromAboveTop = prevY >= cMaxY - 0.12;
            } else {
              const curDist = Math.hypot(px - col.position.x, pz - col.position.z);
              const denom = prevDist - curDist;
              const sEnter = denom > 1e-8 ? clamp((prevDist - rSum) / denom, 0, 1) : 1;
              const yAtSideContact = prevY + (py - prevY) * sEnter;
              enteredFromAboveTop = yAtSideContact >= cMaxY - snapEps;
            }
          } else {
            const { hx, hz } = col.halfExtents;
            const yaw = col.yaw || 0;
            const cy = Math.cos(yaw);
            const sy = Math.sin(yaw);
            const pdx = prevX - col.position.x;
            const pdz = prevZ - col.position.z;
            const pux = pdx * cy - pdz * sy;
            const puz = pdx * sy + pdz * cy;
            const pqx = clamp(pux, -hx, hx);
            const pqz = clamp(puz, -hz, hz);
            const prevOut = Math.hypot(pux - pqx, puz - pqz);
            if (prevOut < R + 1e-4) {
              enteredFromAboveTop = prevY >= cMaxY - 0.12;
            } else {
              const curOut = R - penXZ;
              const denom = prevOut - curOut;
              const sEnter = denom > 1e-8 ? clamp((prevOut - R) / denom, 0, 1) : 1;
              const yAtSideContact = prevY + (py - prevY) * sEnter;
              enteredFromAboveTop = yAtSideContact >= cMaxY - snapEps;
            }
          }
        }
        if (
          vy <= 0 &&
          enteredFromAboveTop &&
          prevY >= cMaxY - 0.12 &&
          topDiff >= -snapEps &&
          topDiff <= maxLandingSnap
        ) {
          if (cMaxY >= bestSupportTopY) {
            py = cMaxY;
            vy = 0;
            newGrounded = true;
            newSupportId = col.id;
            bestSupportTopY = cMaxY;
          }
          if (typeof col.checkpointIndex === 'number') {
            touchedCheckpoint =
              touchedCheckpoint === null ? col.checkpointIndex : Math.max(touchedCheckpoint, col.checkpointIndex);
          }
          continue;
        }

        // 2) Step-up onto <= 0.60-stud trim / ledge (strictly grounded only; prevents midair +0.60 vaulting)
        const stepRise = cMaxY - prevY;
        if (
          groundedBeforeIntegrate &&
          penXZ > 1e-4 &&
          topDiff > 0 &&
          stepRise > 0 &&
          stepRise <= config.STEP_HEIGHT + 1e-5
        ) {
          if (!checkHeadroomBlocked(px, cMaxY, pz, colliders, col.id)) {
            py = cMaxY;
            if (vy < 0) vy = 0;
            newGrounded = true;
            newSupportId = col.id;
            bestSupportTopY = Math.max(bestSupportTopY, cMaxY);
            if (typeof col.checkpointIndex === 'number') {
              touchedCheckpoint =
                touchedCheckpoint === null ? col.checkpointIndex : Math.max(touchedCheckpoint, col.checkpointIndex);
            }
            continue;
          }
        }

        // 3) Ceiling bonk
        if (preResolveVy > 0 && prevY + H <= cMinY + 1e-4 && py + H > cMinY && py < cMinY) {
          py = cMinY - H;
          if (vy > 0) vy = 0;
          continue;
        }

        // 4) Horizontal wall push-out & velocity slide
        if (py < cMaxY - 0.01 && pTopY > cMinY + 1e-4) {
          px += nwx * penXZ;
          pz += nwz * penXZ;
          const vn = vx * nwx + vz * nwz;
          if (vn < 0) {
            vx -= vn * nwx;
            vz -= vn * nwz;
          }
        }
      }

      grounded = newGrounded;
      supportColliderId = newSupportId;

      // 4. Hazard, Checkpoint & Finish Goal volume checks (runs even when player velocity === 0).
      for (let i = 0; i < colliders.length; i++) {
        const col = colliders[i];
        if (col.kind === COLLIDER_KIND.HAZARD) {
          if (testTriggerOrHazardOverlap(px, py, pz, R - 0.08, H - 0.05, col, -0.02, 0)) {
            hitHazard = true;
          }
        } else if (col.kind === COLLIDER_KIND.CHECKPOINT) {
          if (testTriggerOrHazardOverlap(px, py, pz, R, H, col, 0.05, 0)) {
            const idx = col.checkpointIndex ?? 0;
            touchedCheckpoint = touchedCheckpoint === null ? idx : Math.max(touchedCheckpoint, idx);
          }
        } else if (col.kind === COLLIDER_KIND.GOAL) {
          if (testTriggerOrHazardOverlap(px, py, pz, R, H, col, 0.05, 0)) {
            reachedGoal = true;
          }
        }
      }

      if (hitHazard || py < config.VOID_KILL_Y) {
        break;
      }
    }

    const fellInVoid = py < config.VOID_KILL_Y;
    if (hitHazard || fellInVoid) {
      touchedCheckpoint = null;
      reachedGoal = false;
    }

    const landed = !wasGroundedAtStepStart && grounded && !hitHazard && !fellInVoid;

    return {
      position: { x: px, y: py, z: pz },
      velocity: { x: vx, y: vy, z: vz },
      grounded,
      jumped: jumpedThisStep,
      landed,
      touchedCheckpoint,
      hitHazard,
      fellInVoid,
      reachedGoal,
      facingYaw,
    };
  }

  return Object.freeze({ reset, step });
}
