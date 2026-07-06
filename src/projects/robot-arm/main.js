import '../../styles/main.css'
import { solveIK, JOINTS, L } from './arm.js'
import { RobotScene } from './scene.js'

const BOX_COLORS = [0xef4444, 0x22c55e, 0x3b82f6]
const COLOR_NAMES = { 0xef4444: 'Red', 0x22c55e: 'Green', 0x3b82f6: 'Blue' }

document.querySelector('#app').innerHTML = `
<div style="display:flex;flex-direction:column;height:100vh;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;flex-shrink:0;border-bottom:1px solid #1e1e2e;">
    <div style="display:flex;align-items:center;gap:1rem;">
      <a href="${import.meta.env.BASE_URL}index.html" style="color:#64748b;text-decoration:none;font-size:0.875rem;">← Simulations</a>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <h1 style="font-size:1.05rem;font-weight:700;">Robot Arm — Pick &amp; Place</h1>
        <span style="font-size:0.7rem;font-weight:500;color:#6366f1;background:#6366f118;padding:0.15rem 0.6rem;border-radius:999px;">4-DOF · Analytic IK · Joint limits</span>
      </div>
    </div>
    <div id="score" style="font-size:0.85rem;color:#e2e8f0;font-weight:600;"></div>
  </div>

  <div style="display:flex;flex:1;min-height:0;">
    <div id="three-container" style="flex:1;position:relative;">
      <div id="hint" style="position:absolute;bottom:0.9rem;left:50%;transform:translateX(-50%);font-size:0.78rem;color:#94a3b8;background:#0a0a0fcc;border:1px solid #1e1e2e;padding:0.35rem 0.9rem;border-radius:999px;white-space:nowrap;">
        <strong style="color:#e2e8f0;">A/D</strong> rotate base · <strong style="color:#e2e8f0;">W/S</strong> reach out/in · <strong style="color:#f59e0b;">hold Space</strong> dip to grab / release · drag to orbit
      </div>
      <div id="toast" style="display:none;position:absolute;top:1rem;left:50%;transform:translateX(-50%);font-size:0.85rem;font-weight:600;color:#22c55e;background:#0a0a0fee;border:1px solid #22c55e55;padding:0.5rem 1.1rem;border-radius:0.5rem;"></div>
    </div>

    <div style="width:280px;flex-shrink:0;border-left:1px solid #1e1e2e;overflow-y:auto;">
      <div style="padding:0.8rem;border-bottom:1px solid #1e1e2e;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;">
          <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;">Joints</p>
          <span style="font-size:0.65rem;color:#64748b;">red = at limit</span>
        </div>
        <div id="joint-panel" style="display:flex;flex-direction:column;gap:0.55rem;"></div>
      </div>

      <div style="padding:0.8rem;border-bottom:1px solid #1e1e2e;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;">Gripper</p>
        <p id="grip-status" style="font-size:0.75rem;color:#94a3b8;"></p>
        <p style="font-size:0.68rem;color:#475569;margin-top:0.3rem;">Prismatic fingers — the only non-revolute joint on the arm.</p>
      </div>

      <div style="padding:0.8rem;border-bottom:1px solid #1e1e2e;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;">Task</p>
        <p style="font-size:0.73rem;color:#94a3b8;line-height:1.55;">Carry each colored box to its matching pad. Hover over a box, then <strong style="color:#e2e8f0;">hold Space</strong> — the arm dips, grabs, and lifts when you let go. Dip again over the pad to set it down.</p>
        <button id="btn-reset" class="btn btn-ghost" style="margin-top:0.6rem;width:100%;font-size:0.75rem;padding:0.35rem;">Scramble boxes</button>
      </div>

      <div style="padding:0.8rem;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;">Robotics notes</p>
        <ul style="font-size:0.7rem;color:#64748b;line-height:1.65;padding-left:1rem;">
          <li><strong style="color:#94a3b8;">Cylindrical jog</strong> — the target is commanded in (θ, r) like a teach-pendant jog mode; the base spins continuously, 360°.</li>
          <li><strong style="color:#94a3b8;">RRRR chain</strong> — revolute base + 3 pitch hinges; J2–J4 have hard limits.</li>
          <li><strong style="color:#94a3b8;">Analytic IK</strong> — shoulder/elbow by the law-of-cosines two-link solution (elbow-up branch).</li>
          <li><strong style="color:#94a3b8;">Orientation constraint</strong> — the wrist auto-solves to keep the gripper vertical for top-down grasps.</li>
          <li><strong style="color:#94a3b8;">Workspace</strong> — reach is clamped to the two-link annulus; saturated joints show red.</li>
        </ul>
      </div>
    </div>
  </div>
</div>
`

