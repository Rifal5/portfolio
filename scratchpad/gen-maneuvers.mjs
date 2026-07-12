// Generate the double pendulum's FULL transition-maneuver graph — every ordered
// pair of equilibria, solved DIRECTLY (no routing through hanging) via iLQR on
// an augmented state z = [x, th1, th2, xd, th1d, th2d, u], where the control is
// the force INCREMENT per knot: uMax then IS the actuator slew limit (hard),
// and the force magnitude is clamped inside the step. Each candidate is
// verified on the REAL plant through the REAL actuator model (slew + lag +
// deadband, with runtime lead compensation), in both ideal and realistic loops,
// from perturbed starts around the SOURCE equilibrium (the balance-jitter
// envelope). Verified trajectories + TVLQR gains are saved to
// src/projects/pendulum/maneuvers-double.js; pairs that fail to verify are
// simply omitted (the runtime supervisor falls back to routing via hanging).

import * as dbl from '../src/projects/pendulum/plants/double.js'
import { ilqr } from '../src/lib/control/ilqr.js'
import { rk4 } from '../src/lib/control/integrate.js'
import { lqrForEquilibrium } from '../src/lib/control/linearize.js'
import { makeActuator } from '../src/lib/control/actuator.js'
import fs from 'fs'

const P = dbl.PARAMS
const fMax = P.forceMax
const DT = 1 / 100
const T = 4.0, N = Math.round(T / DT)
const SUB = 1 / 240
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

// Actuator model (must match sim.js REALISM): slew 40×fMax/s, lag 20 ms.
const SLEW = 40 * fMax           // N/s available at runtime
const FF_SLEW = 0.75 * SLEW      // feedforward budget — headroom left for TVLQR feedback
const TAU = 0.02

// ---- augmented problem: z = [plant(6), u], control w = Δu per knot ----
const nz = 7
const stepFn = (z, w) => {
  const u = Math.max(-fMax, Math.min(fMax, z[6] + w))
  const xn = rk4(dbl.derivative, z.slice(0, 6), u, DT, P)
  return [...xn, u]
}
// Unwrapped angle of an equilibrium description (0 = up, π = down).
const eqAngles = eq => [dbl.meta.equilibria[eq].x[1] === 0 ? 0 : Math.PI, dbl.meta.equilibria[eq].x[2] === 0 ? 0 : Math.PI]
const z0For = src => { const [a1, a2] = eqAngles(src); return [0, a1, a2, 0, 0, 0, 0] }

const W = { ang: 900, rate: 120, x: 60, xd: 60, uEnd: 0.5 }
const R = { u: 8e-4, dw: 1e-3, shape: 1.5, x: 0.5, wall: 4000 }
const WALL_AT = 1.7

function makeCosts(th1T, th2T) {
  const terminal = z => {
    const e1 = z[1] - th1T, e2 = z[2] - th2T
    return {
      l: W.ang * ((1 - Math.cos(e1)) + (1 - Math.cos(e2))) + 0.5 * (W.x * z[0] ** 2 + W.xd * z[3] ** 2 + W.rate * (z[4] ** 2 + z[5] ** 2) + W.uEnd * z[6] ** 2),
      lx: [W.x * z[0], W.ang * Math.sin(e1), W.ang * Math.sin(e2), W.xd * z[3], W.rate * z[4], W.rate * z[5], W.uEnd * z[6]],
      lxxDiag: [W.x, Math.max(W.ang * Math.cos(e1), 1), Math.max(W.ang * Math.cos(e2), 1), W.xd, W.rate, W.rate, W.uEnd],
    }
  }
  const running = (z, w) => {
    const e1 = z[1] - th1T, e2 = z[2] - th2T
    const over = Math.max(0, Math.abs(z[0]) - WALL_AT)
    return {
      l: (R.u * z[6] ** 2 + R.shape * ((1 - Math.cos(e1)) + (1 - Math.cos(e2))) + 0.5 * R.x * z[0] ** 2 + R.wall * over * over) * DT + R.dw * w * w,
      lx: [(R.x * z[0] + 2 * R.wall * over * Math.sign(z[0])) * DT, R.shape * Math.sin(e1) * DT, R.shape * Math.sin(e2) * DT, 0, 0, 0, 2 * R.u * z[6] * DT],
      lxxDiag: [(R.x + (over > 0 ? 2 * R.wall : 0)) * DT, Math.max(R.shape * Math.cos(e1), 0.01) * DT, Math.max(R.shape * Math.cos(e2), 0.01) * DT, 0.01 * DT, 0.01 * DT, 0.01 * DT, 2 * R.u * DT],
      lu: 2 * R.dw * w, luu: 2 * R.dw,
    }
  }
  return { terminal, running }
}

