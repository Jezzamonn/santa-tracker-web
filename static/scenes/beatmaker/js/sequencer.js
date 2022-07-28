export class Sequencer {

  constructor() {
    /** @type {!number} */
    this.bpm = 150;
    
    /** @type {!number} */
    this.totalBeats = 16;
    
    /** @type {!number} */
    this.currentBeat = -1;

    /** @type {?function():void} */
    this.onBeat = undefined;
  }


  get beatLengthMs() {
    return (60 * 1000) / this.bpm;
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
}