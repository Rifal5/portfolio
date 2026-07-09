// Neural controller — an evolved network drives the cart directly (no explicit
// swing-up/balance split; the policy learned both). Ships with a pre-trained
// champion so it works instantly; the UI can hot-swap in freshly evolved weights
// from the training worker. Reuses the generic MLP and the shared policy
// encoding, so this is the exact network the rollout/worker evolve.

import { makeMLP } from '../../../lib/evolve/mlp.js'
import { ARCH, policyForce } from '../neural/policy.js'
import { CHAMPION } from '../neural/champion-single.js'

function wrapPi(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

export function makeController(plant, opts = {}) {
  const mlp = makeMLP(ARCH)
  let weights = new Float32Array(opts.weights || CHAMPION.weights)

  function compute(s) {
    let f = policyForce(mlp, weights, plant, s)
    f = Math.max(-plant.PARAMS.forceMax, Math.min(plant.PARAMS.forceMax, f))
    const mode = Math.abs(wrapPi(s.theta)) < 0.3 ? 'balance' : 'swing-up'
    return { force: f, mode }
  }

  return {
    compute,
    reset() {},
    setWeights(w) { weights = new Float32Array(w) },
    get weights() { return weights },
  }
}