const Qw = [12, 500, 500, 1, 15, 15].map((w, i, A) => A.map((_, j) => (i === j ? w : 0)))

// Rebuild the plain-state trajectory (xs 6-dim, us) from an augmented solution,
// then synthesize PROPER 6-state TVLQR tracking gains along it (a backward
// Riccati pass on the force-input system). NB: the augmented solve's own gains
// map state error -> force INCREMENT — they are not force-feedback gains, so
// they cannot be stored for the runtime tracker.
function extract(sol) {
  const xs = sol.xs.map(z => z.slice(0, 6))
  const us = []
  for (let t = 0; t < N; t++) us.push(sol.xs[t + 1][6]) // force actually applied on step t
  return { xs, us, Ks: tvlqrGains(xs, us) }
}

// Time-varying LQR synthesis about (xs, us): discrete Riccati backward pass on
// the 6-state force-input dynamics, weights mirroring the (verified-working)
// unconstrained library's effective cost.
function tvlqrGains(xs, us) {
  const n6 = 6, EPS = 1e-5
  const stepF = (x, u) => rk4(dbl.derivative, x, u, DT, P)
  const Qt = [0.5, 1.5, 1.5, 0.01, 0.01, 0.01].map(v => v * DT)
  const Rt = 2 * R.u * DT
  let Pm = [ [W.x,0,0,0,0,0],[0,W.ang,0,0,0,0],[0,0,W.ang,0,0,0],[0,0,0,W.xd,0,0],[0,0,0,0,W.rate,0],[0,0,0,0,0,W.rate] ]
  const Ks = new Array(N)
  for (let t = N - 1; t >= 0; t--) {
    // finite-difference fx (6×6), fu (6) about the knot
    const fx = [], fu = new Float64Array(n6)
    for (let j = 0; j < n6; j++) {
      const xp = xs[t].slice(); xp[j] += EPS
      const xm = xs[t].slice(); xm[j] -= EPS
      const fp = stepF(xp, us[t]), fm = stepF(xm, us[t])
      fx.push(fp.map((v, i) => (v - fm[i]) / (2 * EPS))) // row j holds dcol? — build transposed then fix below
    }
    // fx built as fxT[j][i] = df_i/dx_j; transpose to fxM[i][j]
    const fxM = Array.from({ length: n6 }, (_, i) => fx.map(col => col[i]))
    const fpu = stepF(xs[t], us[t] + EPS), fmu = stepF(xs[t], us[t] - EPS)
    for (let i = 0; i < n6; i++) fu[i] = (fpu[i] - fmu[i]) / (2 * EPS)
    // Pfu (6), fuPfu (scalar), fuPfx (1×6)
    const Pfu = new Float64Array(n6)
    for (let i = 0; i < n6; i++) { let s = 0; for (let k = 0; k < n6; k++) s += Pm[i][k] * fu[k]; Pfu[i] = s }
    let fuPfu = 0
    for (let k = 0; k < n6; k++) fuPfu += fu[k] * Pfu[k]
    const denom = Rt + fuPfu
    const fuPfx = new Float64Array(n6)
    for (let j = 0; j < n6; j++) { let s = 0; for (let k = 0; k < n6; k++) s += Pfu[k] * fxM[k][j]; fuPfx[j] = s }
    const K = Array.from(fuPfx, v => -v / denom) // u = ū + K·(x − x̄)
    Ks[t] = K
    // P = Q + fxᵀ P fx − fxᵀ P fu · (−K)  (Joseph-lite; symmetrized)
    const PfxM = Array.from({ length: n6 }, (_, i) => {
      const row = new Float64Array(n6)
      for (let j = 0; j < n6; j++) { let s = 0; for (let k = 0; k < n6; k++) s += Pm[i][k] * fxM[k][j]; row[j] = s }
      return row
    })
    const Pn = Array.from({ length: n6 }, (_, i) => new Float64Array(n6))
    for (let i = 0; i < n6; i++)
      for (let j = 0; j < n6; j++) {
        let s = 0
        for (let k = 0; k < n6; k++) s += fxM[k][i] * PfxM[k][j] // fxᵀ P fx
        Pn[i][j] = s + (i === j ? Qt[i] : 0) + fuPfx[i] * K[j]   // − fxᵀPfu·(−K) = +fuPfx·K... sign: see below
      }
    // standard form: P = Q + fxᵀPfx − (fxᵀPfu)(R+fuᵀPfu)⁻¹(fuᵀPfx); note fxᵀPfu = fuPfxᵀ
    // Pn currently has +fuPfx[i]*K[j] = −fuPfx[i]·fuPfx[j]/denom — which is exactly the subtraction. ✓
    for (let i = 0; i < n6; i++)
      for (let j = i + 1; j < n6; j++) { const s = 0.5 * (Pn[i][j] + Pn[j][i]); Pn[i][j] = s; Pn[j][i] = s }
    Pm = Pn
  }
  return Ks
}

