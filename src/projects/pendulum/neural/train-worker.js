// Web Worker for continuous neural training, off the main thread. Two paths:
//   double → supervised backprop that imitates the per-target LQR (SGD), run
//            INDEFINITELY; posts the refined network a few times a second so the
//            main thread hot-swaps it into the live controller.
//   single → neuroevolution (the from-scratch swing-up policy), run indefinitely,
//            posting a champion whenever the best improves.
// Runs until the worker is terminated. Seeded from the current champion so it
// keeps improving rather than restarting.
import { evolve } from '../../../lib/evolve/ga.js'
import { makeRollout } from './rollout.js'
import { makeImitator } from './imitation.js'
import { PLANTS } from '../plants/index.js'

self.onmessage = (e) => {
  const cfg = e.data || {}
  const plant = PLANTS[cfg.plantKey] || PLANTS.single

  if (plant.meta.name === 'double') {
    const imit = makeImitator(plant)
    const w = cfg.seed ? new Float32Array(cfg.seed) : imit.randomParams()
    let steps = 0, lastPost = 0
    const batch = () => {
      const loss = imit.trainSteps(w, 4000, 0.008)
      steps += 4000
      const now = Date.now()
      if (now - lastPost > 250) { // throttle live hot-swaps to a few per second
        lastPost = now
        self.postMessage({ type: 'champion', weights: Array.from(w), text: `imitation loss ${loss.toExponential(1)} · ${(steps / 1000) | 0}k steps` })
      }
      setTimeout(batch, 0)
    }
    batch()
    return
  }

  const roll = makeRollout(plant)
  evolve({
    paramCount: roll.paramCount, randomParams: roll.randomParams, mutate: roll.mutate, evaluate: roll.evaluate,
    pop: cfg.pop || 60, gens: 1e9, elite: 6, tournamentK: 4, mut: { rate: 0.15, strength: 0.35 },
    seed: cfg.seed ? new Float32Array(cfg.seed) : null,
    onProgress: (p) => { if (p.gen % 4 === 0) self.postMessage({ type: 'progress', text: `gen ${p.gen} · best ${p.best.toFixed(2)}` }) },
    onChampion: (b) => self.postMessage({ type: 'champion', weights: Array.from(b.weights), text: `fitness ${b.fitness.toFixed(2)} (gen ${b.gen})` }),
  })
}
