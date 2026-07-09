// Fitness rollout for evolving a neural controller, plant-aware:
//   single — reward time upright from hanging AND tilts (learns swing-up + balance).
//   double — reward both links near up-up from small perturbations (balance only;
//            global swing-up of the double is out of scope).
// Penalizes heavy force and cart drift; averaged over starts. Runs unchanged in
// the offline trainer, the headless test, and the Web Worker.

import { makeMLP } from '../../../lib/evolve/mlp.js'
import { neuralConfig } from './policy.js'

const DT = 1 / 120
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

const SPEC = {
  single: {
    T: 7,
    starts: [Math.PI, 2.2, 1.2, 0.4, -0.4, -1.2].map(theta => ({ x: 0, xdot: 0, theta, thetadot: 0 })),
    reward: s => 0.5 * (1 + Math.cos(s.theta)),
    fell: () => false,
  },
  double: {
    T: 5,
    starts: [0.06, 0.15, -0.12, 0.2].map(d => ({ x: 0, xdot: 0, theta1: d, theta2: -d * 0.7, theta1dot: 0, theta2dot: 0 })),
    reward: s => 0.25 * (1 + Math.cos(s.theta1)) + 0.25 * (1 + Math.cos(s.theta2)),
    fell: s => Math.abs(wrap(s.theta1)) > 1.2 || Math.abs(wrap(s.theta2)) > 1.2,
  },
}

export function makeRollout(plant) {
  const cfg = neuralConfig(plant)
  const mlp = makeMLP(cfg.arch)
  const spec = SPEC[plant.meta.name]
  const fMax = plant.PARAMS.forceMax, half = plant.PARAMS.trackHalfWidth

  function evaluate(weights) {
    let total = 0
    for (const start of spec.starts) {
      let s = { ...start }, fit = 0
      for (let i = 0; i < Math.round(spec.T / DT); i++) {
        let f = mlp.forward(weights, cfg.inputs(plant, s))[0] * fMax
        f = Math.max(-fMax, Math.min(fMax, f))
        s = plant.step(s, f, DT)
        fit += (spec.reward(s) - 0.02 * Math.abs(f) / fMax - 0.04 * Math.abs(s.x) / half) * DT
        if (spec.fell(s)) { fit -= 1; break }
      }
      total += fit
    }
    return total / spec.starts.length
  }

  return { mlp, evaluate, paramCount: mlp.paramCount, randomParams: mlp.randomParams, mutate: mlp.mutate }
}