// Verify tracking + catch on the real plant. mode 'ideal' = perfect actuator;
// mode 'real' = through makeActuator(slew+lag+deadband) with lead compensation.
// Perturbed starts are around the SOURCE equilibrium (balance-jitter envelope).
function verify(traj, srcEq, targetEq, mode) {
  const Klqr = lqrForEquilibrium(dbl, targetEq, Qw, 0.1, SUB).K
  const eq = dbl.meta.equilibria[targetEq].x
  const [a1, a2] = eqAngles(srcEq)
  const starts = [
    { x: 0, theta1: a1, theta2: a2, xdot: 0, theta1dot: 0, theta2dot: 0 },
    { x: 0.05, theta1: a1 + 0.05, theta2: a2 - 0.04, xdot: 0, theta1dot: 0.05, theta2dot: -0.05 },
    { x: -0.06, theta1: a1 - 0.06, theta2: a2 + 0.05, xdot: 0.05, theta1dot: -0.06, theta2dot: 0.04 },
  ]
  for (const start of starts) {
    let s = { ...start }
    const act = makeActuator({ forceMax: fMax, slewMax: SLEW, tau: TAU, deadband: 0.05 })
    const apply = (cmd) => (mode === 'real' ? act.apply(cmd, SUB) : cmd)
    const Nn = traj.us.length
    for (let i = 0; i * SUB < Nn * DT; i++) {
      const tau_ = (i * SUB) / DT
      const i0 = Math.min(Math.floor(tau_), Nn - 1), fr = Math.min(tau_ - i0, 1)
      const xb = traj.xs[i0].map((v, j) => v + fr * (traj.xs[i0 + 1][j] - v))
      const K = traj.Ks[i0]
      const sv = [s.x, s.theta1, s.theta2, s.xdot, s.theta1dot, s.theta2dot]
      let u = traj.us[i0]
      if (mode === 'real') u += TAU * (traj.us[Math.min(i0 + 1, Nn - 1)] - traj.us[i0]) / DT // lead comp
      for (let j = 0; j < 6; j++) { let e = sv[j] - xb[j]; if (j === 1 || j === 2) e = wrap(e); u += K[j] * e }
      s = dbl.step(s, apply(Math.max(-fMax, Math.min(fMax, u))), SUB)
    }
    for (let i = 0; i < Math.round(5 / SUB); i++) {
      const err = [s.x, wrap(s.theta1 - eq[1]), wrap(s.theta2 - eq[2]), s.xdot, s.theta1dot, s.theta2dot]
      s = dbl.step(s, apply(Math.max(-fMax, Math.min(fMax, -Klqr.reduce((a, k, j) => a + k * err[j], 0)))), SUB)
    }
    if (!(Math.abs(wrap(s.theta1 - eq[1])) < 0.1 && Math.abs(wrap(s.theta2 - eq[2])) < 0.1 && Math.abs(s.x) < P.trackHalfWidth)) return false
  }
  return true
}

