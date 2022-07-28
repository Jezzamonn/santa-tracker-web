/** The current beat created by the user */

export class Beat {

  constructor(totalBeats, rows) {
    /** @type {Array<Array<boolean>>} */
    this.beats = Array(rows).fill(null).map(_ => Array(totalBeats).fill(false));
  }
}