import '../../styles/main.css'
import { initialState, step, PARAMS } from './physics.js'
import { makeController } from './control.js'
import { render } from './render.js'

document.querySelector('#app').innerHTML = `
<div style="display:flex;flex-direction:column;height:100vh;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;flex-shrink:0;border-bottom:1px solid #1e1e2e;">
    <div style="display:flex;align-items:center;gap:1rem;">
      <a href="${import.meta.env.BASE_URL}index.html" style="color:#64748b;text-decoration:none;font-size:0.875rem;">← Simulations</a>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <h1 style="font-size:1.05rem;font-weight:700;">Self-Righting Pendulum</h1>
        <span style="font-size:0.7rem;font-weight:500;color:#22c55e;background:#22c55e18;padding:0.15rem 0.6rem;border-radius:999px;">LQR · Energy Swing-Up · Control Theory</span>
      </div>
    </div>
    <div id="mode-badge" style="font-size:0.78rem;font-weight:600;padding:0.25rem 0.7rem;border-radius:999px;"></div>
  </div>

  <div style="display:flex;flex:1;min-height:0;">
    <div id="canvas-wrap" style="flex:1;position:relative;">
      <canvas id="pendulum-canvas" style="width:100%;height:100%;display:block;"></canvas>
      <div style="position:absolute;bottom:0.9rem;left:50%;transform:translateX(-50%);font-size:0.78rem;color:#94a3b8;background:#0a0a0fcc;border:1px solid #1e1e2e;padding:0.35rem 0.9rem;border-radius:999px;white-space:nowrap;">
        <strong style="color:#e2e8f0;">← →</strong> or click the track to shove it · <strong style="color:#e2e8f0;">Space</strong> drop from hanging
      </div>
    </div>

    <div style="width:280px;flex-shrink:0;border-left:1px solid #1e1e2e;overflow-y:auto;">
      <div style="padding:0.8rem;border-bottom:1px solid #1e1e2e;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.6rem;">State</p>
        <div id="state-panel" style="display:flex;flex-direction:column;gap:0.5rem;font-size:0.73rem;"></div>
      </div>

      <div style="padding:0.8rem;border-bottom:1px solid #1e1e2e;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.5rem;">Disturb it</p>
        <div style="display:flex;gap:0.4rem;">
          <button id="btn-push-left" class="btn btn-ghost" style="flex:1;font-size:0.75rem;padding:0.4rem;">← Shove</button>
          <button id="btn-push-right" class="btn btn-ghost" style="flex:1;font-size:0.75rem;padding:0.4rem;">Shove →</button>
        </div>
        <button id="btn-reset" class="btn btn-ghost" style="margin-top:0.5rem;width:100%;font-size:0.75rem;padding:0.4rem;">↺ Drop from hanging</button>
        <p style="font-size:0.68rem;color:#475569;margin-top:0.5rem;line-height:1.5;">Watch it recover on its own — no manual correction, no reset needed for a moderate shove.</p>
      </div>

      <div style="padding:0.8rem;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;">Control theory notes</p>
        <ul style="font-size:0.7rem;color:#64748b;line-height:1.65;padding-left:1rem;">
          <li><strong style="color:#94a3b8;">Underactuated</strong> — the motor only pushes the cart; the pole is never driven directly. Uprighting it means pumping energy through the cart's motion.</li>
          <li><strong style="color:#94a3b8;">Energy-shaping swing-up</strong> — derived from the equations of motion: commanding cart acceleration ∝ cosθ·θ̇·E drives total mechanical energy toward the upright level every pass.</li>
          <li><strong style="color:#94a3b8;">LQR balance</strong> — near vertical, control hands off to a linear-quadratic regulator: the plant is linearized about the upright equilibrium and the discrete Riccati equation is solved for optimal state feedback.</li>
          <li><strong style="color:#94a3b8;">Hysteresis switch</strong> — separate enter/exit thresholds between the two modes stop them from chattering back and forth at the boundary.</li>
        </ul>
      </div>
    </div>
  </div>
</div>
`

const canvas = document.getElementById('pendulum-canvas')
let state = initialState()
const ctrl = makeController()
let lastForce = 0
let pushFlashUntil = 0

