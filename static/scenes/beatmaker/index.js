import api from '../../src/scene/api.js';
import { Game } from './js/game.js';

api.ready(async () => {
  init();
});

/** @type {Game} */
let game;

function init() {
  game = new Game((beatString) => {
    // Update the URL with a query parameter of the beat
    api.data({'beat': beatString});
  });
  game.setUp();
  game.start();
}
