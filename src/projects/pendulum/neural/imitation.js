// Supervised trainer for the goal-conditioned DOUBLE balancer: it clones the
// per-target LQR by backprop. For each target it samples states near that
// equilibrium, computes the (clamped) optimal LQR force, and does a gradient
// step so the network's output matches it. Fast and reliable — the LQR already
// solves each target, so imitating it is a well-posed regression. Used by both
// the offline seed script and the continuous in-browser worker (indefinite SGD).

import { makeMLP } from '../../../lib/evolve/mlp.js'
import { lqrForEquilibrium } from '../../../lib/control/linearize.js'
import { neuralConfig, targetVec } from './policy.js'

const DQ = [12, 500, 500, 1, 15, 15] // matches the double LQR weights in lqr.js
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

export function makeImitator(plant) {
  const cfg = neuralConfig(plant)
  const mlp = makeMLP(cfg.arch)
  const fMax = plant.PARAMS.forceMax
  const eqs = plant.meta.equilibria
  const Q = DQ.map((w, i, A) => A.map((_, j) => (i === j ? w : 0)))
  const Ks = eqs.map((_, eq) => lqrForEquilibrium(plant, eq, Q, 0.02, 1 / 240).K)

  function sample(eq) {
    const e = eqs[eq].x
    return {
      x: (Math.random() * 2 - 1) * 0.6, xdot: (Math.random() * 2 - 1) * 1.0,
      theta1: e[1] + (Math.random() * 2 - 1) * 0.38, theta2: e[2] + (Math.random() * 2 - 1) * 0.38,
      theta1dot: (Math.random() * 2 - 1) * 1.6, theta2dot: (Math.random() * 2 - 1) * 1.6,
    }
  }

  // n gradient steps (cycling through the four targets), returns the last loss.
  function trainSteps(weights, n, lr) {
    let loss = 0
    for (let k = 0; k < n; k++) {
      const eq = k % eqs.length, e = eqs[eq].x, t = targetVec(plant, eq), K = Ks[eq]
      const s = sample(eq)
      const err = [s.x - e[0], wrap(s.theta1 - e[1]), wrap(s.theta2 - e[2]), s.xdot, s.theta1dot, s.theta2dot]
      let lq = -K.reduce((a, kk, j) => a + kk * err[j], 0)
      lq = Math.max(-fMax, Math.min(fMax, lq))
      loss = mlp.sgdStep(weights, cfg.inputs(plant, s, t), [lq / fMax], lr)
    }
    return loss
  }

  return { mlp, paramCount: mlp.paramCount, randomParams: mlp.randomParams, trainSteps }
}
