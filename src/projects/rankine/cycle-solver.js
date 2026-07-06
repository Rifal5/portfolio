import { satByP, superheated, liquidPT, stateFromPS, stateFromPH } from './steam-if97.js'

// Solve a modular Rankine cycle with reheat and feedwater regeneration.
//
// config.components (expansion order):
//   { type:'turbine', exitP } | { type:'reheat', toT } | { type:'fwh' } | { type:'cfwh' }
//
// config.ttd      — closed-FWH terminal temperature difference (°C): feedwater
//                   leaves TTD below Tsat of the extraction.
// config.mixerPos — where closed-FWH drains rejoin the feed line:
//   'after'  — drains pumped forward to a mixer just before the boiler
//   'before' — mixer sits right after the condensate pump (report topology);
//              the feed line is then pumped in stages: a pump after the
//              condenser and after each CFWH raises it to the next pressure.
//
// Extraction fractions y come from heater energy balances; the feed train is
// re-walked until the y vector converges. Every state carries a `proc` tag so
// the T-s renderer can draw true constant-pressure process paths.
export function solveCycle(config) {
  const { boilerP, condenserP, inletT, massFlow, turbineEff, pumpEff, genEff } = config
  const ttd = config.ttd || 0
  const mixerPos = config.mixerPos || 'after'
  const components = config.components || []
  const turbines = components.filter(c => c.type === 'turbine')

  if (boilerP <= condenserP) return { error: 'Boiler pressure must exceed condenser pressure.' }
  if (turbines.length === 0) return { error: 'Add at least one turbine stage.' }
  const satHigh = satByP(boilerP)
  if (inletT < satHigh.Tsat + 1) return { error: `Turbine inlet temp must exceed boiler saturation (${satHigh.Tsat.toFixed(0)}°C).` }

  const pumpDh = (vf, pLow, pHigh) => (vf * (pHigh - pLow) * 100) / pumpEff // bar→kPa
  const clampY = v => Math.max(0, Math.min(0.5, v))

  // ── Pass 1: expansion path ────────────────────────────────────────────────
  const expansionStates = []
  const legs = []
  const reheatLegs = []
  const extractions = []   // expansion order (descending P): { P, h, mode }
  let turbinesSeen = 0

  const inlet = superheated(boilerP, inletT)
  let cur = { P: boilerP, T: inlet.T, h: inlet.h, s: inlet.s, x: null }
  expansionStates.push({ label: 'Boiler out', proc: 'start', ...cur })

  for (const c of components) {
    if (c.type === 'turbine') {
      turbinesSeen++
      const isLast = turbinesSeen === turbines.length
      const exitP = isLast ? condenserP : Math.min(Math.max(c.exitP, condenserP), cur.P * 0.999)
      const iso = stateFromPS(exitP, cur.s)
      const hAct = cur.h - turbineEff * (cur.h - iso.h)
      const st = stateFromPH(exitP, hAct)
      legs.push({ hIn: cur.h, hOut: hAct, nExtrBefore: extractions.length })
      cur = { P: exitP, T: st.T, h: hAct, s: st.s, x: st.x }
      expansionStates.push({ label: 'Turbine out', proc: 'turbine', ...cur })
    } else if (c.type === 'reheat') {
      const toT = Math.max(c.toT, satByP(cur.P).Tsat + 1)
      const rh = superheated(cur.P, toT)
      reheatLegs.push({ dh: rh.h - cur.h, nExtrBefore: extractions.length })
      cur = { P: cur.P, T: rh.T, h: rh.h, s: rh.s, x: null }
      expansionStates.push({ label: 'Reheat out', proc: 'reheat', ...cur })
    } else if (c.type === 'fwh' || c.type === 'cfwh') {
      if (cur.P < boilerP * 0.999 && cur.P > condenserP * 1.001) {
        extractions.push({ P: cur.P, h: cur.h, mode: c.type === 'cfwh' ? 'closed' : 'open' })
      }
    }
  }
  const condenserInlet = { ...cur }
  const satLow = satByP(condenserP)

  // ── Pass 2: feedwater train, iterated to convergence ──────────────────────
  const n = extractions.length
  const feedIdx = extractions.map((_, k) => k).sort((a, b) => extractions[a].P - extractions[b].P)
  const closedIdx = feedIdx.filter(k => extractions[k].mode === 'closed')
  const mixBefore = mixerPos === 'before' && closedIdx.length > 0
  let y = new Array(n).fill(0)
  let walk = null

  for (let iter = 0; iter < 40; iter++) {
    walk = walkFeedTrain(y)
    let delta = 0
    for (let k = 0; k < n; k++) { delta = Math.max(delta, Math.abs(walk.y[k] - y[k])); y[k] = walk.y[k] }
    if (delta < 1e-11) break
  }

  function walkFeedTrain(yPrev) {
    const yNew = yPrev.slice()
    const sumY = yPrev.reduce((a, b) => a + b, 0)
    let F = 1 - sumY
    let h = satLow.hf
    let Pline = condenserP
    let wPump = 0
    let pumpedToBoiler = false
    const feedStates = []
    const drains = []
    let hasMixer = false

    const pumpLine = (toP, label) => {
      if (toP <= Pline * 1.0001) return
      const dh = pumpDh(satByP(Pline).vf, Pline, toP)
      wPump += F * dh
      h += dh
      Pline = toP
      const st = stateFromPH(Pline, h)
      feedStates.push({ label, proc: 'pump', P: Pline, T: st.T, h, s: st.s, x: null })
    }

    // 'before' topology: condensate pump to the first stage, then the MIXER —
    // closed drains rejoin here (throttled down, or pumped up if needed).
    if (mixBefore) {
      const firstP = extractions[feedIdx[0]].P
      pumpLine(firstP, 'Pump out')
      let yD = 0, hD = 0
      for (const k of closedIdx) {
        const ex = extractions[k]
        const sat = satByP(ex.P)
        let hd = sat.hf
        if (ex.P < Pline) { const dd = pumpDh(sat.vf, ex.P, Pline); hd += dd; wPump += yPrev[k] * dd }
        drains.push({ k, y: yPrev[k], h: hd, P: ex.P, Tsat: sat.Tsat })
        yD += yPrev[k]; hD += yPrev[k] * hd
      }
      if (yD > 1e-9) {
        h = (F * h + hD) / (F + yD)
        F += yD
        hasMixer = true
        const st = stateFromPH(Pline, h)
        feedStates.push({ label: 'Mixer out', proc: 'mix', P: Pline, T: st.T, h, s: st.s, x: null })
      }
    }

    let oN = 0, cN = 0
    for (const k of feedIdx) {
      const ex = extractions[k]
      const sat = satByP(ex.P)
      if (ex.mode === 'open') {
        oN++
        pumpLine(ex.P, 'Pump out')
        const denom = ex.h - sat.hf
        const yk = denom > 1e-6 ? clampY(F * (sat.hf - h) / denom) : 0
        yNew[k] = yk
        F += yk
        h = sat.hf
        feedStates.push({ label: `OFWH ${oN} out`, proc: 'fwh', P: ex.P, T: sat.Tsat, h, s: sat.sf, x: 0 })
      } else {
        cN++
        let heaterP
        if (mixBefore) {
          pumpLine(ex.P, 'Pump out')       // staged pump up to this heater's pressure
          heaterP = ex.P
        } else {
          if (!pumpedToBoiler) { pumpLine(boilerP, 'Feed pump out'); pumpedToBoiler = true }
          heaterP = boilerP
        }
        const tOut = Math.max(sat.Tsat - ttd, 5)
        const out = liquidPT(heaterP, tOut)
        const denom = ex.h - sat.hf
        const yk = (denom > 1e-6 && out.h > h) ? clampY(F * (out.h - h) / denom) : 0
        yNew[k] = yk
        h = h + yk * denom / F
        const st = stateFromPH(heaterP, h)
        feedStates.push({ label: `CFWH ${cN} fw out`, proc: 'fwh', P: heaterP, T: st.T, h, s: st.s, x: null })
        if (!mixBefore) {
          const dDh = pumpDh(sat.vf, ex.P, boilerP)
          wPump += yk * dDh
          drains.push({ k, y: yk, h: sat.hf + dDh, P: ex.P, Tsat: sat.Tsat })
        }
      }
    }

    pumpLine(boilerP, 'Feed pump out')

    // 'after' topology: drains pumped forward rejoin at a mixer before the boiler
    if (!mixBefore && drains.length) {
      const yD = drains.reduce((a, d) => a + d.y, 0)
      if (yD > 1e-9) {
        h = (F * h + drains.reduce((a, d) => a + d.y * d.h, 0)) / (F + yD)
        F += yD
        hasMixer = true
        const st = stateFromPH(boilerP, h)
        feedStates.push({ label: 'Mixer out', proc: 'mix', P: boilerP, T: st.T, h, s: st.s, x: null })
      }
    }

    return { y: yNew, hBoilerIn: h, wPump, feedStates, drains, hasMixer }
  }

  // ── Pass 3: energetics ────────────────────────────────────────────────────
  const flowBefore = k => { let f = 1; for (let i = 0; i < k; i++) f -= y[i]; return f }
  let wTurb = 0
  for (const leg of legs) wTurb += flowBefore(leg.nExtrBefore) * (leg.hIn - leg.hOut)
  let qReheat = 0
  for (const rh of reheatLegs) qReheat += flowBefore(rh.nExtrBefore) * rh.dh

  const qBoiler = inlet.h - walk.hBoilerIn
  const qIn = qBoiler + qReheat
  const wNet = wTurb - walk.wPump
  const eta = wNet / qIn

  const states = [
    ...expansionStates,
    { label: 'Condenser out', proc: 'condense', P: condenserP, T: satLow.Tsat, h: satLow.hf, s: satLow.sf, x: 0 },
    ...walk.feedStates,
  ]
  const last = states[states.length - 1]
  if (Math.abs(last.h - walk.hBoilerIn) < 0.5 && Math.abs(last.P - boilerP) < 1e-6) {
    last.label += ' / Boiler in'
  } else {
    const bi = stateFromPH(boilerP, walk.hBoilerIn)
    states.push({ label: 'Boiler in', proc: 'pump', P: boilerP, T: bi.T, h: walk.hBoilerIn, s: bi.s, x: null })
  }

  return {
    states,
    extractions: extractions.map((e, k) => ({ P: e.P, h: e.h, y: y[k], mode: e.mode })),
    drains: walk.drains.map(d => ({
      label: `Drain @ ${d.P < 1 ? d.P.toFixed(2) : d.P.toFixed(1)} bar → mixer`,
      P: d.P, T: d.Tsat, h: d.h, y: d.y,
    })),
    hasMixer: walk.hasMixer,
    mixerPos: mixBefore ? 'before' : 'after',
    perf: {
      qIn, qBoiler, qReheat, wTurb, wPump: walk.wPump, wNet, qOut: qIn - wNet,
      eta, bwr: walk.wPump / wTurb,
      netPowerMW: (wNet * massFlow * genEff) / 1000,
      grossPowerMW: (wTurb * massFlow * genEff) / 1000,
      exitQuality: condenserInlet.x != null ? condenserInlet.x : null,
      nFWH: n, massFlow,
    },
  }
}
