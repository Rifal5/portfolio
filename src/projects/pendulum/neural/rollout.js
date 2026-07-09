// Fitness rollout for evolving a single-pole neural controller. Scores a weight
// vector by simulating the pendulum under the policy from several start states
// (hanging AND various tilts, so the champion learns to both swing up and
// balance) and rewarding time spent upright, minus penalties for heavy force use
// and cart drift. Averaged over the starts to reduce luck.
//
// Kept dependency-light and synchronous so the SAME module runs in the offline
// training script, the headless test, and the Web Worker.

import { makeMLP } from '../../../lib/evolve/mlp.js'
import * as single from '../plants/single.js'
import { ARCH, inputsFor } from './policy.js'

const DT = 1 / 120
const T = 7 // s per rollout
const STARTS = [Math.PI, 2.2, 1.2, 0.4, -0.4, -1.2] // initial theta values (rest)

export function makeRollout(plant = single) {
  const mlp = makeMLP(ARCH)
  const fMax = plant.PARAMS.forceMax, half = plant.PARAMS.trackHalfWidth

  function evaluate(weights) {
    let total = 0
    for (const theta0 of STARTS) {
      let s = { x: 0, xdot: 0, theta: theta0, thetadot: 0 }
      let fit = 0
      for (let i = 0; i < Math.round(T / DT); i++) {
        let f = mlp.forward(weights, inputsFor(plant, s))[0] * fMax
        f = Math.max(-fMax, Math.min(fMax, f))
        s = plant.step(s, f, DT)
        const upright = 0.5 * (1 + Math.cos(s.theta))            // 1 up, 0 down
        fit += (upright - 0.02 * Math.abs(f) / fMax - 0.05 * Math.abs(s.x) / half) * DT
      }
      total += fit
    }
    return total / STARTS.length
  }

  return { mlp, evaluate, paramCount: mlp.paramCount, randomParams: mlp.randomParams, mutate: mlp.mutate }
}
