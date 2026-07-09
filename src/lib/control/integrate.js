// Numerical integration + control-loop timing primitives, shared by every
// simulation in the portfolio (pendulum plants, robot-arm motion layer).
//
// Three pieces:
//   rk4                  — 4th-order Runge-Kutta step of an ODE with a held input.
//   makeAccumulator      — fixed-timestep accumulator so physics is frame-rate
//                          independent (the classic "fix your timestep" loop).
//   makeSampledController — runs a control law at a realistic, SLOWER rate than
//                          the physics substep, holding its output between
//                          samples (zero-order hold). Real controllers are
//                          sampled; decoupling the control rate from the
//                          integrator is most of what makes motion look real.

// One RK4 step. `deriv(state, u, p) -> dstate` where state/dstate are number
// arrays and u is the (held-constant over the step) control input. Pure.
export function rk4(deriv, state, u, dt, p) {
  const add = (a, b, s) => a.map((v, i) => v + b[i] * s)
  const k1 = deriv(state, u, p)
  const k2 = deriv(add(state, k1, dt / 2), u, p)
  const k3 = deriv(add(state, k2, dt / 2), u, p)
  const k4 = deriv(add(state, k3, dt), u, p)
  return state.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
}

// Fixed-substep accumulator. Feed it the wall-clock dt each frame; it calls
// `onSub(substep)` a whole number of times and carries the remainder to the
// next frame, so the physics always advances in identical fixed steps
// regardless of render frame rate. Clamps the per-frame dt to avoid a spiral of
// death after a tab stall.
export function makeAccumulator(substep, maxFrame = 0.05) {
  let acc = 0
  return {
    advance(dt, onSub) {
      acc += Math.min(dt, maxFrame)
      let n = 0
      while (acc >= substep) { onSub(substep); acc -= substep; n++ }
      return n
    },
    reset() { acc = 0 },
  }
}

// Zero-order-hold sampled controller. `law(x) -> { force, mode }` is only
// re-evaluated every `controlDt` seconds of simulated time; between samples the
// last commanded force is held. Advance simulated time with `tick(dt)` from
// inside the physics substep loop so the control rate is exact.
export function makeSampledController(law, controlDt) {
  let held = { force: 0, mode: 'init' }
  let sinceSample = Infinity // force a sample on the first tick
  return {
    tick(dt) { sinceSample += dt },
    compute(x) {
      if (sinceSample >= controlDt) { held = law(x); sinceSample = 0 }
      return held
    },
    reset() { held = { force: 0, mode: 'init' }; sinceSample = Infinity },
    get lastMode() { return held.mode },
  }
}