// ── Scene & state ─────────────────────────────────────────────────────────────
const container = document.getElementById('three-container')
const scene = new RobotScene(container)

// Cylindrical command: base angle θ (continuous), reach r, plus a dip height.
const CARRY_Y = 1.5
const GRAB_Y = 0.44
const cmd = { yawDeg: 0, r: 2.6, y: CARRY_Y }
const keys = new Set()
let spaceHeld = false
let dipAction = null      // null | 'pending' | 'done' — one grab/release per dip
let holding = null
let placedCount = 0
let toastTimer = null

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'])
window.addEventListener('keydown', e => {
  if (!MOVE_KEYS.has(e.code)) return
  e.preventDefault()
  if (e.code === 'Space') {
    if (!spaceHeld) { spaceHeld = true; dipAction = 'pending' }
  } else keys.add(e.code)
})
window.addEventListener('keyup', e => {
  if (e.code === 'Space') { spaceHeld = false; dipAction = null }
  else keys.delete(e.code)
})

// ── Task setup ────────────────────────────────────────────────────────────────
function scramble() {
  holding = null
  placedCount = 0
  // pads first: evenly spread around the base at a random offset
  const base = Math.random() * 360
  const padDefs = [0, 1, 2].map(i => {
    const a = (base + i * 120) * Math.PI / 180
    return { color: BOX_COLORS[i], x: 3.1 * Math.cos(a), z: 3.1 * Math.sin(a) }
  })
  // boxes: spread out AND kept clear of every pad so nothing spawns pre-placed
  const boxDefs = []
  let guard = 0
  while (boxDefs.length < 3 && guard++ < 400) {
    const ang = Math.random() * 2 * Math.PI
    const r = 2.2 + Math.random() * 1.4
    const x = r * Math.cos(ang), z = r * Math.sin(ang)
    if (boxDefs.every(b => Math.hypot(b.x - x, b.z - z) > 1.2) &&
        padDefs.every(p => Math.hypot(p.x - x, p.z - z) > 1.3)) {
      boxDefs.push({ color: BOX_COLORS[boxDefs.length], x, z })
    }
  }
  scene.spawnTask(boxDefs, padDefs)
  updateScore()
}
document.getElementById('btn-reset').addEventListener('click', scramble)

function toast(msg, color = '#22c55e') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.style.color = color
  el.style.borderColor = color + '55'
  el.style.display = 'block'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.style.display = 'none' }, 2200)
}

function updateScore() {
  document.getElementById('score').innerHTML =
    `Placed <span style="color:#22c55e;">${placedCount}</span> / ${scene.boxes.length}`
}

// ── Grab / release (fires once, at the bottom of a dip) ──────────────────────
function grabPoint() {
  const tip = scene.getTipWorld()
  return { x: tip.x, y: tip.y - 0.26, z: tip.z }
}

function dipActionFire() {
  const g = grabPoint()
  if (holding) {
    const box = holding
    holding = null
    box.held = false
    box.mesh.position.set(g.x, 0.18, g.z)
    const pad = scene.pads.find(p => p.color === box.color)
    if (pad && Math.hypot(pad.x - g.x, pad.z - g.z) < 0.62) {
      box.mesh.position.set(pad.x, 0.18, pad.z)
      scene.markPlaced(box)
      placedCount++
      updateScore()
      toast(placedCount === scene.boxes.length
        ? '🎉 All boxes placed! Hit "Scramble boxes" to go again.'
        : `${COLOR_NAMES[box.color]} box placed!`)
    } else {
      toast(`${COLOR_NAMES[box.color]} box set down`, '#94a3b8')
    }
    return
  }
  let best = null, bestD = 0.55
  for (const b of scene.boxes) {
    if (b.placed) continue
    const d = Math.hypot(b.mesh.position.x - g.x, b.mesh.position.y - g.y, b.mesh.position.z - g.z)
    if (d < bestD) { bestD = d; best = b }
  }
  if (best) { holding = best; best.held = true; toast(`Grabbed the ${COLOR_NAMES[best.color]} box`, '#f59e0b') }
  else toast('Nothing under the gripper — line up over a box first', '#f59e0b')
}

