// Iterative LQR (iLQR / DDP with Gauss-Newton Hessians) — offline trajectory
// optimization for underactuated maneuvers, e.g. swinging a double pendulum
// between equilibria. This is the modern form of the two-degrees-of-freedom
// design used by Graichen et al. (2007) and Glück et al. (2013): it produces a
// dynamically feasible feedforward trajectory AND, as a byproduct of the
// backward pass, the time-varying LQR gains that track it robustly.
//
// Scalar control (one cart motor). Discrete dynamics are RK4 over the plant's
// continuous derivative — NO angle wrapping inside the optimizer (trajectories
// live in unwrapped angle space; wrap-awareness belongs in the cost and in the
// runtime tracker).
//
//   ilqr({ deriv, p, n, dt, N, x0, uInit, uMax, running, terminal, iters })
//     deriv(x, u, p) -> dx          continuous dynamics (array form)
//     running(x, u, t) -> { l, lx[n], lxxDiag[n], lu, luu }
//     terminal(x) -> { l, lx[n], lxxDiag[n] }
//   -> { xs[N+1][n], us[N], Ks[N][n], cost, converged }
//
// Gauss-Newton style: cost Hessians are the caller-supplied diagonals (kept
// positive), dynamics second derivatives are dropped — the standard iLQR
// simplification, robust in practice.

import { rk4 } from './integrate.js'

