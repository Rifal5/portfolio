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
