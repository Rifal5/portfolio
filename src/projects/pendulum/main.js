import '../../styles/main.css'
import { PLANTS } from './plants/index.js'
import { CONTROLLERS } from './controllers/index.js'
import { makeSingleSwingUp } from './controllers/energy.js'
import { makeSim, SUBSTEP } from './sim.js'
import { render } from './render.js'
import { renderNet } from './net-view.js'

// Per-plant swing-up laws (the double's is added in Phase 5).
const SWINGUPS = { single: makeSingleSwingUp }

const state = { plantKey: 'single', ctrlKey: 'lqr', realistic: false, targetEq: 0 }

document.querySelector('#app').innerHTML = `
<div style="display:flex;flex-direction:column;height:100vh;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;flex-shrink:0;border-bottom:1px solid #1e1e2e;gap:1rem;flex-wrap:wrap;">
    <div style="display:flex;align-items:center;gap:1rem;">
      <a href="${import.meta.env.BASE_URL}index.html" style="color:#64748b;text-decoration:none;font-size:0.875rem;">← Simulations</a>
      <h1 style="font-size:1.05rem;font-weight:700;">Self-Righting Pendulum</h1>
    </div>
    <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;">
      <label style="font-size:0.72rem;color:#64748b;">Plant
        <select id="sel-plant" class="pend-select"></select>
      </label>
      <label style="font-size:0.72rem;color:#64748b;">Controller
        <select id="sel-ctrl" class="pend-select"></select>
      </label>
      <label id="lbl-target" style="font-size:0.72rem;color:#64748b;display:none;">Target
        <select id="sel-target" class="pend-select"></select>
      </label>
      <div id="toggle-real" style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;user-select:none;font-size:0.75rem;">
        <span style="color:#64748b;">Ideal</span>
        <span id="switch" style="width:34px;height:18px;border-radius:999px;background:#334155;position:relative;transition:background .15s;">
          <span id="knob" style="position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#e2e8f0;transition:left .15s;"></span>
        </span>
        <span style="color:#e2e8f0;font-weight:600;">Realistic</span>
      </div>
      <div id="mode-badge" style="font-size:0.75rem;font-weight:600;padding:0.22rem 0.65rem;border-radius:999px;"></div>
    </div>
  </div>

  <div style="display:flex;flex:1;min-height:0;">
    <div style="flex:1;position:relative;">
      <canvas id="pend-canvas" style="width:100%;height:100%;display:block;"></canvas>
      <div id="hint" style="position:absolute;bottom:0.9rem;left:50%;transform:translateX(-50%);font-size:0.76rem;color:#94a3b8;background:#0a0a0fcc;border:1px solid #1e1e2e;padding:0.35rem 0.9rem;border-radius:999px;white-space:nowrap;"></div>
    </div>

    <div style="width:290px;flex-shrink:0;border-left:1px solid #1e1e2e;overflow-y:auto;">
      <div style="padding:0.8rem;border-bottom:1px solid #1e1e2e;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.6rem;">State</p>
        <div id="state-panel" style="display:flex;flex-direction:column;gap:0.5rem;font-size:0.73rem;"></div>
      </div>
      <div style="padding:0.8rem;border-bottom:1px solid #1e1e2e;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.5rem;">Disturb it</p>
        <div style="display:flex;gap:0.4rem;">
          <button id="shove-l" class="btn btn-ghost" style="flex:1;font-size:0.75rem;padding:0.4rem;">← Shove</button>
          <button id="shove-r" class="btn btn-ghost" style="flex:1;font-size:0.75rem;padding:0.4rem;">Shove →</button>
        </div>
        <button id="reset" class="btn btn-ghost" style="margin-top:0.5rem;width:100%;font-size:0.75rem;padding:0.4rem;">↺ Drop from hanging</button>
        <button id="motor" class="btn btn-ghost" style="margin-top:0.4rem;width:100%;font-size:0.75rem;padding:0.4rem;">⏻ Motor: On</button>
        <div id="trip-banner" style="display:none;margin-top:0.5rem;font-size:0.68rem;color:#ef4444;background:#ef444414;border:1px solid #ef444433;border-radius:6px;padding:0.4rem 0.5rem;line-height:1.4;"></div>
      </div>
      <div id="neural-panel" style="padding:0.8rem;border-bottom:1px solid #1e1e2e;display:none;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;">Network</p>
        <canvas id="net-canvas" style="width:100%;height:150px;display:block;background:#0d0d14;border:1px solid #1e1e2e;border-radius:6px;"></canvas>
        <p style="font-size:0.62rem;color:#475569;margin:0.35rem 0 0.6rem;line-height:1.4;">Nodes = live activations (green +, red −); edges = weights (cyan +, red −). Inputs left, motor force right.</p>
        <button id="retrain" class="btn btn-ghost" style="width:100%;font-size:0.75rem;padding:0.4rem;">⟳ Retrain from scratch</button>
        <p id="train-status" style="font-size:0.68rem;color:#64748b;margin-top:0.5rem;line-height:1.5;">Ships with a pre-trained champion. Retrain to watch neuroevolution climb, then it takes over live.</p>
      </div>
      <div style="padding:0.8rem;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;">How it works</p>
        <div id="notes" style="font-size:0.7rem;color:#64748b;line-height:1.6;"></div>
      </div>
    </div>
  </div>
</div>
<style>
  .pend-select{background:#12121a;color:#e2e8f0;border:1px solid #1e1e2e;border-radius:6px;padding:0.2rem 0.4rem;font-size:0.75rem;margin-left:0.3rem;}
  .pend-select option:disabled{color:#475569;}
</style>
`

