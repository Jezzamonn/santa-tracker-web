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
  }


  get beatLengthMs() {
    return this.beatLength * (60 * 1000) / this.bpm;
  }

  start() {
    setInterval(() => {
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
    
  }
}