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
 * Shared immutable physics, camera, collider, and audio constants for Jolly Obby.
 * Canonical world scale: 1 Three.js World Unit = 1 Roblox Stud.
 */

export const TOTAL_SECTIONS = 10;

export const PHYSICS_CONFIG = Object.freeze({
  WALK_SPEED: 16.0,          // studs/s
  GROUND_ACCEL: 180.0,       // studs/s^2
  GROUND_DECEL: 220.0,       // studs/s^2
  AIR_ACCEL: 140.0,          // studs/s^2
  AIR_DECEL: 140.0,          // studs/s^2
  GRAVITY: -196.2,           // studs/s^2
  TERMINAL_VELOCITY: -120.0, // studs/s
  JUMP_VELOCITY: 52.0,       // studs/s (h_jump ~= 6.89 studs, t_apex ~= 0.265s, t_total ~= 0.530s)
  COYOTE_TIME: 0.09,         // s
  JUMP_BUFFER: 0.09,         // s
  PLAYER_RADIUS: 0.85,       // studs (diameter 1.70)
  PLAYER_HEIGHT: 5.0,        // studs
  STEP_HEIGHT: 0.60,         // studs
  MAX_SUBSTEP_DT: 1 / 120,   // s
  MAX_FRAME_DT: 0.05,        // s
  VOID_KILL_Y: -20.0,        // studs
});

export const CAMERA_CONFIG = Object.freeze({
  DEFAULT_DISTANCE: 17.0,
  MIN_DISTANCE: 5.5,
  MAX_DISTANCE: 45.0,
  DEFAULT_PITCH: (26 * Math.PI) / 180,
  MIN_PITCH: (-15 * Math.PI) / 180,
  MAX_PITCH: (80 * Math.PI) / 180,
  DEFAULT_YAW: 0,            // Looking North (-Z) from behind player (+Z)
  TARGET_HEIGHT_OFFSET: 3.5, // studs above player feet
  ORBIT_SENSITIVITY: 0.0055, // rad/px
  ZOOM_STEP: 2.0,            // studs per wheel notch
  FOV: 60,
});

export const COLLIDER_KIND = Object.freeze({
  SOLID: 'solid',            // Walkable safe platform (box, cylinder, or oriented box/ramp)
  HAZARD: 'hazard',          // Glowing crimson brick/bar — triggers immediate respawn on contact
  CHECKPOINT: 'checkpoint',  // Checkpoint trigger volume/pad (checkpointIndex: 0..9)
  GOAL: 'goal',              // Section 10 finish trigger volume
});

export const SOUND_EVENTS = Object.freeze({
  PRELOAD_BANKS: Object.freeze([
    'runner_load_sounds',
    'snowball_load_sounds',
    'generic_load_sounds',
    'pb_load_sounds',
    'codeboogie_load_sounds',
  ]),
  MUSIC_INGAME: 'music_start_ingame',
  MUSIC_GAMEOVER: 'music_ingame_gameover',
  JUMP: 'runner_jump_1',
  CHECKPOINT: 'pb_level_up',
  RESPAWN: 'snowball_hit',
  WIN: 'cb_win',
});
