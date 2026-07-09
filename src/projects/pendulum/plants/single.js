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
  const [, xdot, theta, thetadot] = v
  const sinT = Math.sin(theta), cosT = Math.cos(theta)
  const totalMass = M + m, pml = m * L
  const temp = (force + pml * thetadot * thetadot * sinT - b * xdot) / totalMass
  const thetaAcc = (g * sinT - cosT * temp - bp * thetadot) / (L * (4 / 3 - (m * cosT * cosT) / totalMass))
  const xAcc = temp - (pml * thetaAcc * cosT) / totalMass
  return [xdot, xAcc, thetadot, thetaAcc]
}

// One physics substep — semi-implicit Euler, identical to the original, with a
// soft track stop so the cart can't run off the rail.
export function step(s, force, dt, p = PARAMS) {
  const d = derivative(toVec(s), force, p)
  let nx = s.x + s.xdot * dt
  let nxdot = s.xdot + d[1] * dt
  const ntheta = s.theta + s.thetadot * dt
  const nthetadot = s.thetadot + d[3] * dt
  if (nx > p.trackHalfWidth) { nx = p.trackHalfWidth; nxdot = -nxdot * 0.3 }
  else if (nx < -p.trackHalfWidth) { nx = -p.trackHalfWidth; nxdot = -nxdot * 0.3 }
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
