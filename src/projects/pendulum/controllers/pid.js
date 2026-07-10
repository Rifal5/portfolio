// Cascade PID balance controller for the single pole — the classical approach
// (and the one the reference paper uses for the single pendulum). Two nested
// loops from one motor:
//   outer (cart position) — a PD loop turns cart offset into a small desired
//     lean: to bring the cart home you command the pole to lean gently toward
//     centre, and the inner loop chases that lean, dragging the cart back.
//   inner (angle) — a PID on (θ − θ_setpoint) with an anti-windup clamp on the
//     integrator produces the motor force.
// Shares the swing-up front-end + hysteresis handoff via switched.js.
//
// NOTE: a single SISO PID like this stabilizes ONE unactuated angle. It is
// deliberately NOT offered for the double pendulum (two unactuated angles, one
// input) — see the gating in the UI.

import { makeSwitched, angleIndex } from './switched.js'

const DEFAULT_GAINS = {
  Kp: 110, Ki: 90, Kd: 20,   // inner angle PID
  leanKp: 0.08, leanKd: 0.12, // outer cart-position PD -> lean setpoint
  leanMax: 0.18,              // rad — cap the commanded lean
  iMax: 0.6,                  // integrator anti-windup clamp
}

export function makeController(plant, opts = {}) {
  const { targetEq = 0, swingUp = null, enter, exit, dt = 1 / 240, gains = DEFAULT_GAINS } = opts
  const g = { ...DEFAULT_GAINS, ...gains }
  const dims = plant.meta.dims
  const t = angleIndex(dims) // theta index; cart pos/vel are dims 0/1
  let integ = 0

  // Live term breakdown for the UI panel (updated each control step).
  const live = { setpoint: 0, integ: 0, P: 0, I: 0, D: 0, force: 0 }

  const balance = {
    law(e, _x, h) {
      const cartPos = e[0], cartVel = e[1], ang = e[t], angRate = e[t + 1]
      let thetaSp = -(g.leanKp * cartPos + g.leanKd * cartVel)
      thetaSp = Math.max(-g.leanMax, Math.min(g.leanMax, thetaSp))
      const aErr = ang - thetaSp
      integ = Math.max(-g.iMax, Math.min(g.iMax, integ + aErr * h))
      const P = g.Kp * aErr, I = g.Ki * integ, D = g.Kd * angRate
      const force = P + I + D
      live.setpoint = thetaSp; live.integ = integ; live.P = P; live.I = I; live.D = D; live.force = force
      return force
    },
    reset() { integ = 0; live.P = live.I = live.D = live.force = live.integ = live.setpoint = 0 },
  }

  const ctrl = makeSwitched(plant, { targetEq, balance, swingUp, enter, exit, controlDt: dt })
  return {
    compute: ctrl.compute, reset: ctrl.reset,
    get balancing() { return ctrl.balancing },
    // Controller internals for the UI panel: gains + live P/I/D breakdown.
    get info() { return { type: 'pid', gains: g, live } },
  }
}
