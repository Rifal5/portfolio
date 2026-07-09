// Web Worker that evolves a single-pole neural controller off the main thread,
// so the page stays responsive while the user watches fitness climb. Reuses the
// generic GA engine + the shared rollout (the same code the offline trainer
// uses). Message in: { gens?, pop?, seed? }. Messages out:
//   { type:'progress', gen, gens, best, avg }
//   { type:'done', weights:[…], fitness }
import { evolve } from '../../../lib/evolve/ga.js'
import { makeRollout } from './rollout.js'

self.onmessage = (e) => {
  const cfg = e.data || {}
  const roll = makeRollout()
  const { best } = evolve({
    paramCount: roll.paramCount, randomParams: roll.randomParams, mutate: roll.mutate, evaluate: roll.evaluate,
    pop: cfg.pop || 60, gens: cfg.gens || 80, elite: 6, tournamentK: 4,
    mut: { rate: 0.15, strength: 0.35 },
    seed: cfg.seed ? new Float32Array(cfg.seed) : null,
    onProgress: (p) => self.postMessage({ type: 'progress', ...p }),
  })
  self.postMessage({ type: 'done', weights: Array.from(best.weights), fitness: best.fitness })
}