export function ilqr({ deriv, p, n, dt, N, x0, uInit, uMax = Infinity, running, terminal, iters = 300, tol = 1e-7, verbose = null, stepFn = null }) {
  const clamp = u => Math.max(-uMax, Math.min(uMax, u))
  // stepFn(x, u) -> x' overrides the default RK4 discrete dynamics — used e.g.
  // for control-rate (slew) constrained problems where the state is augmented
  // with the previous force and the control is the force INCREMENT, making
  // uMax an exact slew limit.
  const f = stepFn || ((x, u) => rk4(deriv, x, u, dt, p))

  // --- rollout with given controls (open loop) ---
  function rollout(us) {
    const xs = [x0.slice()]
    for (let t = 0; t < N; t++) xs.push(f(xs[t], us[t]))
    return xs
  }
  function totalCost(xs, us) {
    let J = 0
    for (let t = 0; t < N; t++) J += running(xs[t], us[t], t).l
    return J + terminal(xs[N]).l
  }

  // --- finite-difference discrete dynamics Jacobians ---
  const EPS = 1e-5
  function jacobians(x, u) {
    const fx = Array.from({ length: n }, () => new Float64Array(n))
    const fu = new Float64Array(n)
    for (let j = 0; j < n; j++) {
      const xp = x.slice(); xp[j] += EPS
      const xm = x.slice(); xm[j] -= EPS
      const fp = f(xp, u), fm = f(xm, u)
      for (let i = 0; i < n; i++) fx[i][j] = (fp[i] - fm[i]) / (2 * EPS)
    }
    const fpu = f(x, u + EPS), fmu = f(x, u - EPS)
    for (let i = 0; i < n; i++) fu[i] = (fpu[i] - fmu[i]) / (2 * EPS)
    return { fx, fu }
  }

  let us = uInit.map(clamp)
  let xs = rollout(us)
  let J = totalCost(xs, us)
  let mu = 1e-6
  let converged = false

  const Ks = Array.from({ length: N }, () => new Float64Array(n))
  const ks = new Float64Array(N)

  for (let it = 0; it < iters; it++) {
    // ---- backward pass (with regularization retry) ----
    let ok = false
    while (!ok) {
      ok = true
      const term = terminal(xs[N])
      let Vx = term.lx.slice()
      let Vxx = term.lxxDiag.map((d, i) => { const r = new Float64Array(n); r[i] = Math.max(d, 0); return r })
      for (let t = N - 1; t >= 0; t--) {
        const { fx, fu } = jacobians(xs[t], us[t])
        const c = running(xs[t], us[t], t)
        // Qx = lx + fxᵀ Vx ; Qu = lu + fuᵀ Vx
        const Qx = new Float64Array(n)
        for (let i = 0; i < n; i++) { let s = c.lx[i]; for (let k = 0; k < n; k++) s += fx[k][i] * Vx[k]; Qx[i] = s }
        let Qu = c.lu
        for (let k = 0; k < n; k++) Qu += fu[k] * Vx[k]
        // VxxFx = Vxx · fx (n×n) ; VxxFu = Vxx · fu (n)
        const VxxFu = new Float64Array(n)
        for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < n; k++) s += Vxx[i][k] * fu[k]; VxxFu[i] = s }
        let Quu = c.luu + mu
        for (let k = 0; k < n; k++) Quu += fu[k] * VxxFu[k]
        if (Quu <= 1e-9) { mu = Math.max(mu * 10, 1e-6); ok = false; break }
        // Qux = fuᵀ Vxx fx (row n) ; Qxx = lxx + fxᵀ Vxx fx
        const Qux = new Float64Array(n)
        for (let j = 0; j < n; j++) { let s = 0; for (let k = 0; k < n; k++) s += VxxFu[k] * fx[k][j]; Qux[j] = s }
        const Qxx = Array.from({ length: n }, (_, i) => new Float64Array(n))
        for (let i = 0; i < n; i++) {
          const VxxFxi = new Float64Array(n)
          for (let jj = 0; jj < n; jj++) { let s = 0; for (let k = 0; k < n; k++) s += Vxx[i][k] * fx[k][jj]; VxxFxi[jj] = s }
          for (let jj = 0; jj < n; jj++) Qxx[i][jj] = VxxFxi[jj]
        }
        // fxᵀ · (Vxx fx): multiply from the left
        const QxxT = Array.from({ length: n }, (_, i) => new Float64Array(n))
        for (let i = 0; i < n; i++)
          for (let jj = 0; jj < n; jj++) { let s = 0; for (let k = 0; k < n; k++) s += fx[k][i] * Qxx[k][jj]; QxxT[i][jj] = s }
        for (let i = 0; i < n; i++) QxxT[i][i] += Math.max(c.lxxDiag[i], 0)

        const kt = -Qu / Quu
        const Kt = Ks[t]
        for (let j = 0; j < n; j++) Kt[j] = -Qux[j] / Quu
        ks[t] = kt
        // Vx = Qx + Kᵀ Quu k + Kᵀ Qu + Quxᵀ k
        for (let i = 0; i < n; i++) Vx[i] = Qx[i] + Kt[i] * Quu * kt + Kt[i] * Qu + Qux[i] * kt
        // Vxx = Qxx + Kᵀ Quu K + Kᵀ Qux + Quxᵀ K (symmetrized)
        for (let i = 0; i < n; i++)
          for (let jj = 0; jj < n; jj++)
            QxxT[i][jj] += Kt[i] * Quu * Kt[jj] + Kt[i] * Qux[jj] + Qux[i] * Kt[jj]
        for (let i = 0; i < n; i++)
          for (let jj = i + 1; jj < n; jj++) { const s = 0.5 * (QxxT[i][jj] + QxxT[jj][i]); QxxT[i][jj] = s; QxxT[jj][i] = s }
        Vxx = QxxT
      }
      if (!ok && mu > 1e10) return { xs, us, Ks: Ks.map(K => Array.from(K)), cost: J, converged: false }
    }

    // ---- forward pass with backtracking line search ----
    let accepted = false
    for (const alpha of [1, 0.6, 0.35, 0.2, 0.1, 0.05, 0.02]) {
      const usNew = new Array(N)
      const xsNew = [x0.slice()]
      for (let t = 0; t < N; t++) {
        let du = alpha * ks[t]
        const Kt = Ks[t], xt = xsNew[t], xbar = xs[t]
        for (let j = 0; j < n; j++) du += Kt[j] * (xt[j] - xbar[j])
        usNew[t] = clamp(us[t] + du)
        xsNew.push(f(xsNew[t], usNew[t]))
      }
      const Jnew = totalCost(xsNew, usNew)
      if (Number.isFinite(Jnew) && Jnew < J) {
        if (J - Jnew < tol * Math.abs(J)) converged = true
        xs = xsNew; us = usNew; J = Jnew
        mu = Math.max(mu * 0.5, 1e-8)
        accepted = true
        break
      }
    }
    if (!accepted) {
      mu *= 10
      if (mu > 1e10) break
    }
    if (verbose && it % verbose === 0) console.log(`  ilqr it ${it}: J=${J.toFixed(4)} mu=${mu.toExponential(1)}`)
    if (converged) break
  }

  return { xs, us, Ks: Ks.map(K => Array.from(K)), cost: J, converged }
}
