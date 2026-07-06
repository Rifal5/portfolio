import { domePoints, satByP, superheated, liquidPT } from './steam-if97.js'

const BG = '#0a0a0f'
const EXTR_COLORS = ['#eab308', '#f472b6', '#2dd4bf', '#a78bfa', '#fb923c']

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.save(); ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, rect.width, rect.height)
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, rect.width, rect.height)
  return { ctx, W: rect.width, H: rect.height }
}

// ── T-S diagram with true constant-pressure process paths ────────────────────
function vaporCurve(P, T1, T2, N = 14) {
  const pts = []
  for (let i = 1; i <= N; i++) {
    const T = T1 + (T2 - T1) * (i / N)
    pts.push({ s: superheated(P, T).s, T: Math.max(T, satByP(P).Tsat) })
  }
  return pts
}
function liquidCurve(P, T1, T2, N = 10) {
  const pts = []
  for (let i = 1; i <= N; i++) {
    const T = T1 + (T2 - T1) * (i / N)
    pts.push({ s: liquidPT(P, T).s, T })
  }
  return pts
}

function legPoints(prev, curr) {
  const sat = satByP(curr.P)
  switch (curr.proc) {
    case 'reheat':
      return vaporCurve(curr.P, prev.T, curr.T)
    case 'condense': {
      const pts = []
      if (prev.x == null && prev.T > sat.Tsat + 0.5) {
        pts.push(...vaporCurve(curr.P, prev.T, sat.Tsat))
        pts.push({ s: sat.sg, T: sat.Tsat })
      }
      pts.push({ s: curr.s, T: curr.T })
      return pts
    }
    case 'fwh':
      return liquidCurve(curr.P, prev.T, curr.T)
    default:
      return [{ s: curr.s, T: curr.T }]
  }
}

function boilerLeg(fromState, toState) {
  const P = toState.P
  const sat = satByP(P)
  const pts = []
  pts.push(...liquidCurve(P, fromState.T, sat.Tsat))
  pts.push({ s: sat.sf, T: sat.Tsat })
  pts.push({ s: sat.sg, T: sat.Tsat })
  pts.push(...vaporCurve(P, sat.Tsat, toState.T))
  return pts
}

export function renderTS(canvas, result) {
  const { ctx, W, H } = setup(canvas)
  const pad = { l: 42, r: 14, t: 16, b: 30 }
  const dome = domePoints()
  const states = result && result.states ? result.states : []

  const allS = [...dome.liq.map(p => p.s), ...dome.vap.map(p => p.s), ...states.map(s => s.s)]
  const allT = [...dome.liq.map(p => p.T), ...dome.vap.map(p => p.T), ...states.map(s => s.T)]
  const sMin = 0, sMax = Math.max(9, Math.ceil(Math.max(...allS) + 0.5))
  const tMin = 0, tMax = Math.max(400, Math.ceil((Math.max(...allT) + 60) / 100) * 100)
  const px = s => pad.l + (s - sMin) / (sMax - sMin) * (W - pad.l - pad.r)
  const py = T => H - pad.b - (T - tMin) / (tMax - tMin) * (H - pad.t - pad.b)

  ctx.strokeStyle = '#1e1e2e'; ctx.fillStyle = '#64748b'; ctx.font = '9px Inter'; ctx.lineWidth = 1
  ctx.textAlign = 'right'
  for (let T = 0; T <= tMax; T += tMax / 4) {
    const yy = py(T); ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke()
    ctx.fillText(T.toFixed(0), pad.l - 4, yy + 3)
  }
  ctx.textAlign = 'center'
  for (let s = 0; s <= sMax; s += 2) {
    const x = px(s); ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke()
    ctx.fillText(s.toFixed(0), x, H - pad.b + 12)
  }
  ctx.fillStyle = '#94a3b8'; ctx.textAlign = 'left'
  ctx.fillText('T (°C)', pad.l - 38, pad.t + 6)
  ctx.textAlign = 'right'; ctx.fillText('s (kJ/kg·K)', W - pad.r, H - pad.b + 24)

  ctx.beginPath()
  dome.liq.forEach((p, i) => { const x = px(p.s), yy = py(p.T); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy) })
  for (let i = dome.vap.length - 1; i >= 0; i--) ctx.lineTo(px(dome.vap[i].s), py(dome.vap[i].T))
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.5; ctx.stroke()

  if (!states.length) { ctx.restore(); return }

  const path = [{ s: states[0].s, T: states[0].T }]
  for (let i = 1; i < states.length; i++) path.push(...legPoints(states[i - 1], states[i]))
  path.push(...boilerLeg(states[states.length - 1], states[0]))

  ctx.beginPath()
  path.forEach((p, i) => { const x = px(p.s), yy = py(p.T); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy) })
  ctx.closePath()
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2; ctx.stroke()
  ctx.fillStyle = 'rgba(245,158,11,0.08)'; ctx.fill()

  for (let i = 0; i < states.length; i++) {
    const s = states[i]
    ctx.beginPath(); ctx.arc(px(s.s), py(s.T), 3, 0, Math.PI * 2)
    ctx.fillStyle = '#fbbf24'; ctx.fill()
    ctx.strokeStyle = BG; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = '#e2e8f0'; ctx.font = '9px Inter'; ctx.textAlign = 'left'
    ctx.fillText(String(i + 1), px(s.s) + 5, py(s.T) - 4)
  }
  ctx.restore()
}

