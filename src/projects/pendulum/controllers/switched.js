// Shared "swing-up then balance" scaffold. Both the LQR and PID controllers
// have the same outer structure — pump the pole into the target basin with a
// swing-up law, then hand off (with hysteresis, so the two modes don't chatter)
// to a local balance law — and differ only in that balance law. This module
// owns the structure; lqr.js / pid.js supply a `balance` object.
//
//   balance : { law(errVec, state, dt) -> force, reset() }
//   swingUp : (state) -> { force, mode }   (optional; omit for stabilize-only)
// errVec is the state minus the target equilibrium, angle dims wrapped to [-π,π].

const CONTROL_DT = 1 / 240

export function stateError(vec, eqVec, wrapSet) {
  return vec.map((v, i) => {
    let e = v - eqVec[i]
    if (wrapSet.includes(i)) {
      e = (e + Math.PI) % (Math.PI * 2)
      if (e < 0) e += Math.PI * 2
      e -= Math.PI
    }
    return e
  })
}

export function angleIndex(dims) { return dims.findIndex(d => d.startsWith('theta')) }

// Default enter/exit basin for a single upright pole (angle + rate about the eq).
const defEnter = (e, dims) => { const t = angleIndex(dims); return Math.abs(e[t]) < 0.4 && Math.abs(e[t + 1]) < 2.2 }
const defExit = (e, dims) => { const t = angleIndex(dims); return Math.abs(e[t]) > 0.6 || Math.abs(e[t + 1]) > 3.2 }

export function makeSwitched(plant, { targetEq = 0, balance, swingUp = null, enter = defEnter, exit = defExit, controlDt = CONTROL_DT }) {
  const eqVec = plant.meta.equilibria[targetEq].x
  const dims = plant.meta.dims
  const wrapSet = plant.meta.wrap || []
  let balancing = false

  function reset() { balancing = false; balance.reset() }

  function compute(x) {
    const e = stateError(plant.toVec(x), eqVec, wrapSet)
    if (!balancing && enter(e, dims)) balancing = true
    else if (balancing && exit(e, dims)) balancing = false

    let force, mode
    if (balancing || !swingUp) {
      force = balance.law(e, x, controlDt)
      mode = balancing || enter(e, dims) ? 'balance' : 'reach'
    } else {
      ;({ force, mode } = swingUp(x))
    }
    force = Math.max(-plant.PARAMS.forceMax, Math.min(plant.PARAMS.forceMax, force))
    return { force, mode }
  }

  return { compute, reset, get balancing() { return balancing } }
}
