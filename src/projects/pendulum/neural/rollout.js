// Fitness rollout for evolving a neural controller, plant-aware. Runs unchanged
// in the offline trainer, the headless test, and the (continuous) Web Worker.
//
//   single — reward time upright from hanging AND tilts (swing-up + balance).
//   double — GOAL-CONDITIONED: for each of the four targets (fed to the net as
//            ±1 inputs), start near that target and reward holding it. So one
//            network learns to balance any of the four states.

import { makeMLP } from '../../../lib/evolve/mlp.js'
import { neuralConfig, targetVec } from './policy.js'

const DT = 1 / 120
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

export function makeRollout(plant) {
  const cfg = neuralConfig(plant)
  const mlp = makeMLP(cfg.arch)
  const fMax = plant.PARAMS.forceMax, half = plant.PARAMS.trackHalfWidth

  function single(weights) {
    const starts = [Math.PI, 2.2, 1.2, 0.4, -0.4, -1.2].map(theta => ({ x: 0, xdot: 0, theta, thetadot: 0 }))
    let total = 0
    for (const st of starts) {
      let s = { ...st }, fit = 0
      for (let i = 0; i < Math.round(7 / DT); i++) {
        let f = mlp.forward(weights, cfg.inputs(plant, s, []))[0] * fMax
        f = Math.max(-fMax, Math.min(fMax, f)); s = plant.step(s, f, DT)
        fit += (0.5 * (1 + Math.cos(s.theta)) - 0.02 * Math.abs(f) / fMax - 0.05 * Math.abs(s.x) / half) * DT
      }
      total += fit
    }
    return total / starts.length
  }

  function doubleGC(weights) {
    let total = 0, n = 0
    for (let eq = 0; eq < 4; eq++) {
      const e = plant.meta.equilibria[eq].x, t = targetVec(plant, eq)
      for (const d of [0.12, -0.14]) { // near-target starts
        let s = { x: 0, xdot: 0, theta1: e[1] + d, theta2: e[2] - d, theta1dot: 0, theta2dot: 0 }, fit = 0
        for (let i = 0; i < Math.round(4 / DT); i++) {
          let f = mlp.forward(weights, cfg.inputs(plant, s, t))[0] * fMax
          f = Math.max(-fMax, Math.min(fMax, f)); s = plant.step(s, f, DT)
          // Sum reward: credit each link toward its target (smooth gradient for the
          // folded configs), with a bonus when BOTH match so it converges to the goal.
          const g1 = 0.5 * (1 + Math.cos(s.theta1 - e[1])), g2 = 0.5 * (1 + Math.cos(s.theta2 - e[2]))
          fit += (0.35 * (g1 + g2) + 0.3 * g1 * g2 - 0.02 * Math.abs(f) / fMax - 0.04 * Math.abs(s.x) / half) * DT
        }
        total += fit; n++
      }
    }
    return total / n
  }

  return {
    mlp, paramCount: mlp.paramCount, randomParams: mlp.randomParams, mutate: mlp.mutate,
    evaluate: plant.meta.name === 'double' ? doubleGC : single,
  }
}
