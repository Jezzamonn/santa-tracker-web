/** The current beat created by the user */

const strRadix = 36;

export class Beat {

  constructor(totalBeats, totalInstruments) {
    this.totalInstruments = totalInstruments;
    this.totalBeats = totalBeats;
    /** @type {Array<Array<boolean>>} */
    this.beats = [];

    this.reset();
  }

  reset() {
    this.beats = Array(this.totalInstruments).fill(null).map(_ => Array(this.totalBeats).fill(false));
  }

  toggleBeat(instrument, beat) {
    this.beats[instrument][beat] = !this.beats[instrument][beat];
  }

  getActiveInstruments(beat) {
    const instruments = [];
    for (let i = 0; i < this.totalInstruments; i++) {
      if (this.beats[i][beat]) {
        instruments.push(i);
      }
    }
    return instruments;
  }

  isInstrumentActive(instrument, beat) {
    return this.beats[instrument][beat];
  }

  toString() {
    let str = '';
    for (let i = 0; i < this.totalInstruments; i++) {
      for (let b = 0; b < this.totalBeats; b++) {
        if (this.beats[i][b]) {
          str += i.toString(36) + b.toString(strRadix);
        }
      }
    }
    return str;
  }

  /**
   * @param {!string} str 
   */
  updateFromString(str) {
    this.reset();

    for (let c = 0; c < str.length; c += 2) {
      const i = parseInt(str.charAt(c), strRadix);
      const b = parseInt(str.chatAt(c + 1), strRadix);
      if (isNaN(i) || isNaN(b) || i >= this.totalInstruments || b >= this.totalBeats) {
        // Ignore invalid characters
        continue;
      }
      this.beats[i][b] = true;
    }
  }
}