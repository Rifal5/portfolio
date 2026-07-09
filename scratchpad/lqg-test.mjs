// Phase 2 checkpoint: the sim loop must self-right in BOTH modes, and realistic
// mode must (a) still settle, (b) show a bounded but NON-zero limit-cycle (the
// visible "it works harder" realism), and (c) keep the EKF estimate error
// bounded near balance. Ideal mode should be essentially perfect.

import * as single from '../src/projects/pendulum/plants/single.js'
import { makeController } from '../src/projects/pendulum/controllers/lqr.js'
import { makeSingleSwingUp } from '../src/projects/pendulum/controllers/energy.js'
import { makeSim, SUBSTEP } from '../src/projects/pendulum/sim.js'

function wrapPi(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

function runMode(realistic, T = 30) {
  const controller = makeController(single, { swingUp: makeSingleSwingUp(single) })
  const sim = makeSim({ plant: single, controller, realistic })
  sim.reset()
  let settledAt = null, maxEstErr = 0
  const steps = Math.round(T / SUBSTEP)
  const tailStart = steps - Math.round(4 / SUBSTEP)
  let maxTh = 0, maxRate = 0, maxForce = 0
  for (let i = 0; i < steps; i++) {
    sim.advance(SUBSTEP)
    const s = sim.state
    if (settledAt == null && Math.abs(wrapPi(s.theta)) < 0.08 && Math.abs(s.thetadot) < 0.6) settledAt = i * SUBSTEP
    if (settledAt != null) maxEstErr = Math.max(maxEstErr, Math.abs(wrapPi(sim.estimate.theta - s.theta)))
    if (i > tailStart) {
      maxTh = Math.max(maxTh, Math.abs(wrapPi(s.theta)))
      maxRate = Math.max(maxRate, Math.abs(s.thetadot))
      maxForce = Math.max(maxForce, Math.abs(sim.force))
    }
  }
  return { settledAt, maxTh, maxRate, maxForce, maxEstErr }
}

const ideal = runMode(false)
const real = runMode(true)

console.log('IDEAL    ', `settled=${ideal.settledAt?.toFixed(2)}s  limitCycle=${(ideal.maxTh * 180 / Math.PI).toFixed(3)}deg  force<=${ideal.maxForce.toFixed(2)}N`)
console.log('REALISTIC', `settled=${real.settledAt?.toFixed(2)}s  limitCycle=${(real.maxTh * 180 / Math.PI).toFixed(2)}deg  rate<=${real.maxRate.toFixed(2)}  force<=${real.maxForce.toFixed(2)}N  EKFerr<=${(real.maxEstErr * 180 / Math.PI).toFixed(2)}deg`)

let ok = true
if (ideal.settledAt == null) { ok = false; console.log('  FAIL: ideal never settled') }
if (ideal.maxTh > 0.01) { ok = false; console.log('  FAIL: ideal not clean (should be ~0)') }
if (real.settledAt == null) { ok = false; console.log('  FAIL: realistic never settled') }
if (real.maxTh < 0.001) { ok = false; console.log('  FAIL: realistic shows no jitter (realism not visible)') }
if (real.maxTh > 0.06) { ok = false; console.log('  FAIL: realistic limit-cycle too large (>3.4deg)') }
if (real.maxEstErr > 0.05) { ok = false; console.log('  FAIL: EKF error unbounded (>2.9deg)') }
console.log(ok ? '\nPASS: ideal is clean; realistic self-rights with visible, bounded realism' : '\nFAIL: see above')
process.exit(ok ? 0 : 1)