// Physics runs on a fixed substep for stability, independent of frame rate.
const SUBSTEP = 1 / 240
let accumulator = 0
let lastT = performance.now()

// Verified-safe disturbance: within this range recovery is reliable every
// time (see control.js notes) — beyond it the swing-up basin gets chaotic,
// which makes for an unsatisfying "sometimes it just doesn't come back" demo.
const SHOVE_THETADOT = 1.8
const SHOVE_XDOT = 1.6

function shove(dir) {
  // A push near the top nudges the pole; a push while hanging/swinging nudges
  // the cart instead — both read as "someone bumped it" from wherever it is.
  const nearUpright = Math.abs(((state.theta + Math.PI) % (2 * Math.PI)) - Math.PI) < 0.5
  if (nearUpright) state = { ...state, thetadot: state.thetadot + dir * SHOVE_THETADOT }
  else state = { ...state, xdot: state.xdot + dir * SHOVE_XDOT }
  pushFlashUntil = performance.now() + 300
}

document.getElementById('btn-push-left').addEventListener('click', () => shove(-1))
document.getElementById('btn-push-right').addEventListener('click', () => shove(1))
document.getElementById('btn-reset').addEventListener('click', () => {
  state = initialState()
  ctrl.reset()
})

window.addEventListener('keydown', e => {
  if (e.code === 'ArrowLeft') { e.preventDefault(); shove(-1) }
  else if (e.code === 'ArrowRight') { e.preventDefault(); shove(1) }
  else if (e.code === 'Space') { e.preventDefault(); state = initialState(); ctrl.reset() }
})
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect()
  shove(e.clientX - rect.left < rect.width / 2 ? -1 : 1)
})

function fmtDeg(rad) { return (rad * 180 / Math.PI).toFixed(1) + '°' }

function updateStatePanel(mode) {
  const modeStyle = {
    balance: { bg: '#22c55e18', color: '#22c55e', label: '● Balancing' },
    'swing-up': { bg: '#f59e0b18', color: '#f59e0b', label: '◐ Swinging up' },
    'kick-start': { bg: '#f59e0b18', color: '#f59e0b', label: '◐ Kick-starting' },
  }[mode]
  const badge = document.getElementById('mode-badge')
  badge.textContent = modeStyle.label
  badge.style.background = modeStyle.bg
  badge.style.color = modeStyle.color

  // Angle from upright (0 = perfectly vertical), signed
  const fromUpright = ((state.theta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  const rows = [
    ['Angle from vertical', fmtDeg(fromUpright), Math.abs(fromUpright) < 0.1 ? '#22c55e' : '#e2e8f0'],
    ['Angular rate', (state.thetadot).toFixed(2) + ' rad/s', '#94a3b8'],
    ['Cart position', state.x.toFixed(2) + ' m', Math.abs(state.x) > PARAMS.trackHalfWidth * 0.9 ? '#ef4444' : '#94a3b8'],
    ['Cart velocity', state.xdot.toFixed(2) + ' m/s', '#94a3b8'],
    ['Motor force', lastForce.toFixed(1) + ' N', Math.abs(lastForce) > PARAMS.forceMax * 0.9 ? '#f59e0b' : '#94a3b8'],
  ]
  document.getElementById('state-panel').innerHTML = rows.map(([k, v, c]) => `
    <div style="display:flex;justify-content:space-between;">
      <span style="color:#64748b;">${k}</span><span style="color:${c};font-weight:600;">${v}</span>
    </div>`).join('')
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000)
  lastT = now
  accumulator += dt

  let mode = 'balance'
  while (accumulator >= SUBSTEP) {
    const r = ctrl.compute(state)
    lastForce = r.force
    mode = r.mode
    state = step(state, r.force, SUBSTEP)
    accumulator -= SUBSTEP
  }

  render(canvas, state, { force: now < pushFlashUntil ? lastForce : lastForce })
  updateStatePanel(mode)

  requestAnimationFrame(loop)
}

// debug hook for automated verification
window.__pendulumDebug = { get state() { return state }, shove, reset: () => { state = initialState(); ctrl.reset() } }

requestAnimationFrame(loop)