// Warm starts: increments from the previous library if present, plus decaying
// sinusoids at several frequencies/amplitudes (symmetry breakers).
function initsFor(srcEq, targetEq) {
  const inits = []
  try {
    // eslint-disable-next-line
    const prev = JSON.parse(fs.readFileSync('src/projects/pendulum/maneuvers-double.js', 'utf8').replace(/^[\s\S]*?export const MANEUVERS = /, '').trim())
    const m = prev[`${srcEq}>${targetEq}`]
    if (m) {
      const ws = []
      let uPrev = 0
      for (let t = 0; t < N; t++) {
        const u = m.us[Math.min(t, m.us.length - 1)]
        ws.push(Math.max(-FF_SLEW * DT, Math.min(FF_SLEW * DT, u - uPrev)))
        uPrev = Math.max(-fMax, Math.min(fMax, uPrev + ws[t]))
      }
      inits.push({ name: 'warm (prev lib)', ws })
    }
  } catch { /* no previous library */ }
  for (const hz of [0.5, 0.9, 0.7]) for (const A of [8, 16, 4]) {
    // sinusoid FORCE profile expressed as increments
    const ws = []; let uPrev = 0
    for (let t = 0; t < N; t++) {
      const u = A * Math.sin(2 * Math.PI * hz * t * DT) * Math.exp(-t * DT / 2.5)
      ws.push(Math.max(-FF_SLEW * DT, Math.min(FF_SLEW * DT, u - uPrev)))
      uPrev += ws[t]
    }
    inits.push({ name: `sin ${hz}Hz A${A}`, ws })
  }
  return inits
}

