import api from '../../src/scene/api.js';
import { Game } from './js/game.js';

api.ready(async () => {
  init();
});

/** @type {Game} */
let game;

function init() {
  game = new Game();
  game.setUp();
  game.start();
}
