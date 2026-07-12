// Checkpoint for the double pendulum's maneuver supervisor: every target must
// be reached and HELD from hanging, and re-targeting must chain through hanging
// (descend -> settle -> tracked swing-up -> catch). Runs the real plant at the
// sim substep with the controller called at the control rate, like the app.

import * as dbl from '../src/projects/pendulum/plants/double.js'
import { makeController } from '../src/projects/pendulum/controllers/maneuver.js'
import { makeSim, REALISM } from '../src/projects/pendulum/sim.js'

const SUB = 1 / 240
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }
const heldAt = (s, eq) => {
  const e = dbl.meta.equilibria[eq].x
  return Math.abs(wrap(s.theta1 - e[1])) < 0.1 && Math.abs(wrap(s.theta2 - e[2])) < 0.1 && Math.abs(s.x) < dbl.PARAMS.trackHalfWidth
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

// 2) chained re-target: hold up-up, then switch to up-down (must route via hanging)
{
  let ctrl = makeController(dbl, { targetEq: 0, controlDt: SUB })
  let { s } = run(ctrl, dbl.initialState(), 12)
  if (!heldAt(s, 0)) { ok = false; console.log('setup failed: not at up-up') }
  ctrl = makeController(dbl, { targetEq: 1, controlDt: SUB }) // retarget, keep state
  const res = run(ctrl, s, 25)
  const held = heldAt(res.s, 1)
  console.log(`re-target up-up -> up-down: held=${held}  modes=[${res.modes}]`)
  if (!held) ok = false
}

// 3) chained re-target the other way: up-down -> down-up
{
  let ctrl = makeController(dbl, { targetEq: 1, controlDt: SUB })
  let { s } = run(ctrl, dbl.initialState(), 12)
  ctrl = makeController(dbl, { targetEq: 2, controlDt: SUB })
  const res = run(ctrl, s, 25)
  const held = heldAt(res.s, 2)
  console.log(`re-target up-down -> down-up: held=${held}  modes=[${res.modes}]`)
  if (!held) ok = false
}

// 4) inverted -> hanging (descend + catch)
{
  let ctrl = makeController(dbl, { targetEq: 0, controlDt: SUB })
  let { s } = run(ctrl, dbl.initialState(), 12)
  ctrl = makeController(dbl, { targetEq: 3, controlDt: SUB })
  const res = run(ctrl, s, 15)
  const held = heldAt(res.s, 3)
  console.log(`re-target up-up -> hanging: held=${held}  modes=[${res.modes}]`)
  if (!held) ok = false
}

// 5) REALISTIC loop (sensor noise + EKF + actuator slew/lag/deadband) with the
//    runtime lead compensation: every inverted target from hanging.
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

console.log(ok ? '\nPASS: all targets reachable from anywhere via maneuver chaining (ideal + realistic)' : '\nFAIL')
process.exit(ok ? 0 : 1)
