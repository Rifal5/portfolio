// Maneuver supervisor for the double pendulum — the controller that actually
// TRANSITIONS between the four equilibria, using the two-degrees-of-freedom
// design from the literature (Graichen 2007, Glück 2013):
//
//   balance   in the target's basin, a static LQR holds it (hysteresis switch).
//   maneuver  a precomputed iLQR swing-up trajectory is tracked with its
//             time-varying LQR gains (feedforward + TVLQR). Trajectories start
//             from hanging at rest (maneuvers-double.js, verified offline).
//   descend   from anywhere else, pump energy DOWN toward hanging — the one
//             transition that's always easy.
//   settle    near hanging, the down-down LQR actively damps the last of the
//             swing until the state is inside the maneuver's verified launch
//             window, then the maneuver fires.
//
// So a target change becomes: current state → descend → settle at hanging →
// tracked swing-up → LQR catch. Chaining through hanging is what makes every
// transition reliable — direct inverted-to-inverted hops stay out of reach of
// classical control (see the reachability experiments in the Jira log).

import { lqrForEquilibrium } from '../../../lib/control/linearize.js'
import { makeDoubleSwingUp } from './energy.js'
import { MANEUVERS } from '../maneuvers-double.js'

const Q_WEIGHTS = [12, 500, 500, 1, 15, 15]
// R=0.02 gives gains too aggressive to survive the realistic actuator's 20 ms
// lag (loses phase margin and slowly flips at the inverted equilibria); R=0.1
// holds all four equilibria for 60 s+ under lag + sensor noise (measured sweep:
// stable for every R ≥ 0.05).
const BALANCE_R = 0.1
const DOWN = 3 // equilibrium index of down-down (hanging)

const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

export function makeController(plant, opts = {}) {
  const { targetEq = 0, controlDt = 1 / 240 } = opts
  // Known actuator lag to compensate in the feedforward (realistic mode): a
  // first-order motor lag τ systematically delays the commanded force, which is
  // enough to miss the narrow catch window. Lead compensation u_cmd = u + τ·u̇
  // inverts it to O(τ²) — real rigs feed forward through their actuator model.
  let actuatorTau = opts.actuatorTau || 0
  const p = plant.PARAMS, fMax = p.forceMax
  const Q = Q_WEIGHTS.map((w, i, A) => A.map((_, j) => (i === j ? w : 0)))
  const eqT = plant.meta.equilibria[targetEq].x
  const eqD = plant.meta.equilibria[DOWN].x
  const Ktarget = lqrForEquilibrium(plant, targetEq, Q, BALANCE_R, controlDt).K
  const Kdown = targetEq === DOWN ? Ktarget : lqrForEquilibrium(plant, DOWN, Q, BALANCE_R, controlDt).K
  const traj = targetEq === DOWN ? null : MANEUVERS[`${DOWN}>${targetEq}`]
  const pumpDown = makeDoubleSwingUp(plant, DOWN)

  const errTo = (s, eq) => [s.x - eq[0], wrap(s.theta1 - eq[1]), wrap(s.theta2 - eq[2]), s.xdot, s.theta1dot, s.theta2dot]
  const inBasin = e => Math.abs(e[1]) < 0.35 && Math.abs(e[2]) < 0.35 && Math.abs(e[4]) < 2.5 && Math.abs(e[5]) < 2.5
  const outOfBasin = e => Math.abs(e[1]) > 0.6 || Math.abs(e[2]) > 0.6 || Math.abs(e[4]) > 4.5 || Math.abs(e[5]) > 4.5
  // Launch window = the perturbation envelope the trajectories were verified for.
  const readyToLaunch = e => Math.abs(e[0]) < 0.07 && Math.abs(e[1]) < 0.06 && Math.abs(e[2]) < 0.06
    && Math.abs(e[3]) < 0.07 && Math.abs(e[4]) < 0.07 && Math.abs(e[5]) < 0.07

  let phase = 'descend'   // descend | settle | maneuver | balance
  let tM = 0              // maneuver clock (s)

  const lqrForce = (e, K) => Math.max(-fMax, Math.min(fMax, -K.reduce((a, k, j) => a + k * e[j], 0)))

  function trackForce(s) {
    const N = traj.us.length
    const tau = Math.min(tM / traj.dt, N - 1e-9)
    const i0 = Math.floor(tau), fr = tau - i0
    const xb = traj.xs[i0].map((v, j) => v + fr * (traj.xs[i0 + 1][j] - v))
    const K = traj.Ks[i0]
    const sv = [s.x, s.theta1, s.theta2, s.xdot, s.theta1dot, s.theta2dot]
    let u = traj.us[i0]
    if (actuatorTau > 0) {
      const uNext = traj.us[Math.min(i0 + 1, N - 1)]
      u += actuatorTau * (uNext - traj.us[i0]) / traj.dt // lead compensation
    }
    for (let j = 0; j < 6; j++) {
      let e = sv[j] - xb[j]
      if (j === 1 || j === 2) e = wrap(e)
      u += K[j] * e
    }
    return Math.max(-fMax, Math.min(fMax, u))
  }

  function compute(s) {
    const eT = errTo(s, eqT)
    // Basin capture always wins (with hysteresis while balancing).
    if (phase === 'balance') {
      if (outOfBasin(eT)) phase = 'descend'
      else return { force: lqrForce(eT, Ktarget), mode: 'balance' }
    }
    if (phase !== 'balance' && phase !== 'maneuver' && inBasin(eT)) {
      phase = 'balance'
      return { force: lqrForce(eT, Ktarget), mode: 'balance' }
    }

    if (targetEq === DOWN) {
      // Hanging is reachable from anywhere: pump down, then the basin check
      // above hands off to the down-down LQR.
      return { force: Math.max(-fMax, Math.min(fMax, pumpDown(s).force)), mode: 'descend' }
    }

    const eD = errTo(s, eqD)
    if (phase === 'maneuver') {
      tM += controlDt
      if (tM >= traj.us.length * traj.dt) {
        phase = inBasin(eT) ? 'balance' : 'descend' // missed the catch → retry via hanging
        return compute(s)
      }
      return { force: trackForce(s), mode: 'maneuver' }
    }
    if (phase === 'settle') {
      if (readyToLaunch(eD)) { phase = 'maneuver'; tM = 0; return { force: trackForce(s), mode: 'maneuver' } }
      if (outOfBasin(eD)) { phase = 'descend' }
      else return { force: lqrForce(eD, Kdown), mode: 'settle' }
    }
    // descend: pump energy out until we're near hanging, then settle there.
    if (inBasin(eD)) { phase = 'settle'; return { force: lqrForce(eD, Kdown), mode: 'settle' } }
    return { force: Math.max(-fMax, Math.min(fMax, pumpDown(s).force)), mode: 'descend' }
  }

  return {
    compute,
    reset() { phase = 'descend'; tM = 0 },
    setActuatorTau(t) { actuatorTau = t || 0 },
    // Fast phases must run on the true state (feedforward convention — an EKF's
    // velocity lag breaks phase-critical tracking, and flip-flopping the state
    // source mid-trajectory injects error jumps); regulation phases use the
    // estimate. The sim reads this to pick what compute() sees.
    get wantsTrueState() { return phase === 'maneuver' || phase === 'descend' },
    get balancing() { return phase === 'balance' },
    get info() {
      return { type: 'lqr', dims: plant.meta.dims, K: Ktarget, weights: Q_WEIGHTS, R: BALANCE_R, eq: plant.meta.equilibria[targetEq].label, phase }
    },
  }
}
