// Neural controller — an evolved network drives the cart directly. The single is
// a fixed up-right policy; the double is GOAL-CONDITIONED: the desired
// equilibrium is fed to the network as two extra inputs, so one network targets
// any of the four states (settable live via setTarget). Ships pre-trained and
// can hot-swap weights from the training worker. Exposes live activations +
// weights via `viz` for the network panel.

import { makeMLP } from '../../../lib/evolve/mlp.js'
import { neuralConfig, targetVec } from '../neural/policy.js'
import { CHAMPION as SINGLE } from '../neural/champion-single.js'
import { CHAMPION as DOUBLE } from '../neural/champion-double.js'

const CHAMPIONS = { single: SINGLE, double: DOUBLE }
function wrapPi(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

export function makeController(plant, opts = {}) {
  const cfg = neuralConfig(plant)
  const mlp = makeMLP(cfg.arch)
  let weights = new Float32Array(opts.weights || CHAMPIONS[plant.meta.name].weights)
  const activations = cfg.arch.map(n => new Float32Array(n))
  let target = cfg.goalConditioned ? targetVec(plant, opts.targetEq ?? 0) : []

  // "At target" test — for the double, near the target's angles (from the ±1 goal).
  function atTarget(s) {
    if (plant.meta.name === 'double') {
      const g1 = target[0] > 0 ? 0 : Math.PI, g2 = target[1] > 0 ? 0 : Math.PI
      return Math.abs(wrapPi(s.theta1 - g1)) < 0.3 && Math.abs(wrapPi(s.theta2 - g2)) < 0.3
    }
    return Math.abs(wrapPi(s.theta)) < 0.3
  }

  function compute(s) {
    const out = mlp.forward(weights, cfg.inputs(plant, s, target), activations)
    let f = out[0] * plant.PARAMS.forceMax
    f = Math.max(-plant.PARAMS.forceMax, Math.min(plant.PARAMS.forceMax, f))
    return { force: f, mode: atTarget(s) ? 'balance' : 'swing-up' }
  }

  return {
    compute,
    reset() {},
    setWeights(w) { weights = new Float32Array(w) },
    setTarget(eqIndex) { if (cfg.goalConditioned) target = targetVec(plant, eqIndex) },
    get weights() { return weights },
    get viz() {
      return { arch: cfg.arch, labels: cfg.labels, activations, weightAt: (l, j, i) => mlp.weightAt(weights, l, j, i) }
    },
    get info() { return { type: 'neural', arch: cfg.arch, goalConditioned: cfg.goalConditioned } },
  }
}
