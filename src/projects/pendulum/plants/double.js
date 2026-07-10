// Double cart-pole plant — two uniform-rod links hinged in series on a cart,
// still driven only by the cart force (now TWO unactuated angles from one input:
// a much harder, chaotic, higher-order system). Absolute angle convention: θ1,
// θ2 are each measured from straight-up, so every (θ1,θ2) ∈ {0=up, π=down}² is
// an equilibrium — the four the UI lets you target.
//
// Dynamics: Lagrangian for cart + two uniform rods gives a 3×3 mass matrix
// M(q)·q̈ = rhs(q,q̇,F); we invert M each derivative evaluation and integrate
// with RK4 (semi-implicit Euler diverges on the chaotic double). Constants below
// follow the standard derivation:
//   d1=M+m1+m2         d2=m1·a1+m2·L1     d3=m2·a2
//   d4=m1·a1²+m2·L1²+I1 d5=m2·L1·a2       d6=m2·a2²+I2
//   f1=(m1·a1+m2·L1)g   f2=m2·a2·g
// with ai=Li/2 (rod COM) and Ii=(1/12)mi·Li² (rod inertia).

import { rk4 } from '../../../lib/control/integrate.js'
import { inv, matVec } from '../../../lib/control/linalg.js'

export const PARAMS = {
  cartMass: 1.0, m1: 0.20, m2: 0.15, L1: 0.5, L2: 0.5,
  gravity: 9.81, cartDamping: 0.10, jointDamping: 0.005,
  forceMax: 30, trackHalfWidth: 2.3,
}

// Precomputed rod constants (depend only on PARAMS).
function consts(p) {
  const a1 = p.L1 / 2, a2 = p.L2 / 2
  const I1 = p.m1 * p.L1 * p.L1 / 12, I2 = p.m2 * p.L2 * p.L2 / 12
  return {
    a1, a2, I1, I2,
    d1: p.cartMass + p.m1 + p.m2,
    d2: p.m1 * a1 + p.m2 * p.L1,
    d3: p.m2 * a2,
    d4: p.m1 * a1 * a1 + p.m2 * p.L1 * p.L1 + I1,
    d5: p.m2 * p.L1 * a2,
    d6: p.m2 * a2 * a2 + I2,
    f1: (p.m1 * a1 + p.m2 * p.L1) * p.gravity,
    f2: p.m2 * a2 * p.gravity,
  }
}

export const meta = {
  name: 'double',
  label: 'Double pole',
  dims: ['x', 'theta1', 'theta2', 'xdot', 'theta1dot', 'theta2dot'],
  wrap: [1, 2],
  measured: ['x', 'theta1', 'theta2'],
  reach: PARAMS.L1 + PARAMS.L2,
  // (θ1, θ2): up=0, down=π. Order chosen so index 0 = fully upright (the default).
  equilibria: [
    { name: 'up-up', label: 'Both up', x: [0, 0, 0, 0, 0, 0] },
    { name: 'up-down', label: 'Lower up, upper down', x: [0, 0, Math.PI, 0, 0, 0] },
    { name: 'down-up', label: 'Lower down, upper up', x: [0, Math.PI, 0, 0, 0, 0] },
    { name: 'down-down', label: 'Both hanging', x: [0, Math.PI, Math.PI, 0, 0, 0] },
  ],
}

export function initialState() {
  // Both hanging, at rest.
  return { x: 0, theta1: Math.PI, theta2: Math.PI, xdot: 0, theta1dot: 0, theta2dot: 0 }
}

export function toVec(s) { return [s.x, s.theta1, s.theta2, s.xdot, s.theta1dot, s.theta2dot] }
export function fromVec(v) { return { x: v[0], theta1: v[1], theta2: v[2], xdot: v[3], theta1dot: v[4], theta2dot: v[5] } }

function wrapPi(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI }

