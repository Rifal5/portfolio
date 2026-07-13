// Tool-assisted (TAS) mode — the deterministic cousin of manual drive. The user
// scripts a timeline of open-loop cart-force segments and plays it back to hunt
// for their OWN swing-up, then hands off to a static LQR "catch" at the nearest
// equilibrium when the pole is close enough.
//
// During playback there is NO feedback: the motor force is exactly what the
// script says at each instant (zero-order hold between segments), so the same
// script from the same start always produces the same motion — like a
// tool-assisted speedrun. That's the whole point: you author the trajectory.
//
// The catch is honest. A static LQR can only hold the pole if you've brought it
// near an equilibrium at low angular speed (a state is angles AND velocities),
// so the controller exposes a live "catchable?" readout of the nearest
// equilibrium and — if you miss — the normal safety cutoff trips, telling you
// you weren't close enough. An optional auto-catch grabs the moment it's able.

import { lqrForEquilibrium } from '../../../lib/control/linearize.js'

// Reuse the tuned balance weights/R from the LQR + maneuver controllers so the
// catch behaves exactly like the automatic balancers do.
const WEIGHTS = { single: [2, 1, 40, 4], double: [12, 500, 500, 1, 15, 15] }
const R_BY_PLANT = { single: 0.02, double: 0.1 }

// Catch basin used for the "catchable?" indicator and auto-catch: angles within
// ~20° of an equilibrium and the LINKS turning slowly (cart speed is fine — LQR
// handles it). These mirror the maneuver supervisor's launch/basin envelope.
const CATCH_ANGLE = 0.35
const CATCH_RATE = 3.0

const wrap = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI }

export function makeController(plant, opts = {}) {
  const { controlDt = 1 / 240 } = opts
  const fMax = plant.PARAMS.forceMax
  const dims = plant.meta.dims
  const isAngle = d => d.startsWith('theta') && !d.endsWith('dot')
  const isAngleRate = d => d.startsWith('theta') && d.endsWith('dot')
  const angleIdx = dims.map((d, i) => (isAngle(d) ? i : -1)).filter(i => i >= 0)
  const angleRateIdx = dims.map((d, i) => (isAngleRate(d) ? i : -1)).filter(i => i >= 0)

  // A catch LQR for every equilibrium so we can grab whichever is nearest.
  const w = WEIGHTS[plant.meta.name]
  const Q = dims.map((_, i) => dims.map((_, j) => (i === j ? (w[i] ?? 1) : 0)))
  const eqs = plant.meta.equilibria.map((eq, i) => ({
    x: eq.x, label: eq.label,
    K: lqrForEquilibrium(plant, i, Q, R_BY_PLANT[plant.meta.name], controlDt).K,
  }))

  const clamp = f => Math.max(-fMax, Math.min(fMax, f))

  let script = []       // [{ force, dur }] — open-loop segments (seconds)
  let t = 0             // elapsed playback time (s)
  let playing = false
  let balancing = false
  let caught = 0        // equilibrium index being held once balancing
  let autoCatch = false
  let homeEq = eqs.length - 1 // equilibrium the run STARTED at (excluded from auto-catch)
  let lastState = plant.initialState()

  const totalDur = () => script.reduce((s, seg) => s + seg.dur, 0)

  // Force scripted at time `time` (coast at 0 once the script ends).
  function scriptForce(time) {
    let acc = 0
    for (let i = 0; i < script.length; i++) {
      acc += script[i].dur
      if (time < acc) return { force: clamp(script[i].force), idx: i }
    }
    return { force: 0, idx: -1 }
  }

  function errTo(state, eqx) {
    const v = plant.toVec(state)
    return v.map((val, i) => (angleIdx.includes(i) ? wrap(val - eqx[i]) : val - eqx[i]))
  }

  // Nearest equilibrium (by angular configuration) + whether it's catchable now.
  function nearest(state) {
    let best = { i: 0, angErr: Infinity, rateErr: 0 }
    for (let i = 0; i < eqs.length; i++) {
      const e = errTo(state, eqs[i].x)
      const angErr = Math.max(...angleIdx.map(k => Math.abs(e[k])))
      if (angErr < best.angErr) {
        const rateErr = Math.max(...angleRateIdx.map(k => Math.abs(e[k])))
        best = { i, angErr, rateErr }
      }
    }
    best.catchable = best.angErr < CATCH_ANGLE && best.rateErr < CATCH_RATE
    return best
  }

  function balanceForce(state) {
    const eq = eqs[caught]
    const e = errTo(state, eq.x)
    return clamp(-eq.K.reduce((s, k, i) => s + k * e[i], 0))
  }

  function compute(state) {
    lastState = state
    if (balancing) return { force: balanceForce(state), mode: 'balance' }
    if (playing) {
      if (autoCatch) {
        // Catch the first NEW equilibrium reached — not the one we launched from
        // (you start sitting at a trivially "catchable" equilibrium).
        const n = nearest(state)
        if (n.catchable && n.i !== homeEq) { balancing = true; caught = n.i; playing = false; return { force: balanceForce(state), mode: 'balance' } }
      }
      const { force, idx } = scriptForce(t)
      t += controlDt
      return { force, mode: idx >= 0 ? 'tas-play' : 'tas-coast' }
    }
    return { force: 0, mode: 'tas-idle' }
  }

  return {
    compute,
    reset() { t = 0; playing = false; balancing = false }, // keeps the authored script
    // Transport
    play(state) { balancing = false; playing = true; t = 0; homeEq = nearest(state || lastState).i },
    pause() { playing = false },
    get playing() { return playing },
    get elapsed() { return t },
    // Catch handoff — grab the nearest equilibrium from wherever we are now.
    engageBalance(state) { const n = nearest(state || lastState); caught = n.i; balancing = true; playing = false; return n },
    disengage() { balancing = false },
    get balancing() { return balancing },
    setAutoCatch(v) { autoCatch = !!v },
    get autoCatch() { return autoCatch },
    // Script editing
    setScript(segs) { script = segs.map(s => ({ force: +s.force || 0, dur: Math.max(0.02, +s.dur || 0) })) },
    get script() { return script },
    // Live "catchable?" readout for the UI.
    probe() { return { ...nearest(lastState), label: eqs[nearest(lastState).i].label, total: totalDur() } },
    // Balance uses the estimate (separation principle holds near equilibria);
    // open-loop playback ignores the state entirely, so its source is moot.
    get wantsTrueState() { return !balancing },
    get info() {
      const n = nearest(lastState)
      return {
        type: 'tas', dims, playing, balancing,
        elapsed: t, total: totalDur(), segCount: script.length,
        nearestLabel: eqs[n.i].label, angErr: n.angErr, rateErr: n.rateErr, catchable: n.catchable,
        caughtLabel: balancing ? eqs[caught].label : null,
      }
    },
  }
}