// ── HUD ───────────────────────────────────────────────────────────────────────
const jointPanel = document.getElementById('joint-panel')
const wrap180 = a => ((a + 180) % 360 + 360) % 360 - 180

function renderJoints(ik) {
  jointPanel.innerHTML = JOINTS.map(j => {
    const raw = ik.angles[j.key]
    const a = j.continuous ? wrap180(raw) : raw
    const atLimit = !j.continuous && (ik.clamped[j.key] || a <= j.min + 0.5 || a >= j.max - 0.5)
    const frac = (a - j.min) / (j.max - j.min)
    const color = atLimit ? '#ef4444' : '#6366f1'
    return `
    <div>
      <div style="display:flex;justify-content:space-between;font-size:0.72rem;">
        <span style="color:#e2e8f0;font-weight:600;">${j.name}</span>
        <span style="color:${atLimit ? '#ef4444' : '#94a3b8'};">${a.toFixed(1)}°</span>
      </div>
      <div style="font-size:0.62rem;color:#475569;margin:1px 0 3px;">${j.type}${j.continuous ? '' : ` · [${j.min}°, ${j.max}°]`}</div>
      <div style="height:5px;background:#1e1e2e;border-radius:3px;position:relative;">
        <div style="position:absolute;left:${(Math.max(0, Math.min(1, frac)) * 100).toFixed(1)}%;top:-2px;width:3px;height:9px;background:${color};border-radius:2px;"></div>
      </div>
    </div>`
  }).join('')
  document.getElementById('grip-status').innerHTML = holding
    ? `<span style="color:#f59e0b;">Closed — carrying the ${COLOR_NAMES[holding.color]} box</span>`
    : (spaceHeld ? '<span style="color:#fbbf24;">Dipping…</span>' : 'Open — hover a box and <strong style="color:#e2e8f0;">hold Space</strong>')
}

// ── Main loop ─────────────────────────────────────────────────────────────────
const YAW_SPEED = 110       // deg/s — A/D spins the base, endlessly
const R_SPEED = 2.3         // units/s — W/S jogs the reach
const R_MIN = 0.85, R_MAX = L.upper + L.fore - 0.05
let lastT = performance.now()
let frame = 0

function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000)
  lastT = now

  const dYaw = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
  const dR = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
  cmd.yawDeg += dYaw * YAW_SPEED * dt
  cmd.r = Math.max(R_MIN, Math.min(R_MAX, cmd.r + dR * R_SPEED * dt))

  // Holding Space dips the arm to grab height; releasing lifts it back.
  const goalY = spaceHeld ? GRAB_Y : CARRY_Y
  cmd.y += (goalY - cmd.y) * Math.min(1, dt * 7)

  const yawR = cmd.yawDeg * Math.PI / 180
  const target = { x: cmd.r * Math.cos(yawR), y: cmd.y, z: cmd.r * Math.sin(yawR) }

  const ik = solveIK(target, cmd.yawDeg)
  scene.setPose(ik.angles)
  scene.setTarget(target)
  scene.setGripper(holding ? 0 : (spaceHeld ? 0.4 : 1))

  // Fire the grab/release once, at the bottom of the dip
  if (spaceHeld && dipAction === 'pending' && cmd.y < GRAB_Y + 0.06) {
    dipActionFire()
    dipAction = 'done'
  }

  if (holding) {
    const g = grabPoint()
    holding.mesh.position.set(g.x, Math.max(0.18, g.y - 0.05), g.z)
  }

  if (frame % 4 === 0) renderJoints(ik)
  frame++

  scene.render()
  requestAnimationFrame(loop)
}

window.addEventListener('resize', () => scene.resize())

// debug hook for automated checks
window.__armDebug = {
  cmd,
  get holding() { return holding },
  get placed() { return placedCount },
  get spaceHeld() { return spaceHeld },
  scene, solveIK,
}

scramble()
requestAnimationFrame(loop)
