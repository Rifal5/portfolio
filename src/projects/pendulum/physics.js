// Cart-pole (inverted pendulum) dynamics — the classic underactuated control
// problem. A cart moves along a horizontal track under a motor force; a pole
// is hinged to the cart and swings freely under gravity. The motor can only
// push the CART, never the pole directly, so uprighting the pole means
// pumping energy through the cart's motion (this is the underactuation that
// makes "self-righting" a genuine control problem, not a lookup).
//
// Model: pole = uniform rigid rod of length 2·H (H = half-length, distance to
// center of mass), pivoting frictionlessly on the cart. State convention:
// theta = 0 is upright (unstable equilibrium), theta = ±π is hanging straight
// down (stable equilibrium) — the pole starts there and must be swung up.

export const PARAMS = {
  cartMass: 1.0,        // kg
  poleMass: 0.18,       // kg
  poleHalfLength: 0.55, // m — distance from pivot to pole's center of mass
  gravity: 9.81,        // m/s²
  cartDamping: 0.12,    // friction opposing cart velocity
  poleDamping: 0.006,   // small bearing friction at the pivot (keeps energy from being perfectly conserved)
  forceMax: 11,         // N — deliberately too weak to just muscle the pole up statically
  trackHalfWidth: 2.3,  // m — physical rail length each side of center
}

export function initialState() {
  return { x: 0, xdot: 0, theta: Math.PI, thetadot: 0 } // hanging straight down, at rest
}

function wrapPi(a) {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}

// One physics substep (semi-implicit Euler). `force` is the commanded cart
// force in Newtons (already clamped by the caller to ±forceMax).
export function step(state, force, dt, p = PARAMS) {
  const { cartMass: M, poleMass: m, poleHalfLength: L, gravity: g, cartDamping: b, poleDamping: bp } = p
  const { x, xdot, theta, thetadot } = state
  const sinT = Math.sin(theta), cosT = Math.cos(theta)
  const totalMass = M + m
  const pml = m * L

  // Standard cart-pole equations of motion (uniform-rod inertia, exact
  // nonlinear form — valid at any angle, not just near the top).
  const temp = (force + pml * thetadot * thetadot * sinT - b * xdot) / totalMass
  const thetaAcc = (g * sinT - cosT * temp - bp * thetadot) / (L * (4 / 3 - (m * cosT * cosT) / totalMass))
  const xAcc = temp - (pml * thetaAcc * cosT) / totalMass

  let nx = x + xdot * dt
  let nxdot = xdot + xAcc * dt
  let ntheta = theta + thetadot * dt
  let nthetadot = thetadot + thetaAcc * dt

  // Track limits: soft stop with energy loss, so the cart can't run away.
  if (nx > p.trackHalfWidth) { nx = p.trackHalfWidth; nxdot = -nxdot * 0.3 }
  else if (nx < -p.trackHalfWidth) { nx = -p.trackHalfWidth; nxdot = -nxdot * 0.3 }

  return { x: nx, xdot: nxdot, theta: wrapPi(ntheta), thetadot: nthetadot }
}

// Total mechanical energy of the pole relative to the upright rest state
// (E = 0 at theta = 0, thetadot = 0; E is most negative when hanging at rest).
// Used by the swing-up controller to know how much energy to pump in.
export function poleEnergy(state, p = PARAMS) {
  const { poleMass: m, poleHalfLength: L, gravity: g } = p
  return 0.5 * m * L * L * state.thetadot * state.thetadot + m * g * L * (Math.cos(state.theta) - 1)
}
