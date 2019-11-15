import Obj from '../index.js'
import LoaderManager from '../../../managers/LoaderManager.js'

// Config
import GLOBAL_CONFIG from '../../Scene/config.js'
import CONFIG from './config.js'

class QuarterCircle extends Obj {
  constructor(scene, world, material) {
    // Physics
    super(scene, world)

    // Props
    this.material = material
    this.selectable = CONFIG.SELECTABLE
    this.mass = CONFIG.MASS
    this.rotationY = CONFIG.ROTATION_Y
    this.size = CONFIG.SIZE
    this.name = CONFIG.NAME
    // this.normalMap = CONFIG.NORMAL_MAP
    this.obj = CONFIG.OBJ
    this.wrl = CONFIG.WRL
  }

  init() {
    const { obj, wrl, normalMap } = LoaderManager.subjects[this.name]

    // Collision model
    this.collisionModel = wrl
    console.log(obj, wrl)

    // Geometry
    this.geometry = obj.children[0].geometry

    console.log(this.geometry)
    // this.geometry.center()

    // Materials
    const defaultMaterial = new THREE.MeshToonMaterial({
      color: GLOBAL_CONFIG.COLORS.ICE,
      shininess: 345,
      normalMap,
    })
    defaultMaterial.needsUpdate = true

    this.setShape(defaultMaterial)
  }

  createShapes(scale = 1) {
    this.createShapesFromWRL(this.collisionModel, scale)
    // this.createShapesFromOBJ(this.geometry, scale)
  }
}

export default QuarterCircle
