// Checkpoint for the double pendulum's maneuver supervisor:
//   1. every target reached + HELD from hanging at rest;
//   2. EVERY ordered equilibrium pair transitions — DIRECTLY (no descend phase)
//      when the library has the pair, else via the hanging chain;
//   3. the full REALISTIC loop (sensor noise + EKF + actuator slew/lag/deadband
//      with lead compensation) lands every inverted target from hanging, plus a
//      direct re-target case.
// Runs the real plant at the sim substep with the controller at the control
// rate, like the app.

import * as dbl from '../src/projects/pendulum/plants/double.js'
import { makeController } from '../src/projects/pendulum/controllers/maneuver.js'
import { makeSim, REALISM } from '../src/projects/pendulum/sim.js'
import { MANEUVERS } from '../src/projects/pendulum/maneuvers-double.js'

const SUB = 1 / 240
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }
const heldAt = (s, eq) => {
  const e = dbl.meta.equilibria[eq].x
  return Math.abs(wrap(s.theta1 - e[1])) < 0.1 && Math.abs(wrap(s.theta2 - e[2])) < 0.1 && Math.abs(s.x) < dbl.PARAMS.trackHalfWidth
}
const atRestNear = eq => {
  const e = dbl.meta.equilibria[eq].x
  return { x: 0.01, xdot: 0, theta1: e[1] + 0.02, theta2: e[2] - 0.02, theta1dot: 0, theta2dot: 0 }
}

function run(ctrl, s, T) {
  const modes = new Set()
  for (let i = 0; i < Math.round(T / SUB); i++) {
    const r = ctrl.compute(s)
    modes.add(r.mode)
    s = dbl.step(s, r.force, SUB)
  }
  return { s, modes: [...modes] }
}

let ok = true

// 1) every target reached + held from hanging at rest
for (const eq of [0, 1, 2, 3]) {
  const ctrl = makeController(dbl, { targetEq: eq, controlDt: SUB })
  const { s, modes } = run(ctrl, dbl.initialState(), 15)
  const held = heldAt(s, eq)
  console.log(`from hanging -> ${dbl.meta.equilibria[eq].label.padEnd(22)} held=${held}  modes=[${modes}]`)
  if (!held) ok = false
}

// 2) every ordered pair, launched from a balanced hold at the source
console.log('')
for (let src = 0; src < 4; src++) for (let dst = 0; dst < 4; dst++) {
  if (src === dst) continue
  const hasDirect = !!MANEUVERS[`${src}>${dst}`]
  const ctrl = makeController(dbl, { targetEq: dst, controlDt: SUB })
  const { s, modes } = run(ctrl, atRestNear(src), hasDirect ? 12 : 25)
  const held = heldAt(s, dst)
  const direct = !modes.includes('descend') && !modes.includes('settle')
  const wantDirect = hasDirect
  const pass = held && (!wantDirect || direct)
  console.log(`${src}>${dst} ${dbl.meta.equilibria[src].label} -> ${dbl.meta.equilibria[dst].label}: held=${held} direct=${direct}${wantDirect ? ' (expected direct)' : ' (via hanging ok)'}  modes=[${modes}]`)
  if (!pass) ok = false
}

// 3) REALISTIC loop: inverted targets from hanging + one direct re-target
console.log('')
for (const eq of [0, 1, 2]) {
  const ctrl = makeController(dbl, { targetEq: eq, controlDt: SUB, actuatorTau: REALISM.actuator.tau })
  const sim = makeSim({ plant: dbl, controller: ctrl, realistic: true })
  sim.reset()
  let landed = null
  for (let i = 0; i < Math.round(45 / SUB); i++) {
    sim.advance(SUB)
    if (landed == null && sim.mode === 'balance' && heldAt(sim.state, eq)) landed = i * SUB
  }
  const held = heldAt(sim.state, eq) && sim.mode === 'balance'
  console.log(`REALISTIC from hanging -> ${dbl.meta.equilibria[eq].label.padEnd(22)} held=${held} landed=${landed == null ? 'never' : landed.toFixed(1) + 's'} tripped=${sim.tripped}`)
  if (!held) ok = false
}
if (MANEUVERS['0>2']) {
  const ctrl = makeController(dbl, { targetEq: 2, controlDt: SUB, actuatorTau: REALISM.actuator.tau })
  const sim = makeSim({ plant: dbl, controller: ctrl, realistic: true })
  sim.reset(atRestNear(0))
  const modes = new Set()
  for (let i = 0; i < Math.round(20 / SUB); i++) { sim.advance(SUB); modes.add(sim.mode) }
  const held = heldAt(sim.state, 2) && sim.mode === 'balance'
  const direct = !modes.has('descend') && !modes.has('settle')
  console.log(`REALISTIC direct up-up -> down-up: held=${held} direct=${direct} modes=[${[...modes]}]`)
  if (!held || !direct) ok = false
}

console.log(ok ? '\nPASS: full transition graph works (direct where available, chained otherwise; ideal + realistic)' : '\nFAIL')
process.exit(ok ? 0 : 1)
