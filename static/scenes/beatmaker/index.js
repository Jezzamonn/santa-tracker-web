import api from '../../src/scene/api.js';
import { Game } from './js/game.js';

api.ready(async () => {
  init();
});

const cols = 16;
const rows = 4;

/** @type {Game} */
let game;

function init() {
  game = new Game();
  game.setUp();
  game.start();
}

init();