const canvas = document.getElementById('pend-canvas')
const netCanvas = document.getElementById('net-canvas')

// --- build selectors ---
const selPlant = document.getElementById('sel-plant')
for (const key of Object.keys(PLANTS)) {
  const o = document.createElement('option'); o.value = key; o.textContent = PLANTS[key].meta.label; selPlant.appendChild(o)
}
const selCtrl = document.getElementById('sel-ctrl')
function refreshCtrlOptions() {
  selCtrl.innerHTML = ''
  for (const [key, c] of Object.entries(CONTROLLERS)) {
    const o = document.createElement('option'); o.value = key
    const compatible = c.plants.includes(state.plantKey)
    o.textContent = c.label + (compatible ? '' : ' — n/a for this plant')
    o.disabled = !compatible
    selCtrl.appendChild(o)
  }
  if (!CONTROLLERS[state.ctrlKey].plants.includes(state.plantKey)) state.ctrlKey = 'lqr'
  selCtrl.value = state.ctrlKey
}

// Show/populate the target-equilibrium selector for the double; update labels.
function onPlantChange() {
  refreshCtrlOptions()
  const isDouble = state.plantKey === 'double'
  document.getElementById('lbl-target').style.display = isDouble ? '' : 'none'
  const st = document.getElementById('sel-target')
  if (isDouble) {
    st.innerHTML = ''
    PLANTS.double.meta.equilibria.forEach((eq, i) => {
      const o = document.createElement('option'); o.value = i; o.textContent = eq.label; st.appendChild(o)
    })
    if (state.targetEq >= PLANTS.double.meta.equilibria.length) state.targetEq = 0
    st.value = state.targetEq
  }
  document.getElementById('reset').textContent = isDouble ? '↺ Reset near target' : '↺ Drop from hanging'
}

