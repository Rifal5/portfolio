// Checkpoint for the TAS (tool-assisted) controller:
//   1. playback is DETERMINISTIC and open-loop — identical script + start gives
//      an identical trajectory, and the applied force matches the script;
//   2. a scripted swing-up + auto-catch actually balances the SINGLE pole (also
//      finds a working seed script for the UI default);
//   3. engageBalance() from near an equilibrium holds it (single + double).
import * as single from '../src/projects/pendulum/plants/single.js'
import * as dbl from '../src/projects/pendulum/plants/double.js'
import { makeController } from '../src/projects/pendulum/controllers/tas.js'

const SUB = 1 / 240
const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

function rollout(plant, script, { autoCatch = false, engageAt = null, start = null, T = 8 } = {}) {
  const ctrl = makeController(plant, { controlDt: SUB })
  ctrl.setScript(script); ctrl.setAutoCatch(autoCatch); ctrl.play()
  let s = start || plant.initialState()
  const forces = []
  const N = Math.round(T / SUB)
  for (let i = 0; i < N; i++) {
    if (engageAt != null && i === engageAt) ctrl.engageBalance(s)
    const r = ctrl.compute(s); forces.push(r.force)
    s = plant.step(s, r.force, SUB)
  }
  return { s, forces, ctrl }
}

let ok = true

// 1) determinism + open-loop fidelity
{
  const script = [{ force: 8, dur: 0.3 }, { force: -8, dur: 0.3 }, { force: 5, dur: 0.2 }]
  const a = rollout(single, script, { T: 1 })
  const b = rollout(single, script, { T: 1 })
  const identical = a.forces.every((f, i) => f === b.forces[i])
  // at t=0.1s (frame 24) the active segment is #0 = +8 N
  const holdsScript = Math.abs(a.forces[24] - 8) < 1e-9 && Math.abs(a.forces[Math.round(0.45 / SUB)] + 8) < 1e-9
  console.log(`1) deterministic=${identical}  open-loop force matches script=${holdsScript}`)
  if (!identical || !holdsScript) ok = false
}

// 2) search a square-wave pump that swings the SINGLE up, then auto-catches.
// Sweep half-period (resonance), pulse count, amplitude, and an initial "wind"
// delay before the first pulse. Track closest upright approach for diagnostics.
let bestSeed = null, closest = 9
{
  const fMax = single.PARAMS.forceMax
  outer:
  for (const half of [0.26, 0.30, 0.34, 0.38, 0.42, 0.46, 0.50, 0.55, 0.62, 0.70]) {
    for (const n of [3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const amp of [fMax, fMax * 0.9, fMax * 0.75]) {
        const script = Array.from({ length: n }, (_, k) => ({ force: (k % 2 ? -1 : 1) * amp, dur: half }))
        // track closest approach across the run
        const ctrl = makeController(single, { controlDt: SUB }); ctrl.setScript(script); ctrl.setAutoCatch(true); ctrl.play()
        let s = single.initialState(); let near = 9
        for (let i = 0; i < Math.round(10 / SUB); i++) {
          const r = ctrl.compute(s); s = single.step(s, r.force, SUB)
          near = Math.min(near, Math.abs(wrap(s.theta)))
        }
        closest = Math.min(closest, near)
        if (ctrl.balancing && Math.abs(wrap(s.theta)) < 0.08 && Math.abs(s.thetadot) < 0.5 && Math.abs(s.x) < single.PARAMS.trackHalfWidth) {
          bestSeed = { half, n, amp: +amp.toFixed(2), script }; break outer
        }
      }
    }
  }
  if (bestSeed) console.log(`2) scripted swing-up + auto-catch balances single: half=${bestSeed.half}s n=${bestSeed.n} amp=${bestSeed.amp}N`)
  else { console.log(`2) FAILED to find a swing-up seed script (closest upright approach: ${(closest * 180 / Math.PI).toFixed(0)}°)`); ok = false }
}

// 3) engageBalance from near each equilibrium holds it (single upright + all 4 double)
{
  const nearUp = { ...single.initialState(), theta: 0.12, thetadot: 0.0 }
  const { s, ctrl } = rollout(single, [], { engageAt: 0, start: nearUp, T: 5 })
  const held = ctrl.balancing && Math.abs(wrap(s.theta)) < 0.05
  console.log(`3) single: engage near upright -> held=${held}`)
  if (!held) ok = false
  for (let eq = 0; eq < 4; eq++) {
    const e = dbl.meta.equilibria[eq].x
    const start = dbl.fromVec(e.map((v, i) => v + (i === 1 || i === 2 ? 0.1 : 0)))
    const { s: sd, ctrl: cd } = rollout(dbl, [], { engageAt: 0, start, T: 5 })
    const held = cd.balancing && Math.abs(wrap(sd.theta1 - e[1])) < 0.06 && Math.abs(wrap(sd.theta2 - e[2])) < 0.06
    console.log(`   double: engage near ${dbl.meta.equilibria[eq].label.padEnd(22)} -> held=${held} (caught: ${cd.info.caughtLabel})`)
    if (!held) ok = false
  }
}

// 4) the catch probe is TRUTHFUL across the genuinely non-monotonic down-up
// basin: probe verdict must equal what the LQR actually does, at every rate —
// including the 1.5 rad/s dip that the old angle/rate threshold got wrong.
{
  const mk = () => makeController(dbl, { controlDt: SUB })
  const stateAt = w2 => ({ x: 0, xdot: 0, theta1: Math.PI, theta2: 0.12, theta1dot: 0, theta2dot: w2 })
  const probeGreen = st => { const c = mk(); c.play(st); c.compute(st); return c.probe().catchable }
  // ground truth: engage and run the real loop; a CLEAN catch settles within 3 s
  // without a big swing-out or hitting the wall (a 6 s near-wall thrash is NOT a
  // clean catch — that's the 'goes all over the place' the user reported).
  function cleanHold(st) {
    const c = mk(); c.engageBalance(st); let s = st, peak = 0
    for (let i = 0; i < Math.round(3 / SUB); i++) {
      const r = c.compute(s); s = dbl.step(s, r.force, SUB)
      peak = Math.max(peak, Math.abs(wrap(s.theta2)), Math.abs(wrap(s.theta1 - Math.PI)))
      if (Math.abs(s.x) > 2.3) return false
    }
    return Math.abs(wrap(s.theta2)) < 0.06 && Math.abs(wrap(s.theta1 - Math.PI)) < 0.06 && peak < 0.9
  }
  let allMatch = true
  const t0 = Date.now(); let probes = 0
  for (const w2 of [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]) {
    const st = stateAt(w2), g = probeGreen(st), h = cleanHold(st); probes++
    const match = g === h
    if (!match) allMatch = false
    console.log(`   w2=${w2}: probe=${g ? 'GREEN' : 'red  '} clean-catch=${h ? 'yes ' : 'no  '} ${match ? '✓' : '✗ MISMATCH'}`)
  }
  console.log(`4) probe matches clean-catch reality: ${allMatch ? 'YES' : 'NO'}  [old threshold said GREEN for all — the bug]  ~${((Date.now() - t0) / probes / 2).toFixed(1)}ms/probe`)
  if (!allMatch) ok = false
}

if (bestSeed) console.log('\nSEED SCRIPT (single):', JSON.stringify(bestSeed.script))
console.log(ok ? '\nPASS: TAS playback deterministic, scripted swing-up catches, engage holds, catch probe is truthful' : '\nFAIL')
process.exit(ok ? 0 : 1)
