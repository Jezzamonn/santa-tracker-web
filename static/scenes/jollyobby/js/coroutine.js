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
 * Minimal generator-based coroutines driven by the game's simulation clock.
 *
 * A coroutine is a generator function. Each `yield` suspends it until the next
 * `runner.update(dt)` call, and the `yield` expression evaluates to that frame's
 * `dt` (in seconds). Because coroutines only advance inside `update(dt)`, they
 * follow the fixed-step / manual-time clock and freeze while the game is paused.
 *
 *   const runner = createCoroutineRunner();
 *   const handle = runner.start(function* () {
 *     yield* tween(0.5, (t) => { ... });
 *   });
 *   handle.cancel(); // Stops it before the next frame.
 */

/**
 * @typedef {{cancel: function(): void, isDone: function(): boolean}} CoroutineHandle
 */

export function createCoroutineRunner() {
  /** @type {Array<{iterator: Iterator, done: boolean}>} */
  let active = [];

  /**
   * Starts a coroutine. The generator body runs up to its first `yield`
   * on the next `update(dt)` call, not synchronously.
   * @param {function(): Generator} generatorFn
   * @return {CoroutineHandle}
   */
  function start(generatorFn) {
    const entry = { iterator: generatorFn(), done: false };
    active.push(entry);
    return Object.freeze({
      cancel() {
        if (entry.done) return;
        entry.done = true;
        if (typeof entry.iterator.return === 'function') {
          entry.iterator.return();
        }
      },
      isDone() {
        return entry.done;
      },
    });
  }

  /**
   * Advances every running coroutine by one frame.
   * @param {number} dt Seconds since the previous frame.
   */
  function update(dt) {
    if (active.length === 0) return;
    // Iterate over a snapshot so coroutines started mid-update begin next frame.
    const running = active.slice();
    for (const entry of running) {
      if (entry.done) continue;
      const result = entry.iterator.next(dt);
      if (result.done) {
        entry.done = true;
      }
    }
    active = active.filter((entry) => !entry.done);
  }

  /** Cancels every running coroutine. */
  function cancelAll() {
    for (const entry of active) {
      if (!entry.done) {
        entry.done = true;
        if (typeof entry.iterator.return === 'function') {
          entry.iterator.return();
        }
      }
    }
    active = [];
  }

  function isIdle() {
    return active.every((entry) => entry.done);
  }

  return Object.freeze({ start, update, cancelAll, isIdle });
}

/**
 * Coroutine helper that calls `onUpdate(t)` once per frame with an eased
 * progress value `t` from (0, 1], finishing with exactly `onUpdate(1)`.
 * Use with `yield* tween(...)` inside a coroutine.
 * @param {number} duration Seconds.
 * @param {function(number): void} onUpdate
 * @param {function(number): number=} ease
 */
export function* tween(duration, onUpdate, ease = easeInOutCubic) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  let elapsed = 0;
  while (elapsed < safeDuration) {
    const dt = yield;
    elapsed += Number.isFinite(dt) && dt > 0 ? dt : 0;
    onUpdate(ease(Math.min(1, elapsed / safeDuration)));
  }
  if (safeDuration === 0) {
    onUpdate(1);
  }
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