// --- sim wiring ---
let plant, sim
function buildController() {
  const c = CONTROLLERS[state.ctrlKey]
  if (plant.meta.name === 'double') {
    // LQR stabilizes the selected equilibrium (started near it). The neural
    // balancer holds both-up only. Either way, no global swing-up (out of scope).
    if (state.ctrlKey === 'lqr') return c.make(plant, { targetEq: state.targetEq, enter: () => true, exit: () => false })
    return c.make(plant, {})
  }
  const swing = SWINGUPS[state.plantKey]
  return c.make(plant, swing ? { swingUp: swing(plant) } : {})
}
// Where the pole starts: the single drops from hanging (to show swing-up); the
// double starts near its target equilibrium so it can be held (neural balances
// both-up only). Global swing-up of the double is out of scope.
function startState() {
  if (state.ctrlKey === 'manual') return plant.initialState() // start at rest; you drive
  if (plant.meta.name !== 'double') return plant.initialState()
  const idx = state.ctrlKey === 'neural' ? 0 : state.targetEq // neural = both-up
  const eq = plant.fromVec(plant.meta.equilibria[idx].x)
  return { ...eq, theta1: eq.theta1 + 0.1, theta2: eq.theta2 - 0.1, x: 0 }
}
let currentController
function rebuild() {
  plant = PLANTS[state.plantKey]
  currentController = buildController()
  sim = makeSim({ plant, controller: currentController, realistic: state.realistic, autoTrip: state.ctrlKey !== 'manual' })
  sim.reset(startState())
  document.getElementById('neural-panel').style.display = state.ctrlKey === 'neural' ? '' : 'none'
  // Neural on the double only balances both-up, so the target selector is fixed there.
  const targetFixed = state.plantKey === 'double' && state.ctrlKey === 'neural'
  const selT = document.getElementById('sel-target')
  selT.disabled = targetFixed
  if (targetFixed) { state.targetEq = 0; selT.value = 0 }
  refreshNotes()
  updateHint()
}

// --- live neuroevolution (Web Worker) ---
let trainWorker = null
function retrain() {
  const status = document.getElementById('train-status')
  const btn = document.getElementById('retrain')
  if (trainWorker) { trainWorker.terminate(); trainWorker = null }
  trainWorker = new Worker(new URL('./neural/train-worker.js', import.meta.url), { type: 'module' })
  btn.disabled = true; btn.textContent = 'Evolving…'
  trainWorker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'progress') {
      status.textContent = `Gen ${m.gen + 1}/${m.gens} — best fitness ${m.best.toFixed(2)}`
    } else if (m.type === 'done') {
      if (state.ctrlKey === 'neural' && currentController.setWeights) currentController.setWeights(m.weights)
      status.textContent = `Done — champion fitness ${m.fitness.toFixed(2)}. It's driving now.`
      btn.disabled = false; btn.textContent = '⟳ Retrain from scratch'
      trainWorker.terminate(); trainWorker = null
    }
  }
  trainWorker.postMessage({ plantKey: state.plantKey })
}

// --- disturbances (verified-safe range) ---
const SHOVE_THETADOT = 1.8, SHOVE_XDOT = 1.6
function shove(dir) {
  if (plant.meta.name === 'double') {
    // A cart bump — the cleanest disturbance for the double; the LQR recovers.
    sim.disturb(st => ({ ...st, xdot: st.xdot + dir * 0.9, theta1dot: st.theta1dot + dir * 0.6 }))
    return
  }
  const nearUp = Math.abs(wrapPi(sim.state.theta)) < 0.5
  sim.disturb(st => nearUp ? { ...st, thetadot: st.thetadot + dir * SHOVE_THETADOT }
                           : { ...st, xdot: st.xdot + dir * SHOVE_XDOT })
}
function wrapPi(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

document.getElementById('shove-l').onclick = () => shove(-1)
document.getElementById('shove-r').onclick = () => shove(1)
document.getElementById('reset').onclick = () => sim.reset(startState())
document.getElementById('retrain').onclick = retrain
document.getElementById('motor').onclick = () => { if (sim.armed) sim.disarm(); else sim.arm() }
selPlant.onchange = () => { state.plantKey = selPlant.value; onPlantChange(); rebuild() }
selCtrl.onchange = () => { state.ctrlKey = selCtrl.value; rebuild() }
const selTarget = document.getElementById('sel-target')
selTarget.onchange = () => { state.targetEq = +selTarget.value; rebuild() }
document.getElementById('toggle-real').onclick = () => {
  state.realistic = !state.realistic
  sim.realistic = state.realistic
  paintToggle(); refreshNotes()
}
const heldKeys = new Set()
window.addEventListener('keydown', e => {
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault()
    if (state.ctrlKey === 'manual') heldKeys.add(e.code)       // hold to drive the cart
    else shove(e.code === 'ArrowLeft' ? -1 : 1)                 // tap to shove
  } else if (e.code === 'Space') { e.preventDefault(); sim.reset(startState()) }
})
window.addEventListener('keyup', e => heldKeys.delete(e.code))
canvas.addEventListener('click', e => {
  const r = canvas.getBoundingClientRect()
  shove(e.clientX - r.left < r.width / 2 ? -1 : 1)
})

