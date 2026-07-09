// Phase 4 checkpoint for the double pendulum:
//   1. EOM sanity — with no damping and no force, RK4 conserves total energy
//      (validates the derivation before we trust any controller on it).
//   2. Per-equilibrium LQR — starting near each of the 4 equilibria, the LQR
//      holds it and rejects a small nudge. down-down is open-loop stable.

import * as double from '../src/projects/pendulum/plants/double.js'
import { makeController } from '../src/projects/pendulum/controllers/lqr.js'

const dt = 1 / 240
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

let ok = true

// --- 1. Energy conservation (undamped, zero force) ---
const cons = { ...double.PARAMS, cartDamping: 0, jointDamping: 0 }
let s = { x: 0, theta1: 0.5, theta2: -0.3, xdot: 0, theta1dot: 0, theta2dot: 0 }
const E0 = double.energy(s, cons)
let maxDrift = 0
for (let i = 0; i < Math.round(10 / dt); i++) {
  s = double.step(s, 0, dt, cons)
  maxDrift = Math.max(maxDrift, Math.abs(double.energy(s, cons) - E0))
}
console.log(`1. Energy drift over 10s (undamped, F=0): ${maxDrift.toExponential(2)} J  (E0=${E0.toFixed(4)})`)
if (maxDrift > 1e-3) { ok = false; console.log('   FAIL: energy not conserved -> EOM error') }

// --- 2. Per-equilibrium LQR hold + nudge reject ---
// Weights: penalize both angles heavily, cart mildly. [x,th1,th2,xd,th1d,th2d]
const Q = [200, 800, 800, 1, 20, 20] // up-up needs strong angle weighting
for (let eq = 0; eq < double.meta.equilibria.length; eq++) {
  const name = double.meta.equilibria[eq].label
  const ctrl = makeController(double, {
    targetEq: eq, Q, R: 0.02,
    enter: () => true, exit: () => false, // stabilize-only: always regulate
  })
  // start slightly perturbed from the equilibrium
  const base = double.fromVec(double.meta.equilibria[eq].x)
  let st = { ...base, theta1: base.theta1 + 0.12, theta2: base.theta2 - 0.12, x: 0.1 }
  for (let i = 0; i < Math.round(8 / dt); i++) st = double.step(st, ctrl.compute(st).force, dt)
  // nudge
  st = { ...st, theta2dot: st.theta2dot + 0.8 }
  for (let i = 0; i < Math.round(6 / dt); i++) st = double.step(st, ctrl.compute(st).force, dt)
  const eqVec = double.meta.equilibria[eq].x
  const e1 = Math.abs(wrap(st.theta1 - eqVec[1])), e2 = Math.abs(wrap(st.theta2 - eqVec[2]))
  const held = e1 < 0.05 && e2 < 0.05 && Math.abs(st.x) < double.PARAMS.trackHalfWidth
  console.log(`2. ${name.padEnd(22)} err θ1=${(e1 * 180 / Math.PI).toFixed(2)}° θ2=${(e2 * 180 / Math.PI).toFixed(2)}° x=${st.x.toFixed(2)} -> ${held ? 'HELD' : 'FAIL'}`)
  if (!held) ok = false
}

console.log(ok ? '\nPASS: double EOM conserves energy; LQR holds all four equilibria' : '\nFAIL: see above')
process.exit(ok ? 0 : 1)
