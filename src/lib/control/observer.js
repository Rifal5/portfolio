// State estimator (Extended Kalman Filter). On a real rig you measure positions
// (cart position, pole angles) with noise + quantization but never velocities —
// the controller needs the full state, so an observer reconstructs it.
//
// This is an EKF rather than a plain linear KF so it stays valid across the WHOLE
// motion (hanging, swing-up, balance), not just near one equilibrium:
//   predict — propagate the estimate through the true NONLINEAR dynamics (RK4),
//             and advance the covariance with the model linearized about the
//             current estimate (Jacobian from the shared linearizer).
//   update  — the measurement model is linear (we sense states directly), so the
//             correction is an exact Kalman update with a constant selection H.
//
// Feeding the controller this estimate instead of the true state is what makes
// realistic mode behave like hardware: the loop trusts a slightly-wrong, noisy
// reconstruction.

import { rk4 } from './integrate.js'
import { jacobian } from './linearize.js'
import { identity, diag, matMul, matAdd, matSub, matScale, transpose, inv } from './linalg.js'

function wrapPi(a) {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}

// plant: a Plant (meta.dims, meta.measured, derivative, fromVec, PARAMS).
// opts.dt          estimator/control timestep
// opts.processNoise array length n — diagonal process covariance Q
// opts.measNoise    array length m — diagonal measurement covariance R
// opts.x0           optional initial state estimate (array)
export function makeEKF(plant, { dt, processNoise, measNoise, x0 = null } = {}) {
  const dims = plant.meta.dims
  const n = dims.length
  const measIdx = plant.meta.measured.map(name => dims.indexOf(name))
  const m = measIdx.length
  const H = measIdx.map(idx => dims.map((_, j) => (j === idx ? 1 : 0)))
  const HT = transpose(H)
  const Q = diag(processNoise)
  const R = diag(measNoise)
  // Only position angles wrap; velocity dims must not be wrapped.
  const wrapSet = plant.meta.wrap || dims.map((d, i) => (d.startsWith('theta') && !d.endsWith('dot') ? i : -1)).filter(i => i >= 0)
  const isAngle = dims.map((_, i) => wrapSet.includes(i))

  // Internal angle states are kept UNWRAPPED — the dynamics only see sin/cos so
  // a growing angle is harmless, and it avoids a 2π teleport mid-swing that would
  // otherwise wreck the covariance and invert the velocity estimate. Wrapping is
  // applied only where it matters: the measurement innovation and the reported state.
  let x = x0 ? [...x0] : new Array(n).fill(0)
  let P = diag(new Array(n).fill(1))

  function predict(u) {
    x = rk4(plant.derivative, x, u, dt, plant.PARAMS)
    const { A } = jacobian(plant.derivative, x, u, plant.PARAMS)
    const Ad = matAdd(identity(n), matScale(A, dt))
    P = matAdd(matMul(matMul(Ad, P), transpose(Ad)), Q)
  }

  // measured: the sensor output object, e.g. { x, theta }.
  function update(measured) {
    const innov = measIdx.map(idx => {
      let d = measured[dims[idx]] - x[idx]
      if (isAngle[idx]) d = wrapPi(d)
      return d
    })
    const S = matAdd(matMul(matMul(H, P), HT), R)   // m×m
    const Kf = matMul(matMul(P, HT), inv(S))        // n×m
    x = x.map((v, i) => v + Kf[i].reduce((s, k, j) => s + k * innov[j], 0))
    P = matMul(matSub(identity(n), matMul(Kf, H)), P)
  }

  const outVec = () => x.map((v, i) => (isAngle[i] ? wrapPi(v) : v))
  return {
    predict, update,
    state() { return plant.fromVec(outVec()) },
    get vec() { return outVec() },
    reset(x0b = null) { x = x0b ? [...x0b] : new Array(n).fill(0); P = diag(new Array(n).fill(1)) },
  }
}
