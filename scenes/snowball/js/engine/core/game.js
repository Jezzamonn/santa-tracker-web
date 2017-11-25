import { BasicElement } from '../utils/basic-element.js';
import { RenderSystem } from '../systems/render-system.js';
import { ClockSystem } from '../systems/clock-system.js';
import { InputSystem } from '../systems/input-system.js';

const {
  PerspectiveCamera,
  OrthographicCamera
} = self.THREE;

const template = document.createElement('template');

template.innerHTML = `
<style>
  :host {
    display: flex;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
</style>`;

export class Game extends BasicElement {
  static get template() { return template; }

  constructor(...args) {
    super(...args);

    this.stampTemplate();
    this.renderSystem = new RenderSystem();
    this.clockSystem = new ClockSystem();
    this.inputSystem = new InputSystem();

    this.camera = new OrthographicCamera(1, 1, 1, 1, 1, 100000);
    this.currentLevel = null;
    this.ready = false;

    this.shadowRoot.appendChild(this.renderSystem);
    this.shadowRoot.appendChild(this.inputSystem);

    this.clockSystem.startClock('gameloop', time => {
      this.preciseTick = time * 60 / 1000;
      this.tick = Math.floor(this.preciseTick);

      if (!this.ready) {
        this.setup();
        this.ready = true;
      }

      if (this.currentLevel == null) {
        return;
      }

      this.update();
    });

    self.addEventListener('resize', () => this.measure());
  }

  connectedCallback() {
    this.measure();
  }

  measure() {
    this.width = self.innerWidth;
    this.height = self.innerHeight;

    if (this.currentLevel != null) {
      this.currentLevel.measure(this);
    }

    this.camera.aspect = this.width / this.height;
    this.camera.left = -this.width / 2;
    this.camera.right = this.width / 2;
    this.camera.top = this.height / 2;
    this.camera.bottom = -this.height / 2;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    this.renderSystem.measure(this);
  }

  setup() {}

  update() {
    this.currentLevel.update(this);
    this.renderSystem.update(this);
    this.inputSystem.update(this);
  }

  set level(level) {
    if (this.currentLevel) {
      this.currentLevel.teardown(this);
    }

    this.camera.position.copy(level.position);
    this.camera.position.z = -3200;
    this.camera.lookAt(level.position);
    this.camera.rotation.z = 0;

    this.currentLevel = level;
    this.currentLevel.setup(this);
  }

  get level() {
    return this.currentLevel;
  }
}