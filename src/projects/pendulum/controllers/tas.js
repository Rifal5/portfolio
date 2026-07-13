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

// Cheap prefilter before the (more expensive) catch probe: only bother
// simulating a catch when the angles are at least in the neighbourhood. This is
// NOT the catchable test — it just avoids probing while the pole is way off.
const NEAR_ANGLE = 0.7
// The honest catchable test forward-simulates the catch LQR. A plain angle/rate
// threshold lies for the double's unstable equilibria — the true region of
// attraction is genuinely non-monotonic (at a 12° down-up error the catch holds
// at 0.5 & 1.0 rad/s, fails at 1.5, "holds" again at 2.0 & 2.5…), and several of
// those "holds" are 6-second violent near-wall recoveries — the very thrashing
// that feels like a failed catch. So "catchable" means a CLEAN catch: settle
// quickly, without a large swing-out. That is both more useful (green = a catch
// you actually want) and cheap to check. The sim must run at the plant's own
// step — a coarser one flips the verdict on this stiff, unstable plant.
const PROBE_T = 2.5          // seconds — a clean catch settles well within this
const PROBE_DT = 1 / 240     // must match plant fidelity; coarser lies
const PROBE_EXCURSION = 0.8  // rad — if the catch swings this far off, not clean
const PROBE_SETTLE_ANG = 0.06
const PROBE_SETTLE_RATE = 0.35
const PROBE_SETTLE_HOLD = 0.3  // stay settled this long to count as caught
const PROBE_EVERY = 20       // recompute at ~12 Hz (≈5 ms each, gated + early-exit)
// Cheap gate before simulating: only bother when we're near an equilibrium and
// not whipping through it (a state is angles AND velocities).
const NEAR_RATE = 5.0

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
  let probeTick = 0
  let probeCache = { i: homeEq, angErr: Infinity, rateErr: 0, catchable: false }
  // (refreshProbe defined below is called once at the end of setup to prime it)

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

  // Nearest equilibrium by angular configuration (no catchability verdict).
  function nearestByAngle(state) {
    let best = { i: 0, angErr: Infinity, rateErr: 0 }
    for (let i = 0; i < eqs.length; i++) {
      const e = errTo(state, eqs[i].x)
      const angErr = Math.max(...angleIdx.map(k => Math.abs(e[k])))
      if (angErr < best.angErr) best = { i, angErr, rateErr: Math.max(...angleRateIdx.map(k => Math.abs(e[k]))) }
    }
    return best
  }

  // Forward-simulate equilibrium `i`'s catch LQR from `state` on the ideal plant.
  // Catchable ⇔ the closed loop actually converges (and never hits the wall).
  // Early exits keep it cheap: return true the moment it stays settled for a
  // beat, false as soon as it hits the wall or clearly diverges.
  function probeCatch(state, i) {
    const eq = eqs[i]
    let s = plant.fromVec(plant.toVec(state))
    const half = plant.PARAMS.trackHalfWidth
    let settledFor = 0
    for (let t2 = 0; t2 < PROBE_T; t2 += PROBE_DT) {
      const e = errTo(s, eq.x)
      const ang = Math.max(...angleIdx.map(k => Math.abs(e[k])))
      const rate = Math.max(...angleRateIdx.map(k => Math.abs(e[k])))
      if (ang < PROBE_SETTLE_ANG && rate < PROBE_SETTLE_RATE) {
        settledFor += PROBE_DT
        if (settledFor >= PROBE_SETTLE_HOLD) return true // parked at the equilibrium
      } else settledFor = 0
      if (Math.abs(s.x) > half || ang > PROBE_EXCURSION) return false // wall or not-clean
      s = plant.step(s, clamp(-eq.K.reduce((a, k, j) => a + k * e[j], 0)), PROBE_DT)
    }
    return false
  }

  // The truthful "catchable?" answer for the nearest equilibrium: prefilter on
  // angle, then confirm by simulating the catch.
  function refreshProbe(state) {
    const n = nearestByAngle(state)
    // Cheap gate first (avoids simulating while the pole is far off or whipping);
    // then the authoritative clean-catch simulation.
    n.catchable = n.angErr < NEAR_ANGLE && n.rateErr < NEAR_RATE && probeCatch(state, n.i)
    probeCache = n
    return n
  }

  function balanceForce(state) {
    const eq = eqs[caught]
    const e = errTo(state, eq.x)
    return clamp(-eq.K.reduce((s, k, i) => s + k * e[i], 0))
  }

  refreshProbe(lastState) // prime the readout

  function compute(state) {
    lastState = state
    if (balancing) return { force: balanceForce(state), mode: 'balance' }
    if (playing) {
      // Refresh the catch probe at ~12 Hz (a short, gated forward simulation).
      if (probeTick++ % PROBE_EVERY === 0) refreshProbe(state)
      if (autoCatch) {
        // Catch the first NEW equilibrium the LQR can actually hold — not the
        // one we launched from (you start sitting at a trivially catchable one).
        if (probeCache.catchable && probeCache.i !== homeEq) {
          balancing = true; caught = probeCache.i; playing = false
          return { force: balanceForce(state), mode: 'balance' }
        }
      }
      const { force, idx } = scriptForce(t)
      t += controlDt
      return { force, mode: idx >= 0 ? 'tas-play' : 'tas-coast' }
    }
    // Idle/paused: the pole still coasts under zero force, so keep the catch
    // readout live (throttled) — you can pause and grab it on the way through.
    if (probeTick++ % PROBE_EVERY === 0) refreshProbe(state)
    return { force: 0, mode: 'tas-idle' }
  }

  return {
    compute,
    reset() { t = 0; playing = false; balancing = false }, // keeps the authored script
    // Transport
    play(state) { balancing = false; playing = true; t = 0; probeTick = 0; homeEq = nearestByAngle(state || lastState).i },
    pause() { playing = false },
    get playing() { return playing },
    get elapsed() { return t },
    // Catch handoff — grab the nearest equilibrium from wherever we are now.
    // (You may engage a state the LQR can't hold; the readout warns you, and the
    // safety cutoff trips if it diverges — that's honest, not a crash.)
    engageBalance(state) { const n = refreshProbe(state || lastState); caught = n.i; balancing = true; playing = false; return n },
    disengage() { balancing = false },
    get balancing() { return balancing },
    setAutoCatch(v) { autoCatch = !!v },
    get autoCatch() { return autoCatch },
    // Script editing
    setScript(segs) { script = segs.map(s => ({ force: +s.force || 0, dur: Math.max(0.02, +s.dur || 0) })) },
    get script() { return script },
    // Live "catchable?" readout for the UI (uses the cached forward-sim probe).
    probe() { return { ...probeCache, label: eqs[probeCache.i].label, total: totalDur() } },
    probeAt(state) { return refreshProbe(state) }, // one-shot (debug/timing)
    // Balance uses the estimate (separation principle holds near equilibria);
    // open-loop playback ignores the state entirely, so its source is moot.
    get wantsTrueState() { return !balancing },
    get info() {
      const n = probeCache
      return {
        type: 'tas', dims, playing, balancing,
        elapsed: t, total: totalDur(), segCount: script.length,
        nearestLabel: eqs[n.i].label, angErr: n.angErr, rateErr: n.rateErr, catchable: n.catchable,
        caughtLabel: balancing ? eqs[caught].label : null,
      }
    },
  }
}
