// Web Worker that evolves a neural controller (single or double) off the main
// thread. Reuses the generic GA engine + the shared plant-aware rollout.
// Message in: { plantKey, gens?, pop?, seed? }. Messages out:
//   { type:'progress', gen, gens, best, avg }
//   { type:'done', weights:[…], fitness }
import { evolve } from '../../../lib/evolve/ga.js'
import { makeRollout } from './rollout.js'
import { PLANTS } from '../plants/index.js'

self.onmessage = (e) => {
  const cfg = e.data || {}
  const plant = PLANTS[cfg.plantKey] || PLANTS.single
  const isDouble = plant.meta.name === 'double'
  const roll = makeRollout(plant)
  const { best } = evolve({
    paramCount: roll.paramCount, randomParams: roll.randomParams, mutate: roll.mutate, evaluate: roll.evaluate,
    pop: cfg.pop || (isDouble ? 72 : 60), gens: cfg.gens || (isDouble ? 90 : 80),
    elite: 6, tournamentK: 4, mut: { rate: 0.15, strength: 0.35 },
    seed: cfg.seed ? new Float32Array(cfg.seed) : null,
    onProgress: (p) => self.postMessage({ type: 'progress', ...p }),
  })
  self.postMessage({ type: 'done', weights: Array.from(best.weights), fitness: best.fitness })
}
