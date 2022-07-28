/** The current beat created by the user */

export class Beat {

  constructor(totalBeats, totalInstruments) {
    this.totalInstruments = totalInstruments;
    this.totalBeats = totalBeats;
    /** @type {Array<Array<boolean>>} */
    this.beats = Array(totalInstruments).fill(null).map(_ => Array(totalBeats).fill(false));
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
}