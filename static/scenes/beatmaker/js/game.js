import { Beat } from "./beat.js";
import { Sequencer } from "./sequencer.js";

const totalBeats = 16;
const totalInstruments = 4;

export class Game {

  constructor() {
    /** @type {!Sequencer} */
    this.sequencer = new Sequencer();
    this.beat = new Beat(totalBeats, totalInstruments);

    this.sequencer.onBeat = () => {
      const currentBeat = this.sequencer.currentBeat;

      this.updateActiveColumn(currentBeat);

      const activeInstruments = this.beat.getActiveInstruments(currentBeat);
      for (const instrument of activeInstruments) {
        if (instrument === 0) {
          // play the bell? TODO: This is pretty hacky.
          const audio = new Audio('./media/jingle-bells.mp3');
          audio.play();
        }
      }
    }
  }

  setUp() {
    this.createGrid();
  }

  // create elements on the page.
  createGrid() {
    const gridElem = document.querySelector('.grid');

    for (let i = 0; i < totalInstruments; i++) {
      for (let b = 0; b < totalBeats; b++) {
        const square = document.createElement('button');
        square.classList.add('square');
        square.classList.add(`square--col-${b}`);

        if (i % 2 == 0) {
          square.classList.add('square--even-row');
        }

        gridElem.append(square);

        square.addEventListener('click', () => {
          this.beat.toggleBeat(i, b);
          square.classList.toggle('square--enabled', this.beat.isInstrumentActive(i, b));
        });
      }
    }
  }

  start() {

    this.sequencer.start();
  }

  updateActiveColumn(column) {
    // Clear existing highlighted totalInstruments
    const activeSquares = document.querySelectorAll('.square--playing');
    for (const activeSquare of activeSquares) {
      activeSquare.classList.remove('square--playing')
    }

    const newSquares = document.querySelectorAll(`.square--col-${column}`);
    for (const newSquare of newSquares) {
      newSquare.classList.add('square--playing');
    }
  }
}