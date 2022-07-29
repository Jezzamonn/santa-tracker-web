import { Beat } from "./beat.js";
import { Sequencer } from "./sequencer.js";

const samples = [
  "jingle-bells",
  "closed-hh",
  "open-hh",
  "snare",
  "kick",
  "floor-tom",
  "floor-tom",
  "rack-tom-1",
  "rack-tom-2",
  "bell",
  "crash-right",
  "crash-left",
]

const totalBeats = 16;
const totalInstruments = samples.length;

export class Game {

  constructor() {
    /** @type {!Sequencer} */
    this.sequencer = new Sequencer();
    this.beat = new Beat(totalBeats, totalInstruments);

    this.sequencer.onBeat = () => this.onBeat();
  }

  setUp() {
    this.createGrid();

    const url = new URL(location.href);
    const beatString = url.searchParams.get('beat');
    if (beatString !== null) {
      this.beat.updateFromString(beatString);
    }

    const playButton = document.querySelector('.play-button');
    playButton.addEventListener('click', () => this.playOrStop());
  }

  playOrStop() {
    if (this.sequencer.isPlaying) {
      this.sequencer.stop();
    }
    else {
      this.sequencer.start();
    }
    this.updateActiveColumn(this.sequencer.currentBeat);
  }

  onBeat() {
    const currentBeat = this.sequencer.currentBeat;

    this.updateActiveColumn(currentBeat);

    const activeInstruments = this.beat.getActiveInstruments(currentBeat);
    for (const instrument of activeInstruments) {
      this.playInstrument(instrument);
    }
  }

  playInstrument(instrument) {
    // TODO: Respect mutedness.
    const sampleName = samples[instrument];
    const samplePath = `./media/${sampleName}.mp3`;
    const audio = new Audio(samplePath);
    audio.play();
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

        square.addEventListener('click', () => {
          this.beat.toggleBeat(i, b);
          this.updateUrl();

          const isEnabled = this.beat.isInstrumentActive(i, b);
          square.classList.toggle('square--enabled', isEnabled);
          if (isEnabled) {
            this.playInstrument(i);
          }
        });

        gridElem.append(square);
      }
    }
  }

  updateUrl() {
    console.log('updating it?');
    const newUrl = new URL(location.href);
    newUrl.search = `?beat=${this.beat.toString()}`;

    // TODO: This needs to echo out to the host.
    history.replaceState(null, '', newUrl.href);

    console.log(newUrl.href);
  }

  start() {
    this.sequencer.start();
  }

  /**
   * @param {!number} column Which column to light up in the UI. Values outside the range will turn off highlighting for all rows.
   */
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