const OUT = {}
const failed = []
const PAIRS = []
for (let s = 0; s < 4; s++) for (let d = 0; d < 4; d++) if (s !== d) PAIRS.push([s, d])
for (const [srcEq, targetEq] of PAIRS) {
  console.log(`\n=== ${dbl.meta.equilibria[srcEq].label} -> ${dbl.meta.equilibria[targetEq].label} (${srcEq}>${targetEq}) ===`)
  const eq = dbl.meta.equilibria[targetEq].x
  const z0 = z0For(srcEq)
  const { terminal, running } = makeCosts(...eqAngles(targetEq))
  let bestClean = null, bestTraj = null
  for (const init of initsFor(srcEq, targetEq)) {
    const t0 = Date.now()
    // Constraint homotopy: hard clamping hurts iLQR convergence, so solve with a
    // loose slew limit first, then re-solve warm-started at the true limit, then
    // polish. (The clamp makes uMax an EXACT limit at each stage.)
    let sol = ilqr({ p: P, n: nz, dt: DT, N, x0: z0, uInit: init.ws, uMax: 3 * FF_SLEW * DT, running, terminal, iters: 600, stepFn })
    sol = ilqr({ p: P, n: nz, dt: DT, N, x0: z0, uInit: sol.us, uMax: FF_SLEW * DT, running, terminal, iters: 800, stepFn })
    sol = ilqr({ p: P, n: nz, dt: DT, N, x0: z0, uInit: sol.us, uMax: FF_SLEW * DT, running, terminal, iters: 1500, stepFn })
    const traj = extract(sol)
    const maxX = Math.max(...traj.xs.map(x => Math.abs(x[0])))
    let maxDu = 0
    for (let i = 1; i < traj.us.length; i++) maxDu = Math.max(maxDu, Math.abs(traj.us[i] - traj.us[i - 1]) / DT)
    const xf = traj.xs[N]
    const e1 = wrap(xf[1] - eq[1]), e2 = wrap(xf[2] - eq[2])
    const near = Math.abs(e1) < 0.12 && Math.abs(e2) < 0.12 && maxX < 2.2
    let ideal = false, real = false
    if (near) { ideal = verify(traj, srcEq, targetEq, 'ideal'); real = ideal && verify(traj, srcEq, targetEq, 'real') }
    console.log(`  ${init.name.padEnd(15)} cost=${sol.cost.toFixed(2).padStart(9)} thF=[${e1.toFixed(2)}, ${e2.toFixed(2)}] rates=[${xf[4].toFixed(1)}, ${xf[5].toFixed(1)}] maxX=${maxX.toFixed(2)} maxDu=${maxDu.toFixed(0)} ideal=${ideal} real=${real} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
    if (ideal && real && (!bestClean || sol.cost < bestClean.cost)) { bestClean = sol; bestTraj = traj }
    if (bestClean) break // first verified solution is good enough
  }
  if (!bestTraj) { failed.push(`${srcEq}>${targetEq}`); console.log('  NOT VERIFIED — omitted (runtime falls back to routing via hanging)'); continue }
  console.log(`  SOLVED cost=${bestClean.cost.toFixed(2)}`)
  OUT[`${srcEq}>${targetEq}`] = {
    dt: DT,
    xs: bestTraj.xs.map(x => x.map(v => +v.toFixed(3))),
    us: bestTraj.us.map(u => +u.toFixed(2)),
    Ks: bestTraj.Ks.map(K => K.map(v => +v.toFixed(2))),
  }
}

// The three from-hanging swing-ups are load-bearing (the universal fallback
// route); everything else is an optimization.
const allOk = ['3>0', '3>1', '3>2'].every(k => OUT[k])
console.log(`\nverified pairs: ${Object.keys(OUT).join(', ')}${failed.length ? '  |  failed: ' + failed.join(', ') : ''}`)
if (allOk) {
  const body = `// Auto-generated by scratchpad/gen-maneuvers.mjs — the double pendulum's
// verified transition-maneuver GRAPH: direct iLQR feedforward trajectories +
// time-varying LQR gains (Graichen/Glück-style 2-DOF design) between
// equilibria, optimized with the actuator's slew limit as a HARD constraint
// and verified through the full actuator model (slew + lag + deadband, with
// lead compensation) as well as an ideal loop, from perturbed starts around
// the source. Keyed 'srcEq>dstEq' (0=up-up 1=up-down 2=down-up 3=down-down);
// each starts at the source equilibrium AT REST — the supervisor launches them
// straight out of a balanced hold. Pairs that failed verification are absent
// (the supervisor routes those via hanging).
// Entry: { dt, xs[N+1][6], us[N], Ks[N][6] }, state [x, th1, th2, xd, th1d, th2d].
export const MANEUVERS = ${JSON.stringify(OUT)}
`
  fs.writeFileSync('src/projects/pendulum/maneuvers-double.js', body)
  console.log(`SAVED maneuvers-double.js (${(body.length / 1024).toFixed(0)} KB, ${Object.keys(OUT).length}/12 pairs)`)
} else {
  console.log('NOT saved — a load-bearing from-hanging swing-up failed')
  process.exit(1)
}
