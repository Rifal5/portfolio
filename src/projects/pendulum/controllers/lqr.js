// LQR balance controller (optionally with a swing-up front-end). Near the target
// equilibrium it applies optimal full-state feedback u = -K·e, where K is solved
// from the actual plant by the shared linearizer (numeric Jacobian + discrete
// Riccati) — so the same code produces correct gains for the single pole and for
// each of the double pendulum's equilibria. The swing-up handoff + hysteresis
// live in switched.js.

import { lqrForEquilibrium } from '../../../lib/control/linearize.js'
import { makeSwitched } from './switched.js'

// Default LQR weights per state dim (angle & its rate penalized most). Sized to
// the plant; extra dims fall back to a mild weight.
function defaultQ(plant, weights = []) {
  return plant.meta.dims.map((_, i) =>
    plant.meta.dims.map((_, j) => (i === j ? (weights[i] ?? 1) : 0)))
}

// Default LQR state weights per plant (used when opts.Q is omitted).
const DEFAULT_WEIGHTS = {
  single: [2, 1, 40, 4],
  double: [12, 500, 500, 1, 15, 15], // penalize both angles hard; cart mildly
}

export function makeController(plant, opts = {}) {
  const { targetEq = 0, R = 0.02, dt = 1 / 240, swingUp = null, enter, exit } = opts
  // opts.Q may be a weight vector (1-D), a full Q matrix (2-D), or omitted.
  let Q
  if (Array.isArray(opts.Q) && typeof opts.Q[0] === 'number') Q = defaultQ(plant, opts.Q)
  else if (opts.Q) Q = opts.Q
  else Q = defaultQ(plant, DEFAULT_WEIGHTS[plant.meta.name])

  const { K } = lqrForEquilibrium(plant, targetEq, Q, R, dt)
  const balance = { law: (e) => -K.reduce((s, k, i) => s + k * e[i], 0), reset() {} }
  const ctrl = makeSwitched(plant, { targetEq, balance, swingUp, enter, exit, controlDt: dt })
  return {
    compute: ctrl.compute,
    reset: ctrl.reset,
    get balancing() { return ctrl.balancing },
    get gain() { return K },
  }
}