// ── Schematic shapes ─────────────────────────────────────────────────────────
const TYPE_STYLE = {
  boiler:    { color: '#ef4444' },
  turbine:   { color: '#6366f1' },
  reheat:    { color: '#f97316' },
  condenser: { color: '#38bdf8' },
  pump:      { color: '#22c55e' },
  fwh:       { color: '#eab308' },
  mixer:     { color: '#e879f9' },
}

function drawShape(ctx, type, x, y, w, h, color) {
  ctx.fillStyle = '#12121a'
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  if (type === 'turbine') {
    ctx.moveTo(x, y + h * 0.30); ctx.lineTo(x + w, y)
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h * 0.70); ctx.closePath()
  } else if (type === 'pump') {
    ctx.arc(x + w / 2, y + h / 2, h / 2.4, 0, Math.PI * 2)
  } else if (type === 'mixer') {
    ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w * 0.92, y + h / 2)
    ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x + w * 0.08, y + h / 2); ctx.closePath()
  } else if (type === 'fwh') {
    const r = h / 2
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
  } else if (type === 'boiler') {
    ctx.moveTo(x, y + h * 0.28); ctx.lineTo(x + w / 2, y); ctx.lineTo(x + w, y + h * 0.28)
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath()
  } else {
    const r = 5
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
  }
  ctx.fill(); ctx.stroke()

  ctx.strokeStyle = color + '88'
  ctx.lineWidth = 1
  if (type === 'condenser') {
    ctx.beginPath()
    const cy = y + h * 0.68, amp = 3.5, nW = 6
    for (let i = 0; i <= nW * 8; i++) {
      const t = i / (nW * 8)
      const wx = x + 8 + t * (w - 16)
      const wy = cy + Math.sin(t * Math.PI * nW) * amp
      i ? ctx.lineTo(wx, wy) : ctx.moveTo(wx, wy)
    }
    ctx.stroke()
  } else if (type === 'reheat' || type === 'boiler') {
    ctx.beginPath()
    const zy = y + h * (type === 'boiler' ? 0.72 : 0.68), zw = w - 20, seg = 6
    for (let i = 0; i <= seg; i++) {
      const zx = x + 10 + (zw * i) / seg
      i ? ctx.lineTo(zx, zy + (i % 2 === 0 ? 3.5 : -3.5)) : ctx.moveTo(zx, zy + 3.5)
    }
    ctx.stroke()
  } else if (type === 'fwh') {
    ctx.beginPath()
    ctx.moveTo(x + 6, y + h * 0.62); ctx.lineTo(x + w - 6, y + h * 0.62)
    ctx.stroke()
  } else if (type === 'pump') {
    const cx = x + w / 2, cy = y + h / 2, r = h * 0.18
    ctx.beginPath()
    ctx.moveTo(cx + r, cy); ctx.lineTo(cx - r * 0.7, cy - r * 0.8)
    ctx.lineTo(cx - r * 0.7, cy + r * 0.8); ctx.closePath()
    ctx.stroke()
  }
}

// ── Orthogonal routing helpers ───────────────────────────────────────────────
function orthoPath(ctx, pts, color, dash, lineWidth = 1.4) {
  ctx.save()
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lineWidth
  if (dash) ctx.setLineDash(dash)
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.stroke()
  ctx.setLineDash([])
  const [xa, ya] = pts[pts.length - 2], [xb, yb] = pts[pts.length - 1]
  const len = Math.hypot(xb - xa, yb - ya) || 1
  arrowHead(ctx, xb, yb, (xb - xa) / len, (yb - ya) / len)
  ctx.restore()
}
function arrowHead(ctx, x, y, ux, uy) {
  const ah = 5
  ctx.beginPath(); ctx.moveTo(x, y)
  ctx.lineTo(x - ux * ah - uy * ah * 0.6, y - uy * ah + ux * ah * 0.6)
  ctx.lineTo(x - ux * ah + uy * ah * 0.6, y - uy * ah - ux * ah * 0.6)
  ctx.closePath(); ctx.fill()
}

