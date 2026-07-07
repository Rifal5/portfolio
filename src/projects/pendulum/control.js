import { poleEnergy, PARAMS } from './physics.js'

// Two-mode classical controller — the textbook approach to swing-up-and-balance:
//
//  1. SWING-UP (energy pumping): far from upright, the motor is too weak to
//     lift the pole directly (forceMax is deliberately undersized). Instead it
//     injects energy each swing using the Åström–Furuta energy-shaping law:
//     push the cart in the direction that adds energy toward the upright
//     energy level, timed by the sign of (thetadot·cosθ). Each pass through
//     the bottom, the pole swings a little higher.
//
//  2. BALANCE (LQR state feedback): once near vertical with low angular rate,
//     hand off to a proper LQR regulator (see K below) that holds θ≈0 and
//     recenters the cart. Hysteresis on the switch prevents mode chatter.
//
// The swing-up law alone leaves the cart free to drift (nothing in the energy
// law constrains x), so a small position-recentering term rides along with it
// — weak enough not to fight the energy pumping, strong enough to keep the
// cart from wandering off the physical track between swings.

const SWING_GAIN = 1.5
const SWING_POS_GAIN = 0.8
const SWING_POS_DAMP = 0.4
const BALANCE_ENTER = { theta: 0.4, thetadot: 2.2 }   // rad, rad/s — enter balance mode
const BALANCE_EXIT = { theta: 0.6, thetadot: 3.2 }    // rad, rad/s — fall back to swing-up

// LQR state-feedback gains: u = -(Kx·x + Kxd·xdot + Kth·theta + Kthd·thetadot).
// Computed offline by numerically linearizing the plant about the upright
// equilibrium (finite-difference Jacobian of the exact nonlinear dynamics)
// and solving the discrete-time algebraic Riccati equation with
// Q = diag(2, 1, 40, 4), R = 0.02 — i.e. angle error is penalized far more
// than cart drift, which is what makes it recover fast without wandering.
const K = { x: -6.944, xdot: -11.149, theta: -75.551, thetadot: -21.071 }

export function makeController(p = PARAMS) {
  let balancing = false

  function reset() { balancing = false }

  function compute(state) {
    const { theta, thetadot, x, xdot } = state
    const enter = Math.abs(theta) < BALANCE_ENTER.theta && Math.abs(thetadot) < BALANCE_ENTER.thetadot
    const exit = Math.abs(theta) > BALANCE_EXIT.theta || Math.abs(thetadot) > BALANCE_EXIT.thetadot
    if (!balancing && enter) balancing = true
    else if (balancing && exit) balancing = false

    let force, mode
    if (balancing) {
      force = -(K.x * x + K.xdot * xdot + K.theta * theta + K.thetadot * thetadot)
      mode = 'balance'
    } else if (Math.abs(thetadot) < 0.05) {
      // Hanging at rest is itself a stable equilibrium — the energy law's
      // thetadot factor vanishes there, so it never gets a first push without
      // a nudge. Kick away from whichever wall the cart is near (a fixed
      // direction would fight the position-recenter term once near a limit).
      const dir = x > 0.3 ? -1 : 1
      force = p.forceMax * 0.5 * dir
      mode = 'kick-start'
    } else {
      // Energy-shaping swing-up (Åström–Furuta). From the equations of motion,
      // dE/dt = -m·L·cosθ·θ̇·ẍ_cart, so commanding ẍ_cart ∝ cosθ·θ̇·(E - E0)
      // makes dE/dt have the sign of -(E - E0)² scaled appropriately... concretely:
      // this drives E monotonically toward the upright energy E0 = 0, adding
      // energy while below it and bleeding it off if it overshoots.
      const E = poleEnergy(state, p)
      force = SWING_GAIN * Math.cos(theta) * thetadot * E - SWING_POS_GAIN * x - SWING_POS_DAMP * xdot
      mode = 'swing-up'
    }
    force = Math.max(-p.forceMax, Math.min(p.forceMax, force))
    return { force, mode }
  }

  return { compute, reset, get balancing() { return balancing } }
}