function paintToggle() {
  const on = state.realistic
  document.getElementById('switch').style.background = on ? '#06b6d4' : '#334155'
  document.getElementById('knob').style.left = on ? '18px' : '2px'
  updateHint()
}
function updateHint() {
  const h = document.getElementById('hint')
  if (state.ctrlKey === 'manual') {
    h.innerHTML = `<strong style="color:#e2e8f0;">← →</strong> hold to drive the cart · <strong style="color:#e2e8f0;">Space</strong> reset — balance it yourself`
    return
  }
  h.innerHTML = state.realistic
    ? `<strong style="color:#e2e8f0;">Realistic:</strong> noisy encoders · EKF estimate (grey ghost) · actuator lag — watch it jitter`
    : `<strong style="color:#e2e8f0;">← →</strong> or click to shove · <strong style="color:#e2e8f0;">Space</strong> drop from hanging`
}

const MODE_STYLE = {
  balance: { bg: '#22c55e18', color: '#22c55e', label: '● Balancing' },
  reach: { bg: '#f59e0b18', color: '#f59e0b', label: '◐ Reaching' },
  'swing-up': { bg: '#f59e0b18', color: '#f59e0b', label: '◐ Swinging up' },
  'kick-start': { bg: '#f59e0b18', color: '#f59e0b', label: '◐ Kick-starting' },
  manual: { bg: '#33415518', color: '#94a3b8', label: '○ Manual — you drive' },
  init: { bg: '#33415518', color: '#94a3b8', label: '○ Idle' },
}
function fmtDeg(rad) { return (rad * 180 / Math.PI).toFixed(1) + '°' }

function updatePanel() {
  const s = sim.state
  const ms = sim.armed ? (MODE_STYLE[sim.mode] || MODE_STYLE.init)
    : { bg: '#ef444418', color: '#ef4444', label: '⏻ Motor off' }
  const badge = document.getElementById('mode-badge')
  badge.textContent = ms.label; badge.style.background = ms.bg; badge.style.color = ms.color

  const rows = []
  const angColor = a => (Math.abs(a) < 0.1 ? '#22c55e' : '#e2e8f0')
  if (plant.meta.name === 'double') {
    const a1 = wrapPi(s.theta1), a2 = wrapPi(s.theta2)
    rows.push(['Lower link', fmtDeg(a1), angColor(a1)], ['Upper link', fmtDeg(a2), angColor(a2)])
  } else {
    const a = wrapPi(s.theta)
    rows.push(['Angle from vertical', fmtDeg(a), angColor(a)], ['Angular rate', s.thetadot.toFixed(2) + ' rad/s', '#94a3b8'])
  }
  rows.push(['Cart position', s.x.toFixed(2) + ' m', Math.abs(s.x) > plant.PARAMS.trackHalfWidth * 0.9 ? '#ef4444' : '#94a3b8'])
  rows.push(['Motor force', sim.force.toFixed(1) + ' N', Math.abs(sim.force) > plant.PARAMS.forceMax * 0.9 ? '#f59e0b' : '#94a3b8'])
  if (state.realistic) {
    const e = sim.estimate
    const errDeg = plant.meta.name === 'double'
      ? Math.max(Math.abs(wrapPi(e.theta1 - s.theta1)), Math.abs(wrapPi(e.theta2 - s.theta2))) * 180 / Math.PI
      : Math.abs(wrapPi(e.theta - s.theta)) * 180 / Math.PI
    rows.push(['Estimator error', errDeg.toFixed(2) + '°', errDeg > 2 ? '#f59e0b' : '#64748b'])
  }
  document.getElementById('state-panel').innerHTML = rows.map(([k, v, c]) => `
    <div style="display:flex;justify-content:space-between;">
      <span style="color:#64748b;">${k}</span><span style="color:${c};font-weight:600;">${v}</span>
    </div>`).join('')

  // Motor / safety cutoff UI
  const motorBtn = document.getElementById('motor')
  motorBtn.textContent = sim.armed ? '⏻ Motor: On' : '⏻ Motor: Off — click to re-arm'
  motorBtn.style.color = sim.armed ? '' : '#ef4444'
  const banner = document.getElementById('trip-banner')
  if (sim.tripped) {
    banner.style.display = ''
    banner.textContent = `⚠ Safety cutoff — motor disabled: ${sim.tripReason}. Reset or re-arm to resume.`
  } else banner.style.display = 'none'
}