// ── Schematic: numbered state lines, orthogonal routing ──────────────────────
export function renderSchematic(canvas, config, result) {
  const { ctx, W, H } = setup(canvas)
  const extractions = result && result.extractions ? result.extractions : []
  const states = result && result.states ? result.states : null

  // Top row (steam path). Each block records the state number leaving it.
  const top = [{ type: 'boiler', title: 'Boiler', sub: `${config.boilerP} bar · ${config.inletT}°C`, exitState: 1 }]
  const heaters = []
  let tN = 0, fN = 0, lastTurbineTop = 0, expN = 1
  for (const c of config.components) {
    if (c.type === 'turbine') {
      tN++; expN++
      top.push({ type: 'turbine', title: `Turbine ${tN}`, sub: '', exitState: expN })
      lastTurbineTop = top.length - 1
    } else if (c.type === 'reheat') {
      expN++
      top.push({ type: 'reheat', title: 'Reheater', sub: `${c.toT}°C`, exitState: expN })
    } else if (c.type === 'fwh' || c.type === 'cfwh') {
      heaters.push({ extrIdx: fN, mode: c.type === 'cfwh' ? 'closed' : 'open', fromTop: lastTurbineTop })
      fN++
    }
  }
  const heatersFeedOrder = [...heaters].sort((a, b) => {
    const ea = extractions[a.extrIdx], eb = extractions[b.extrIdx]
    return (ea ? ea.P : 0) - (eb ? eb.P : 0)
  })

  // Bottom row mirrors the SOLVED feed train exactly, so each block's exit line
  // carries its state number (same numbering as the T-s diagram and table).
  const bot = []
  let mixerBot = -1
  if (states) {
    const condIdx = states.findIndex(s => s.label.startsWith('Condenser out'))
    bot.push({ type: 'condenser', title: 'Condenser', sub: `${config.condenserP} bar`, exitState: condIdx + 1 })
    let hSeq = 0
    for (let i = condIdx + 1; i < states.length; i++) {
      const lbl = states[i].label
      let blk
      if (lbl.startsWith('Mixer out')) {
        blk = { type: 'mixer', title: 'Mix', sub: '' }
        mixerBot = bot.length
      } else if (lbl.startsWith('OFWH') || lbl.startsWith('CFWH')) {
        const hh = heatersFeedOrder[hSeq++]
        if (hh) hh.botIdx = bot.length
        const e = hh ? extractions[hh.extrIdx] : null
        blk = {
          type: 'fwh', title: lbl.split(' ').slice(0, 2).join(' '), extrIdx: hh ? hh.extrIdx : null,
          sub: e ? `${e.P < 1 ? e.P.toFixed(2) : e.P.toFixed(1)} bar · y=${e.y.toFixed(3)}` : '',
        }
      } else {
        blk = { type: 'pump', title: 'P', sub: '' }
      }
      blk.exitState = i + 1
      bot.push(blk)
    }
  } else {
    bot.push({ type: 'condenser', title: 'Condenser', sub: `${config.condenserP} bar` }, { type: 'pump', title: 'P', sub: '' })
    for (const hh of heatersFeedOrder) {
      hh.botIdx = bot.length
      bot.push({ type: 'fwh', title: hh.mode === 'closed' ? 'CFWH' : 'OFWH', extrIdx: hh.extrIdx, sub: '' })
    }
  }

  // ── Positions ──
  const bh = 42
  const topY = 26
  const botY = H - 54 - bh
  const bwTop = Math.max(56, Math.min(108, (W - 44) / top.length - 12))
  const gapT = top.length > 1 ? (W - 44 - bwTop) / (top.length - 1) : 0
  const posT = top.map((_, i) => ({ x: 22 + i * gapT, y: topY, w: bwTop }))

  const widthOf = b => b.type === 'pump' ? bh * 0.85 : b.type === 'mixer' ? bh * 1.2 : bwBot
  const nSmall = bot.filter(b => b.type === 'pump' || b.type === 'mixer').length
  const nWide = bot.length - nSmall
  let bwBot = Math.max(54, Math.min(100,
    (W - 44 - nSmall * bh * 1.05 - (bot.length - 1) * 12) / Math.max(nWide, 1)))
  const totalBot = bot.reduce((a, b) => a + widthOf(b), 0)
  const gapB = bot.length > 1 ? Math.max(8, (W - 44 - totalBot) / (bot.length - 1)) : 0
  const posB = []
  let bx = W - 22
  for (const b of bot) {
    const w = widthOf(b)
    bx -= w
    posB.push({ x: bx, y: botY, w })
    bx -= gapB
  }

  const LOOP = '#475569'
  const edgeNum = (x, y, num) => {
    if (num == null || !states) return
    ctx.save()
    ctx.font = '600 9px Inter'; ctx.textAlign = 'center'
    ctx.lineWidth = 3; ctx.strokeStyle = BG
    ctx.strokeText(String(num), x, y)
    ctx.fillStyle = '#fbbf24'
    ctx.fillText(String(num), x, y)
    ctx.restore()
  }

  // ── Main loop edges (orthogonal + numbered) ──
  const midT = topY + bh / 2
  for (let i = 0; i < top.length - 1; i++) {
    const x1 = posT[i].x + posT[i].w, x2 = posT[i + 1].x
    orthoPath(ctx, [[x1, midT], [x2, midT]], LOOP, null, 1.5)
    edgeNum((x1 + x2) / 2, midT - 5, top[i].exitState)
  }
  // exhaust: last top block → condenser (down, jog, down)
  {
    const cxT = posT[top.length - 1].x + posT[top.length - 1].w / 2
    const cxB = posB[0].x + posB[0].w / 2
    const jog = botY - 16
    orthoPath(ctx, [[cxT, topY + bh], [cxT, jog], [cxB, jog], [cxB, botY]], LOOP, null, 1.5)
    edgeNum(cxT + 10, topY + bh + (jog - topY - bh) / 2, top[top.length - 1].exitState)
  }
  // feed line: bottom row right → left
  const midB = botY + bh / 2
  for (let i = 0; i < bot.length - 1; i++) {
    const x1 = posB[i].x, x2 = posB[i + 1].x + posB[i + 1].w
    orthoPath(ctx, [[x1, midB], [x2, midB]], LOOP, null, 1.5)
    edgeNum((x1 + x2) / 2, midB - 5, bot[i].exitState)
  }
  // return: last bottom block → boiler (up, jog, up)
  {
    const cxB = posB[bot.length - 1].x + posB[bot.length - 1].w / 2
    const cxT = posT[0].x + posT[0].w / 2
    const jog = topY + bh + 13
    orthoPath(ctx, [[cxB, botY], [cxB, jog], [cxT, jog], [cxT, topY + bh]], LOOP, null, 1.5)
    edgeNum(cxB + 10, jog + (botY - jog) / 2, bot[bot.length - 1].exitState)
  }

  // ── Extraction branches (orthogonal, dashed, per-extraction colour) ──
  for (const hh of heaters) {
    if (hh.botIdx == null) continue
    const e = extractions[hh.extrIdx]
    const color = EXTR_COLORS[hh.extrIdx % EXTR_COLORS.length]
    const from = posT[hh.fromTop], to = posB[hh.botIdx]
    const x1 = from.x + from.w * 0.62
    const laneY = topY + bh + 26 + hh.extrIdx * 13
    const x2 = to.x + to.w / 2
    orthoPath(ctx, [[x1, topY + bh], [x1, laneY], [x2, laneY], [x2, botY]], color, [5, 4])
    if (e) {
      ctx.save()
      ctx.fillStyle = color; ctx.font = '600 9px Inter'; ctx.textAlign = 'center'
      ctx.fillText(`y=${e.y.toFixed(3)}`, (x1 + x2) / 2, laneY - 4)
      ctx.restore()
    }
  }

  // ── Drain lines: closed heaters → mixer (orthogonal, below the row) ──
  if (mixerBot >= 0) {
    let dSeq = 0
    for (const hh of heatersFeedOrder) {
      if (hh.mode !== 'closed' || hh.botIdx == null) continue
      const color = EXTR_COLORS[hh.extrIdx % EXTR_COLORS.length]
      const from = posB[hh.botIdx], to = posB[mixerBot]
      const x1 = from.x + from.w * 0.82
      const x2 = to.x + to.w / 2
      const dipY = botY + bh + 24 + dSeq * 11
      dSeq++
      orthoPath(ctx, [[x1, botY + bh], [x1, dipY], [x2, dipY], [x2, botY + bh]], color, [3, 3])
    }
  }

  // ── Blocks + labels ──
  const drawRow = (blocks, pos) => {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i], p = pos[i]
      const color = b.type === 'fwh' && b.extrIdx != null
        ? EXTR_COLORS[b.extrIdx % EXTR_COLORS.length]
        : TYPE_STYLE[b.type].color
      drawShape(ctx, b.type, p.x, p.y, p.w, bh, color)
      ctx.fillStyle = color; ctx.font = '600 10px Inter'; ctx.textAlign = 'center'
      ctx.fillText(b.title, p.x + p.w / 2, p.y + (b.type === 'boiler' ? bh * 0.55 : bh * 0.44))
      if (b.sub) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '8.5px Inter'
        ctx.fillText(b.sub, p.x + p.w / 2, p.y + bh + 11)
      }
    }
  }
  drawRow(top, posT)
  drawRow(bot, posB)

  ctx.fillStyle = '#334155'; ctx.font = '8.5px Inter'; ctx.textAlign = 'left'
  ctx.fillText('— main loop (numbers = state points)   - - extraction   - - drain → mixer', 22, H - 5)
  ctx.restore()
}
