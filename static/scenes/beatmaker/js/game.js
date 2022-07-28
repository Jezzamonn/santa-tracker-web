import { Sequencer } from "./sequencer.js";

export class Game {

  constructor() {
    /** @type {!Sequencer} */
    this.sequencer = new Sequencer();
  }

  start() {
    this.sequencer.onBeat = () => {
      console.log('on beat?');
      this.updateActiveColumn(this.sequencer.currentBeat);
    }
    this.sequencer.start();
  }

  updateActiveColumn(column) {
    // Clear existing highlighted rows
    const activeSquares = document.querySelectorAll('.square--active');
    for (const activeSquare of activeSquares) {
      activeSquare.classList.remove('square--active')
    }

    const newSquares = document.querySelectorAll(`.square--col-${column}`);
    for (const newSquare of newSquares) {
      newSquare.classList.add('square--active');
    }
  }
}