import api from '../../src/scene/api.js';
import { Game } from './js/game.js';

api.ready(async () => {
  init();
});

const cols = 16;
const rows = 4;

/** @type {Game} */
let game;

// create elements on the page.
function createGrid() {
  const gridElem = document.querySelector('.grid');

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const square = document.createElement('div');
      square.classList.add('square');
      square.classList.add(`square--col-${c}`);

      gridElem.append(square);
    }
  }
}

function init() {
  createGrid();

  game = new Game();
  game.start();
}

init();