function refreshNotes() {
  const common = [
    ['Underactuated', 'the motor only pushes the cart; the pole is never driven directly. Uprighting it means pumping energy through the cart.'],
    [CONTROLLERS[state.ctrlKey].label, {
      lqr: 'gains are solved live from the plant — the model is linearized about the target and the discrete Riccati equation is solved for optimal state feedback.',
      pid: 'inner PID holds the angle; an outer cascade loop leans the pole to recenter the cart. One SISO loop stabilizes one unactuated angle.',
      neural: state.plantKey === 'double'
        ? 'a network (8→16→12→1, tanh) maps both links’ sin/cos, rates, and the cart state to motor force. Evolved by neuroevolution to BALANCE both-up and reject nudges (it does not swing the double up — that stays out of scope).'
        : 'a small network (5→12→8→1, tanh) maps [sinθ, cosθ, θ̇, x, ẋ] straight to motor force. No control law was written — it was evolved by neuroevolution (tournament selection + mutation, reusing the creatures engine), learning both swing-up and balance from a fitness score.',
      manual: 'no controller — you are the loop. Hold the arrow keys to push the cart and try to balance the pole yourself. Good for feeling how unstable it really is.',
    }[state.ctrlKey]],
  ]
  if (state.plantKey === 'double') {
    common.push(['Four equilibria', 'each link is up (0) or down (π), giving four balance states. A per-equilibrium LQR holds any of them from nearby — even both-up, the hardest. Global swing-up between inverted states with one cart force is a research problem, so the demo starts near the chosen target rather than swinging up to it.'])
  }
  const realism = state.realistic
    ? ['Realistic loop', 'positions read through noisy, quantized encoders (no velocity sensor); an Extended Kalman Filter reconstructs the full state (grey ghost); the command passes through a saturating, slew- and lag-limited actuator. The controller acts on the estimate — so it jitters and works harder, like real hardware.']
    : ['Ideal loop', 'perfect state, perfect actuator. Flip the switch to add sensor noise, encoder quantization, actuator lag, and an EKF estimator.']
  const all = [...common, realism]
  document.getElementById('notes').innerHTML = all.map(([h, b]) =>
    `<p style="margin-bottom:0.5rem;"><strong style="color:#94a3b8;">${h}</strong> — ${b}</p>`).join('')
}

// --- init + loop ---
selPlant.value = state.plantKey
onPlantChange()
rebuild()
paintToggle()

let lastT = performance.now()
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000)
  lastT = now
  if (state.ctrlKey === 'manual' && currentController.setDrive) {
    currentController.setDrive((heldKeys.has('ArrowRight') ? 1 : 0) - (heldKeys.has('ArrowLeft') ? 1 : 0))
  }
  sim.advance(dt)
  render(canvas, plant, sim.state, { estimate: state.realistic ? sim.estimate : null, force: sim.force })
  updatePanel()
  if (state.ctrlKey === 'neural' && currentController.viz) renderNet(netCanvas, currentController.viz)
  requestAnimationFrame(loop)
}
window.__pendulumDebug = {
  get state() { return sim.state }, get estimate() { return sim.estimate },
  get mode() { return sim.mode }, shove, reset: () => sim.reset(),
  setPlant: k => { state.plantKey = k; selPlant.value = k; onPlantChange(); rebuild() },
  setController: k => { state.ctrlKey = k; selCtrl.value = k; rebuild() },
  setTarget: i => { state.targetEq = i; selTarget.value = i; rebuild() },
  setRealistic: v => { state.realistic = v; sim.realistic = v; paintToggle(); refreshNotes() },
  get armed() { return sim.armed }, get tripped() { return sim.tripped }, get tripReason() { return sim.tripReason },
  disarm: () => sim.disarm(), arm: () => sim.arm(),
  get force() { return sim.force },
}
requestAnimationFrame(loop)
