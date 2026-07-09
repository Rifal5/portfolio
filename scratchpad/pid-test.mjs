// Phase 3 checkpoint: (1) the refactored LQR (via switched.js) still swings up
// and settles; (2) the cascade PID balances from a tilt AND its outer loop
// recenters the cart from an offset start.

import * as single from '../src/projects/pendulum/plants/single.js'
import { makeController as makeLQR } from '../src/projects/pendulum/controllers/lqr.js'
import { makeController as makePID } from '../src/projects/pendulum/controllers/pid.js'
import { makeSingleSwingUp } from '../src/projects/pendulum/controllers/energy.js'

const dt = 1 / 240
const wrap = single.wrapPi

function simulate(ctrl, s0, T) {
  let s = s0
  for (let i = 0; i < T / dt; i++) s = single.step(s, ctrl.compute(s).force, dt)
  return s
}

let ok = true

// 1. Refactored LQR still self-rights from hanging.
const lqr = makeLQR(single, { swingUp: makeSingleSwingUp(single) })
const l = simulate(lqr, single.initialState(), 30)
const lUp = Math.abs(wrap(l.theta)) < 0.05 && Math.abs(l.thetadot) < 0.3
console.log(`LQR self-right: theta=${l.theta.toFixed(4)} x=${l.x.toFixed(3)} -> ${lUp ? 'ok' : 'FAIL'}`)
if (!lUp) ok = false

// 2a. Cascade PID balances from a tilt (start near upright, offset cart).
const pid = makePID(single)
const p = simulate(pid, { x: 0.8, xdot: 0, theta: 0.25, thetadot: 0 }, 12)
const pBal = Math.abs(wrap(p.theta)) < 0.03 && Math.abs(p.thetadot) < 0.2
const pCentered = Math.abs(p.x) < 0.1
console.log(`PID balance+recenter: theta=${p.theta.toFixed(4)} x=${p.x.toFixed(3)} -> balance ${pBal ? 'ok' : 'FAIL'}, centered ${pCentered ? 'ok' : 'FAIL'}`)
if (!pBal || !pCentered) ok = false

// 2b. PID with swing-up can also self-right (nice-to-have, not required to be fast).
const pid2 = makePID(single, { swingUp: makeSingleSwingUp(single) })
const p2 = simulate(pid2, single.initialState(), 40)
const p2Up = Math.abs(wrap(p2.theta)) < 0.05 && Math.abs(p2.thetadot) < 0.3
console.log(`PID self-right (with swing-up): theta=${p2.theta.toFixed(4)} x=${p2.x.toFixed(3)} -> ${p2Up ? 'ok' : 'FAIL'}`)
if (!p2Up) ok = false

console.log(ok ? '\nPASS: LQR refactor intact; cascade PID balances and recenters' : '\nFAIL: see above')
process.exit(ok ? 0 : 1)
