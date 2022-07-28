import { Sequencer } from "./sequencer.js";

export class Game {

  constructor() {
    /** @type {!Sequencer} */
    this.sequencer = new Sequencer();

    this.sequencer.onBeat = () => {
      this.updateActiveColumn(this.sequencer.currentBeat);
    }
  }

  setUp() {
    this.createGrid();
  }

  // create elements on the page.
  createGrid() {
    const gridElem = document.querySelector('.grid');

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const square = document.createElement('button');
        square.classList.add('square');
        square.classList.add(`square--col-${c}`);

        gridElem.append(square);

        square.addEventListener('click', () => {

        });
      }
    }
  }

  start() {

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