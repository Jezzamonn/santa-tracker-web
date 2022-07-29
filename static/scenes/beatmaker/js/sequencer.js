export class Sequencer {

  constructor() {
    /** @type {!number} */
    this.bpm = 120;

    /**
     * The length of a beat in the sequencer.
     *
     * @type {!number}
     */
    this.beatLength = 1 / 2;

    /** @type {!number} */
    this.totalBeats = 16;

    /** @type {!number} */
    this.currentBeat = -1;

    /** @type {?function():void} */
    this.onBeat = undefined;

    /** @type {?number} */
    this.interval = undefined;
  }

  get isPlaying() {
    return this.interval !== undefined;
  }

  get beatLengthMs() {
    return this.beatLength * (60 * 1000) / this.bpm;
  }

  start() {
    this.interval = setInterval(() => {
      this.currentBeat++;
      if (this.currentBeat >= this.totalBeats) {
        this.currentBeat = 0;
      }

      if (this.onBeat) {
        this.onBeat();
      }
    }, this.beatLengthMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      // Also reset to the start
      this.currentBeat = -1;
    }
  }
}