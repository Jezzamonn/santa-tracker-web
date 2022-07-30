import api from '../../src/scene/api.js';
import { Game } from './js/game.js';

api.ready(async (data) => {
  init(data);
});

/** @type {Game} */
let game;

function init(data) {
  game = new Game((beatString) => {
    // Update the URL with a query parameter of the beat
    api.data({'beat': beatString});
  });

  const initalBeatString = data?.beat ?? '';

  game.setUp(initalBeatString);
  game.start();
}
