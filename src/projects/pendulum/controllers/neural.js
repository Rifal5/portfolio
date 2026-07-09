// Neural controller — an evolved network drives the cart directly. Plant-aware:
// loads the single or double champion and its input encoding. Ships pre-trained
// (works instantly) and can hot-swap weights from the training worker. Exposes
// live activations + weights via `viz` for the network visualization panel.

import { makeMLP } from '../../../lib/evolve/mlp.js'
import { neuralConfig } from '../neural/policy.js'
import { CHAMPION as SINGLE } from '../neural/champion-single.js'
import { CHAMPION as DOUBLE } from '../neural/champion-double.js'

const CHAMPIONS = { single: SINGLE, double: DOUBLE }
function wrapPi(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

export function makeController(plant, opts = {}) {
  const cfg = neuralConfig(plant)
  const mlp = makeMLP(cfg.arch)
  let weights = new Float32Array(opts.weights || CHAMPIONS[plant.meta.name].weights)
  const activations = cfg.arch.map(n => new Float32Array(n)) // per-layer, for the viz

  function upright(s) {
    return plant.meta.name === 'double'
      ? Math.abs(wrapPi(s.theta1)) < 0.3 && Math.abs(wrapPi(s.theta2)) < 0.3
      : Math.abs(wrapPi(s.theta)) < 0.3
  }

  function compute(s) {
    const out = mlp.forward(weights, cfg.inputs(plant, s), activations)
    let f = out[0] * plant.PARAMS.forceMax
    f = Math.max(-plant.PARAMS.forceMax, Math.min(plant.PARAMS.forceMax, f))
    return { force: f, mode: upright(s) ? 'balance' : 'swing-up' }
  }

  return {
    compute,
    reset() {},
    setWeights(w) { weights = new Float32Array(w) },
    get weights() { return weights },
    // For the live network view: architecture, input labels, current activations,
    // and a weight accessor for drawing edges.
    get viz() {
      return { arch: cfg.arch, labels: cfg.labels, activations, weightAt: (l, j, i) => mlp.weightAt(weights, l, j, i) }
    },
  }
}
