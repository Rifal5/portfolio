// Offline control-design helpers: linearize a nonlinear plant about an
// equilibrium, discretize it, and solve the discrete-time LQR (optimal
// full-state feedback) gain. This promotes the one-off numeric-Jacobian +
// Riccati prototype that produced the single pendulum's balance gains into a
// reusable tool, so the double pendulum's four equilibria get gains the same
// validated way.
//
// Single control input throughout (the cart force), so B is n×1 and the LQR
// "R" is a scalar — no control-side matrix inverse needed.

import { zeros, identity, transpose, matMul, matAdd, matSub, colVec, matScale } from './linalg.js'

// Central-difference Jacobian of `deriv(stateArray, u, p) -> dstateArray` about
// (xEq, uEq). Returns continuous-time A (n×n) and B (n×1). Central differences
// are used because a wrong Jacobian silently yields bad gains — the extra
// accuracy is cheap and this runs offline.
export function jacobian(deriv, xEq, uEq, p, eps = 1e-6) {
  const n = xEq.length
  const A = zeros(n, n)
  for (let j = 0; j < n; j++) {
    const xp = [...xEq]; xp[j] += eps
    const xm = [...xEq]; xm[j] -= eps
    const fp = deriv(xp, uEq, p)
    const fm = deriv(xm, uEq, p)
    for (let i = 0; i < n; i++) A[i][j] = (fp[i] - fm[i]) / (2 * eps)
  }
  const B = zeros(n, 1)
  const fpU = deriv(xEq, uEq + eps, p)
  const fmU = deriv(xEq, uEq - eps, p)
  for (let i = 0; i < n; i++) B[i][0] = (fpU[i] - fmU[i]) / (2 * eps)
  return { A, B }
}

// Forward-Euler discretization: Ad = I + A·dt, Bd = B·dt. Adequate for gain
// synthesis and for the Kalman model at the control rates we use.
export function discretize({ A, B, dt }) {
  const n = A.length
  return { Ad: matAdd(identity(n), matScale(A, dt)), Bd: matScale(B, dt) }
}

// Discrete-time LQR via backward Riccati iteration to steady state (no
// eigensolver). Accepts continuous A,B and a timestep, or pre-discretized
// Ad,Bd. Q is n×n, R is a positive scalar. Returns K (1×n array, so u* = -K·x)
// and the converged cost matrix P.
export function dlqr({ A, B, Ad, Bd, Q, R, dt, iters = 2000 }) {
  if (!Ad || !Bd) { ({ Ad, Bd } = discretize({ A, B, dt })) }
  const n = Ad.length
  const AdT = transpose(Ad)
  const BdT = transpose(Bd) // 1×n
  let P = Q
  let K = zeros(1, n)[0]
  for (let it = 0; it < iters; it++) {
    const BtP = matMul(BdT, P)              // 1×n
    const denom = R + matMul(BtP, Bd)[0][0] // scalar
    const BtPAd = matMul(BtP, Ad)[0]        // 1×n
    K = BtPAd.map(v => v / denom)
    // P = Q + Adᵀ P Ad − (Adᵀ P Bd) K
    const AtP = matMul(AdT, P)
    const AtPAd = matMul(AtP, Ad)
    const AtPBd = matMul(AtP, Bd)           // n×1
    const outer = matMul(AtPBd, [K])        // n×n
    const Pnext = matAdd(Q, matSub(AtPAd, outer))
    // Cheap convergence check on the gain.
    let delta = 0
    for (let i = 0; i < n; i++) delta += Math.abs(Pnext[i][i] - P[i][i])
    P = Pnext
    if (delta < 1e-10) break
  }
  return { K, P }
}

// End-to-end: linearize a plant about one of its equilibria and return the LQR
// gain plus the (A,B,Ad,Bd) matrices — the Kalman filter reuses the same
// linear model, so this single call feeds both the controller and the observer.
export function lqrForEquilibrium(plant, eqIndex, Q, R, dt) {
  const xEq = plant.meta.equilibria[eqIndex].x
  const { A, B } = jacobian(plant.derivative, xEq, 0, plant.PARAMS)
  const { Ad, Bd } = discretize({ A, B, dt })
  const { K, P } = dlqr({ Ad, Bd, Q, R, dt })
  return { A, B, Ad, Bd, K, P }
}
