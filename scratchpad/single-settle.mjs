// Phase 1 checkpoint: the refactored single plant + LQR/energy controllers must
// still (a) swing up from hanging and settle upright, and (b) recover from a
// moderate shove — reproducing the pre-refactor behaviour (now with correct-DARE
// gains). Uses the NEW module interface directly.

import * as single from '../src/projects/pendulum/plants/single.js'
import { makeController } from '../src/projects/pendulum/controllers/lqr.js'
import { makeSingleSwingUp } from '../src/projects/pendulum/controllers/energy.js'

const dt = 1 / 240
const ctrl = makeController(single, { swingUp: makeSingleSwingUp(single) })

function run(fromState, T) {
  let s = fromState
  let settledAt = null
  for (let i = 0; i < T / dt; i++) {
    const { force } = ctrl.compute(s)
    s = single.step(s, force, dt)
    const upright = Math.abs(single.wrapPi(s.theta)) < 0.05 && Math.abs(s.thetadot) < 0.3
    if (settledAt == null && upright) settledAt = i * dt
  }
  return { s, settledAt }
}

let ok = true

// (a) swing up from hanging
ctrl.reset()
const a = run(single.initialState(), 30)
const aUp = Math.abs(single.wrapPi(a.s.theta)) < 0.05 && Math.abs(a.s.thetadot) < 0.3 && Math.abs(a.s.x) < single.PARAMS.trackHalfWidth
console.log(`swing-up: settledAt=${a.settledAt == null ? 'never' : a.settledAt.toFixed(2) + 's'} finalTheta=${a.s.theta.toFixed(4)} x=${a.s.x.toFixed(3)}`)
if (!aUp) { ok = false; console.log('  FAIL: did not swing up and settle') }

// (b) disturbance recovery: balanced, then a +1.8 rad/s shove
ctrl.reset()
let s = { x: 0, xdot: 0, theta: 0, thetadot: 0 }
for (let i = 0; i < 0.5 / dt; i++) { s = single.step(s, ctrl.compute(s).force, dt) } // settle bookkeeping into balance
s = { ...s, thetadot: s.thetadot + 1.8 }
const b = run(s, 8)
const bUp = Math.abs(single.wrapPi(b.s.theta)) < 0.05 && Math.abs(b.s.thetadot) < 0.3
console.log(`shove recovery: recovered=${bUp} finalTheta=${b.s.theta.toFixed(4)} x=${b.s.x.toFixed(3)}`)
if (!bUp) { ok = false; console.log('  FAIL: did not recover from shove') }

console.log(ok ? '\nPASS: single plant refactor preserves self-righting behaviour' : '\nFAIL: behaviour regressed')
process.exit(ok ? 0 : 1)