export function derivative(v, force, p = PARAMS) {
  const [, th1, th2, xd, th1d, th2d] = v
  const c = consts(p)
  const c1 = Math.cos(th1), s1 = Math.sin(th1)
  const c2 = Math.cos(th2), s2 = Math.sin(th2)
  const c12 = Math.cos(th1 - th2), s12 = Math.sin(th1 - th2)

  const M = [
    [c.d1, c.d2 * c1, c.d3 * c2],
    [c.d2 * c1, c.d4, c.d5 * c12],
    [c.d3 * c2, c.d5 * c12, c.d6],
  ]
  const rhs = [
    force - p.cartDamping * xd + c.d2 * s1 * th1d * th1d + c.d3 * s2 * th2d * th2d,
    c.f1 * s1 - c.d5 * s12 * th2d * th2d - p.jointDamping * th1d,
    c.f2 * s2 + c.d5 * s12 * th1d * th1d - p.jointDamping * th2d,
  ]
  const acc = matVec(inv(M), rhs) // [xddot, th1ddot, th2ddot]
  // Rail end-stop as a hard constraint (see single.js): while the motor drives
  // the cart into a stop, force xAcc = 0 and re-solve the 2×2 link subsystem (the
  // force lives only in the cart row, so with xAcc = 0 it never reaches the links).
  const x = v[0]
  if ((x >= p.trackHalfWidth && force > 0) || (x <= -p.trackHalfWidth && force < 0)) {
    const det = M[1][1] * M[2][2] - M[1][2] * M[2][1]
    const th1a = (M[2][2] * rhs[1] - M[1][2] * rhs[2]) / det
    const th2a = (-M[2][1] * rhs[1] + M[1][1] * rhs[2]) / det
    return [xd, th1d, th2d, 0, th1a, th2a]
  }
  return [xd, th1d, th2d, acc[0], acc[1], acc[2]]
}

export function step(s, force, dt, p = PARAMS) {
  const nv = rk4(derivative, toVec(s), force, dt, p) // wall constraint is inside the dynamics
  let nx = nv[0], nxd = nv[3]
  if (nx > p.trackHalfWidth) { nx = p.trackHalfWidth; if (nxd > 0) nxd = 0 }
  else if (nx < -p.trackHalfWidth) { nx = -p.trackHalfWidth; if (nxd < 0) nxd = 0 }
  return fromVec([nx, wrapPi(nv[1]), wrapPi(nv[2]), nxd, nv[4], nv[5]])
}

// Total mechanical energy (kinetic + gravitational potential), absolute.
export function energy(s, p = PARAMS) {
  const c = consts(p)
  const { xdot: xd, theta1: t1, theta2: t2, theta1dot: w1, theta2dot: w2 } = s
  const c1 = Math.cos(t1), s1 = Math.sin(t1), c2 = Math.cos(t2), s2 = Math.sin(t2)
  const xd1 = xd + c.a1 * c1 * w1, yd1 = -c.a1 * s1 * w1
  const xd2 = xd + p.L1 * c1 * w1 + c.a2 * c2 * w2, yd2 = -p.L1 * s1 * w1 - c.a2 * s2 * w2
  const T = 0.5 * p.cartMass * xd * xd
    + 0.5 * p.m1 * (xd1 * xd1 + yd1 * yd1) + 0.5 * c.I1 * w1 * w1
    + 0.5 * p.m2 * (xd2 * xd2 + yd2 * yd2) + 0.5 * c.I2 * w2 * w2
  const V = p.m1 * p.gravity * c.a1 * c1 + p.m2 * p.gravity * (p.L1 * c1 + c.a2 * c2)
  return T + V
}

export function measure(s) { return { x: s.x, theta1: s.theta1, theta2: s.theta2 } }

// Render chain: link 1 from the cart pivot, link 2 continuing from its tip.
export function renderLinks(s) {
  return [{ len: PARAMS.L1, theta: s.theta1 }, { len: PARAMS.L2, theta: s.theta2 }]
}
