// Single cart-pole plant, expressed in the shared Plant interface so the same
// controllers, sensors, estimator, and renderer work across single/double.
//
// This is the exact dynamics from the original physics.js (uniform-rod pole,
// motor pushes the cart only). State convention unchanged: theta = 0 upright
// (unstable), theta = ±π hanging (stable). The step() integrator is kept as the
// original semi-implicit Euler so single-pendulum behaviour is preserved
// bit-for-bit; only the derivative() is factored out (the linearizer and the
// double pendulum's RK4 both need a pure array-form derivative).

export const PARAMS = {
  cartMass: 1.0,        // kg
  poleMass: 0.18,       // kg
  poleHalfLength: 0.55, // m — pivot to pole centre of mass
  gravity: 9.81,        // m/s²
  cartDamping: 0.12,
  poleDamping: 0.006,
  forceMax: 11,         // N — deliberately too weak to muscle the pole up statically
  trackHalfWidth: 2.3,  // m
}

export const meta = {
  name: 'single',
  label: 'Single pole',
  dims: ['x', 'xdot', 'theta', 'thetadot'],
  wrap: [2],                           // dims that are wrapping angles (position, not rate)
  measured: ['x', 'theta'],            // a real rig reads cart position + pole angle
  reach: PARAMS.poleHalfLength * 2,    // total pole length (for view scaling)
  equilibria: [
    { name: 'up', label: 'Upright', x: [0, 0, 0, 0] },
    { name: 'down', label: 'Hanging', x: [0, 0, Math.PI, 0] },
  ],
}

// Render description: the pole as a chain of links (one, for the single). Each
// link continues from the previous tip; theta measured from straight-up.
export function renderLinks(s) {
  return [{ len: PARAMS.poleHalfLength * 2, theta: s.theta }]
}

export function initialState() {
  return { x: 0, xdot: 0, theta: Math.PI, thetadot: 0 } // hanging, at rest
}

export function toVec(s) { return [s.x, s.xdot, s.theta, s.thetadot] }
export function fromVec(v) { return { x: v[0], xdot: v[1], theta: v[2], thetadot: v[3] } }

export function wrapPi(a) {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}

// Array-form derivative for RK4 / linearization: (vec, force, p) -> dvec.
export function derivative(v, force, p = PARAMS) {
  const { cartMass: M, poleMass: m, poleHalfLength: L, gravity: g, cartDamping: b, poleDamping: bp } = p
  const [x, xdot, theta, thetadot] = v
  const sinT = Math.sin(theta), cosT = Math.cos(theta)
  const totalMass = M + m, pml = m * L
  const denom = L * (4 / 3 - (m * cosT * cosT) / totalMass)
  const temp = (force + pml * thetadot * thetadot * sinT - b * xdot) / totalMass
  const thetaAcc = (g * sinT - cosT * temp - bp * thetadot) / denom
  const xAcc = temp - (pml * thetaAcc * cosT) / totalMass
  // Rail end-stop as a hard non-penetrating constraint: while the motor is
  // driving the cart into a stop, the wall's normal force pins the cart
  // (xAcc = 0) and the pole swings on a FIXED pivot. The drive force is absorbed
  // by the wall — it never reaches the pole (temp -> 0), so it can't tilt/pump it.
  // Gating on the drive-force direction (not the net acceleration) keeps the cart
  // firmly on the stop instead of letting the pole's reaction bounce it off and
  // get re-slammed, which would numerically pump energy into the pole.
  if ((x >= p.trackHalfWidth && force > 0) || (x <= -p.trackHalfWidth && force < 0)) {
    // Fixed-pivot pendulum: use the CONSTANT rod inertia denominator L·(4/3), not
    // the free-cart `denom` (which varies with cos²θ). A θ-dependent inertia here
    // would be a parametric oscillator and would spuriously pump the pole.
    return [xdot, 0, thetadot, (g * sinT - bp * thetadot) / (L * (4 / 3))]
  }
  return [xdot, xAcc, thetadot, thetaAcc]
}

// One physics substep — semi-implicit Euler. The cart can't penetrate the rail:
// at a stop, outward velocity is killed (inelastic) so it neither passes through
// nor bounces (a bounce would numerically pump the pole).
export function step(s, force, dt, p = PARAMS) {
  const d = derivative(toVec(s), force, p)
  let nxdot = s.xdot + d[1] * dt
  const nthetadot = s.thetadot + d[3] * dt
  // Normal operation uses the original explicit Euler (positions from the OLD
  // velocities) so the controllers' tuning is unchanged — they keep the cart off
  // the rails, so they never hit the branch below. When the cart is PINNED at a
  // rail the pole is a free oscillator, and explicit Euler would spuriously pump
  // it; integrate that case semi-implicitly (position from the NEW velocity).
  const pinned = (s.x >= p.trackHalfWidth && force > 0) || (s.x <= -p.trackHalfWidth && force < 0)
  let nx = s.x + (pinned ? nxdot : s.xdot) * dt
  const ntheta = s.theta + (pinned ? nthetadot : s.thetadot) * dt
  if (nx > p.trackHalfWidth) { nx = p.trackHalfWidth; if (nxdot > 0) nxdot = 0 }
  else if (nx < -p.trackHalfWidth) { nx = -p.trackHalfWidth; if (nxdot < 0) nxdot = 0 }
  return { x: nx, xdot: nxdot, theta: wrapPi(ntheta), thetadot: nthetadot }
}

// Total mechanical energy of the pole relative to the upright rest state
// (0 at theta=0,thetadot=0; most negative hanging). Drives energy swing-up.
export function energy(s, p = PARAMS) {
  const { poleMass: m, poleHalfLength: L, gravity: g } = p
  return 0.5 * m * L * L * s.thetadot * s.thetadot + m * g * L * (Math.cos(s.theta) - 1)
}

// What a real sensor package sees (positions only; velocities are estimated).
export function measure(s) { return { x: s.x, theta: s.theta } }
