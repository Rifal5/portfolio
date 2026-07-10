// Energy-shaping swing-up for the single cart-pole (Åström–Furuta). The motor
// is too weak to lift the pole directly, so we pump energy toward the upright
// level one swing at a time. Derived from the equations of motion:
// dE/dt = -m·L·cosθ·θ̇·ẍ_cart, so commanding ẍ_cart ∝ cosθ·θ̇·E drives total
// mechanical energy toward the upright value E=0. A small cart-recentering term
// keeps it from drifting off the rail; a fixed kick breaks the symmetry when
// hanging exactly at rest (where the energy law's θ̇ factor vanishes).
//
// Returns { force, mode } so the caller can display the phase. This is the
// SINGLE plant's swing-up; the double gets its own in Phase 5.

const SWING_GAIN = 1.5
const SWING_POS_GAIN = 0.8
const SWING_POS_DAMP = 0.4

export function makeSingleSwingUp(plant, p = plant.PARAMS) {
  return function swingUp(s) {
    const { theta, thetadot, x, xdot } = s
    if (Math.abs(thetadot) < 0.05) {
      // Kick away from whichever wall is near so we don't fight the recenter term.
      const dir = x > 0.3 ? -1 : 1
      return { force: p.forceMax * 0.5 * dir, mode: 'kick-start' }
    }
    const E = plant.energy(s, p)
    const force = SWING_GAIN * Math.cos(theta) * thetadot * E - SWING_POS_GAIN * x - SWING_POS_DAMP * xdot
    return { force, mode: 'swing-up' }
  }
}

// Energy-pumping transition for the DOUBLE toward a target equilibrium. Same
// idea as the single (drive the total energy toward the target's energy through
// the cart-pole coupling), generalized: the cart's acceleration couples to both
// links via d2·cosθ1·θ̇1 + d3·cosθ2·θ̇2. HONEST LIMITATION: energy pumping fixes
// the total energy but a two-link system has many configurations at the same
// energy, so this reliably reaches only the low targets (→ hanging); reaching an
// inverted equilibrium from far away is a research-grade problem (the neural
// controller is the better bet, and even it is a stretch). The controller still
// runs it as an honest "trying" phase; the LQR catches it if it enters the basin.
export function makeDoubleSwingUp(plant, targetEq, p = plant.PARAMS) {
  const a1 = p.L1 / 2, a2 = p.L2 / 2
  const d2 = p.m1 * a1 + p.m2 * p.L1, d3 = p.m2 * a2
  const Etarget = plant.energy(plant.fromVec(plant.meta.equilibria[targetEq].x), p)
  const GAIN = 9, KPOS = 3, KVEL = 2
  return function swingUp(s) {
    const coupling = d2 * Math.cos(s.theta1) * s.theta1dot + d3 * Math.cos(s.theta2) * s.theta2dot
    if (Math.abs(s.theta1dot) < 0.05 && Math.abs(s.theta2dot) < 0.05) {
      // At rest the coupling vanishes; a kick breaks the symmetry so pumping starts.
      return { force: p.forceMax * 0.6 * (s.x > 0.3 ? -1 : 1), mode: 'kick-start' }
    }
    const E = plant.energy(s, p)
    const force = GAIN * coupling * (E - Etarget) - KPOS * s.x - KVEL * s.xdot
    return { force, mode: 'swing-up' }
  }
}
