// Phase 0 checkpoint: validate the shared linearizer/LQR against KNOWN-GOOD
// properties (not magic numbers). The single cart-pole at the upright
// equilibrium is the reference plant.
//
// NOTE: the gains originally shipped in pendulum/control.js came from a
// prototype Riccati iteration that omitted the +KᵀRK term — a subtly wrong
// DARE. This library solves the correct discrete algebraic Riccati equation, so
// its gains are larger in magnitude (truly LQR-optimal). We therefore validate:
//   1. the numeric Jacobian reproduces the analytic (A,B),
//   2. the returned P satisfies the DARE (residual ≈ 0),
//   3. the discrete closed loop (Ad−BdK) is stable (perturbation decays),
//   4. the gain actually stabilizes the NONLINEAR plant within the force limit.

import { lqrForEquilibrium } from '../src/lib/control/linearize.js'
import { diag, transpose, matMul, matAdd, matSub } from '../src/lib/control/linalg.js'

const PARAMS = {
  cartMass: 1.0, poleMass: 0.18, poleHalfLength: 0.55, gravity: 9.81,
  cartDamping: 0.12, poleDamping: 0.006, forceMax: 11, trackHalfWidth: 2.3,
}
function derivative(s, force, p) {
  const { cartMass: M, poleMass: m, poleHalfLength: L, gravity: g, cartDamping: b, poleDamping: bp } = p
  const [, xdot, theta, thetadot] = s
  const sinT = Math.sin(theta), cosT = Math.cos(theta)
  const totalMass = M + m, pml = m * L
  const temp = (force + pml * thetadot * thetadot * sinT - b * xdot) / totalMass
  const thetaAcc = (g * sinT - cosT * temp - bp * thetadot) / (L * (4 / 3 - (m * cosT * cosT) / totalMass))
  const xAcc = temp - (pml * thetaAcc * cosT) / totalMass
  return [xdot, xAcc, thetadot, thetaAcc]
}
const single = {
  PARAMS, derivative,
  meta: { equilibria: [{ name: 'upright', x: [0, 0, 0, 0] }, { name: 'hanging', x: [0, 0, Math.PI, 0] }] },
}

const dt = 1 / 240
const Q = diag([2, 1, 40, 4])
const R = 0.02
const { K, A, B, Ad, Bd, P } = lqrForEquilibrium(single, 0, Q, R, dt)

let ok = true
const fail = (msg) => { ok = false; console.log('  FAIL:', msg) }

// 1. Jacobian vs analytic (these values are hand-verified for this plant).
const expA = [[0, 1, 0, 0], [0, -0.1148, -1.2673, 0.0008], [0, 0, 0, 1], [0, 0.1566, 15.1054, -0.0092]]
const expB = [0, 0.9569, 0, -1.3049]
console.log('1. Jacobian A,B:')
A.forEach(r => console.log('   ', r.map(v => v.toFixed(4)).join('\t')))
console.log('    B:', B.map(r => r[0].toFixed(4)).join(', '))
for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4; j++) if (Math.abs(A[i][j] - expA[i][j]) > 0.01) fail(`A[${i}][${j}] ${A[i][j].toFixed(4)} != ${expA[i][j]}`)
  if (Math.abs(B[i][0] - expB[i]) > 0.01) fail(`B[${i}] ${B[i][0].toFixed(4)} != ${expB[i]}`)
}

// 2. DARE residual: P == Q + Adᵀ P Ad − (Adᵀ P Bd)(R + Bdᵀ P Bd)⁻¹(Bdᵀ P Ad)
const AdT = transpose(Ad), BdT = transpose(Bd)
const AtP = matMul(AdT, P)
const denom = R + matMul(matMul(BdT, P), Bd)[0][0]
const AtPBd = matMul(AtP, Bd)            // 4×1
const BtPAd = matMul(matMul(BdT, P), Ad) // 1×4
const corr = matMul(AtPBd, BtPAd).map(row => row.map(v => v / denom))
const rhs = matAdd(Q, matSub(matMul(AtP, Ad), corr))
let resid = 0
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) resid = Math.max(resid, Math.abs(rhs[i][j] - P[i][j]))
console.log('\n2. DARE residual (max abs):', resid.toExponential(2))
if (resid > 1e-4) fail('DARE residual too large')

console.log('\n   LQR gain K:', K.map(v => v.toFixed(3)).join(', '))

// 3. Discrete closed-loop stability: iterate x+ = (Ad − Bd K) x from a tilt.
let xd = [0, 0, 0.2, 0]
for (let n = 0; n < 4000; n++) {
  const u = -(K[0] * xd[0] + K[1] * xd[1] + K[2] * xd[2] + K[3] * xd[3])
  xd = [
    Ad[0][0] * xd[0] + Ad[0][1] * xd[1] + Ad[0][2] * xd[2] + Ad[0][3] * xd[3] + Bd[0][0] * u,
    Ad[1][0] * xd[0] + Ad[1][1] * xd[1] + Ad[1][2] * xd[2] + Ad[1][3] * xd[3] + Bd[1][0] * u,
    Ad[2][0] * xd[0] + Ad[2][1] * xd[1] + Ad[2][2] * xd[2] + Ad[2][3] * xd[3] + Bd[2][0] * u,
    Ad[3][0] * xd[0] + Ad[3][1] * xd[1] + Ad[3][2] * xd[2] + Ad[3][3] * xd[3] + Bd[3][0] * u,
  ]
}
const dnorm = Math.hypot(...xd)
console.log('3. Discrete closed-loop state after 4000 steps:', dnorm.toExponential(2))
if (dnorm > 1e-3) fail('discrete closed loop did not decay (unstable gain)')

// 4. Nonlinear plant settling with the clamped real force limit.
function stepEuler(s, force, p, h) {
  const d = derivative(s, force, p)
  const nx = [s[0] + s[1] * h, s[1] + d[1] * h, s[2] + s[3] * h, s[3] + d[3] * h]
  return nx
}
let s = [0, 0, 0.3, 0] // 0.3 rad ≈ 17° tilt, at rest
for (let n = 0; n < Math.round(8 / dt); n++) {
  let f = -(K[0] * s[0] + K[1] * s[1] + K[2] * s[2] + K[3] * s[3])
  f = Math.max(-PARAMS.forceMax, Math.min(PARAMS.forceMax, f))
  s = stepEuler(s, f, PARAMS, dt)
}
console.log('4. Nonlinear settle from 0.3 rad tilt -> theta:', s[2].toFixed(4), ' x:', s[0].toFixed(3))
if (Math.abs(s[2]) > 0.02 || Math.abs(s[3]) > 0.05) fail('nonlinear plant did not settle upright')

console.log(ok ? '\nPASS: linearizer + DARE-LQR validated (analytic Jacobian, zero residual, stable, settles)'
              : '\nFAIL: see above')
process.exit(ok ? 0 : 1)
