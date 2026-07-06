import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { L } from './arm.js'

const RAD = Math.PI / 180
const ARM_COLORS = { column: 0x6366f1, upper: 0x818cf8, fore: 0xa5b4fc, hand: 0xc7d2fe }

// Three.js scene: the arm is a true kinematic hierarchy — each joint is a group
// whose rotation is set directly from the solved joint angles, so the render IS
// the forward kinematics.
export class RobotScene {
  constructor(container) {
    this.container = container
    this.boxes = []       // { mesh, color, placed, held }
    this.pads = []        // { mesh, ring, color, x, z }
    this._initThree()
    this._buildGround()
    this._buildArm()
    this._buildTarget()
  }

  _initThree() {
    const W = this.container.clientWidth, H = this.container.clientHeight
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(W, H)
    this.renderer.shadowMap.enabled = true
    this.container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x0a0a0f)
    this.scene.fog = new THREE.Fog(0x0a0a0f, 22, 45)

    this.camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100)
    this.camera.position.set(6.5, 5.5, 7.5)
    this.camera.lookAt(0, 1.5, 0)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 1.2, 0)
    this.controls.maxPolarAngle = Math.PI * 0.49

    const amb = new THREE.AmbientLight(0xffffff, 0.45)
    const dir = new THREE.DirectionalLight(0xffffff, 1.4)
    dir.position.set(6, 10, 4)
    dir.castShadow = true
    dir.shadow.mapSize.set(1024, 1024)
    dir.shadow.camera.left = -8; dir.shadow.camera.right = 8
    dir.shadow.camera.top = 8; dir.shadow.camera.bottom = -8
    const pt = new THREE.PointLight(0x6366f1, 12, 18)
    pt.position.set(-4, 4, -4)
    this.scene.add(amb, dir, pt)
  }

  _buildGround() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 48),
      new THREE.MeshStandardMaterial({ color: 0x12121a, roughness: 0.95 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)
    const grid = new THREE.PolarGridHelper(9, 12, 6, 48, 0x1e1e2e, 0x1e1e2e)
    grid.position.y = 0.002
    this.scene.add(grid)
  }

  _mkLink(len, thick, color) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(len, thick, thick),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 })
    )
    m.position.x = len / 2
    m.castShadow = true
    return m
  }
  _mkJointBall(r = 0.16) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.3, metalness: 0.5 })
    )
    m.castShadow = true
    return m
  }

  _buildArm() {
    // static base plate
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.72, 0.22, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e1e2e, roughness: 0.6, metalness: 0.4 })
    )
    plate.position.y = 0.11
    plate.castShadow = true
    this.scene.add(plate)

    // J1: yaw group
    this.yawGroup = new THREE.Group()
    this.scene.add(this.yawGroup)
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.32, L.base, 24),
      new THREE.MeshStandardMaterial({ color: ARM_COLORS.column, roughness: 0.4, metalness: 0.3 })
    )
    column.position.y = L.base / 2
    column.castShadow = true
    this.yawGroup.add(column)

    // J2: shoulder
    this.shoulderGroup = new THREE.Group()
    this.shoulderGroup.position.y = L.base
    this.yawGroup.add(this.shoulderGroup)
    this.shoulderGroup.add(this._mkJointBall(0.2))
    this.shoulderGroup.add(this._mkLink(L.upper, 0.26, ARM_COLORS.upper))

    // J3: elbow
    this.elbowGroup = new THREE.Group()
    this.elbowGroup.position.x = L.upper
    this.shoulderGroup.add(this.elbowGroup)
    this.elbowGroup.add(this._mkJointBall(0.17))
    this.elbowGroup.add(this._mkLink(L.fore, 0.22, ARM_COLORS.fore))

    // J4: wrist + hand
    this.wristGroup = new THREE.Group()
    this.wristGroup.position.x = L.fore
    this.elbowGroup.add(this.wristGroup)
    this.wristGroup.add(this._mkJointBall(0.14))
    const handLen = L.hand - 0.3
    this.wristGroup.add(this._mkLink(handLen, 0.16, ARM_COLORS.hand))

    // prismatic gripper: two fingers sliding along local Z
    this.gripperGroup = new THREE.Group()
    this.gripperGroup.position.x = handLen
    this.wristGroup.add(this.gripperGroup)
    const palm = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.18, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, metalness: 0.5 })
    )
    palm.castShadow = true
    this.gripperGroup.add(palm)
    const fingerMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35, metalness: 0.4 })
    this.fingerA = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), fingerMat)
    this.fingerB = this.fingerA.clone()
    this.fingerA.position.set(0.17, 0, 0.14)
    this.fingerB.position.set(0.17, 0, -0.14)
    this.fingerA.castShadow = this.fingerB.castShadow = true
    this.gripperGroup.add(this.fingerA, this.fingerB)

    this.tipAnchor = new THREE.Object3D()
    this.tipAnchor.position.x = 0.3
    this.gripperGroup.add(this.tipAnchor)
  }

  _buildTarget() {
    this.targetMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.75 })
    )
    this.scene.add(this.targetMarker)
    this.targetLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.25 })
    )
    this.scene.add(this.targetLine)
  }

  setPose(a) {
    this.yawGroup.rotation.y = -a.yaw * RAD
    this.shoulderGroup.rotation.z = a.shoulder * RAD
    this.elbowGroup.rotation.z = a.elbow * RAD
    this.wristGroup.rotation.z = a.wrist * RAD
  }

  setGripper(open01) {
    const g = 0.06 + 0.12 * open01
    this.fingerA.position.z = g
    this.fingerB.position.z = -g
  }

  setTarget(t) {
    this.targetMarker.position.set(t.x, t.y, t.z)
    // update the drop-line in place — no per-frame geometry allocation
    const pos = this.targetLine.geometry.attributes.position
    pos.setXYZ(0, t.x, 0.01, t.z)
    pos.setXYZ(1, t.x, t.y, t.z)
    pos.needsUpdate = true
  }

  getTipWorld() {
    return this.tipAnchor.getWorldPosition(this._tipScratch || (this._tipScratch = new THREE.Vector3()))
  }

  // ── Boxes & pads ────────────────────────────────────────────────────────────
  spawnTask(boxDefs, padDefs) {
    for (const b of this.boxes) this.scene.remove(b.mesh)
    for (const p of this.pads) { this.scene.remove(p.mesh); this.scene.remove(p.ring) }
    this.boxes = []
    this.pads = []

    for (const d of padDefs) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.02, 32),
        new THREE.MeshStandardMaterial({ color: d.color, transparent: true, opacity: 0.22, roughness: 0.8 })
      )
      mesh.position.set(d.x, 0.012, d.z)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.02, 8, 40),
        new THREE.MeshBasicMaterial({ color: d.color })
      )
      ring.rotation.x = -Math.PI / 2
      ring.position.set(d.x, 0.02, d.z)
      this.scene.add(mesh, ring)
      this.pads.push({ mesh, ring, color: d.color, x: d.x, z: d.z })
    }

    for (const d of boxDefs) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.36, 0.36),
        new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.5, metalness: 0.15 })
      )
      mesh.position.set(d.x, 0.18, d.z)
      mesh.castShadow = true
      this.scene.add(mesh)
      this.boxes.push({ mesh, color: d.color, placed: false, held: false })
    }
  }

  markPlaced(box) {
    box.placed = true
    box.mesh.material.emissive = new THREE.Color(box.color)
    box.mesh.material.emissiveIntensity = 0.45
  }

  render() {
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
  }

  resize() {
    const W = this.container.clientWidth, H = this.container.clientHeight
    this.camera.aspect = W / H
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(W, H)
  }
}
