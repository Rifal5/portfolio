import { ARCH, N_LAYERS, INPUT_LABELS, OUTPUT_LABELS, weightAt } from './neural-net.js'

function creatureColor(genome, alpha = 1) {
  return `hsla(${genome.colorH.toFixed(0)}, ${genome.colorS.toFixed(0)}%, ${genome.colorL.toFixed(0)}%, ${alpha})`
}

export function renderWorld(canvas, sim, selectedCreature) {
  const dpr = window.devicePixelRatio || 1
  const cssW = canvas.width / dpr
  // Zoom to fit the whole (possibly larger) world into the canvas.
  const fit = cssW / sim.w
  const W = sim.w
  const H = sim.h
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.scale(dpr * fit, dpr * fit)

  ctx.fillStyle = '#0a0a0f'
  ctx.fillRect(0, 0, W, H)

  // Obstacles
  for (const o of sim.obstacles) {
    ctx.beginPath()
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2)
    ctx.fillStyle = '#161622'
    ctx.fill()
    ctx.strokeStyle = '#2a2a3c'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  // Food
  ctx.fillStyle = '#22c55e'
  for (const f of sim.foods) {
    if (!f.eaten) { ctx.beginPath(); ctx.arc(f.x, f.y, 3.5, 0, Math.PI * 2); ctx.fill() }
  }

  // Selected creature: vision arcs from physically-separated eyes
  const sel = selectedCreature
  if (sel) {
    const { eyeAngle, eyeFov, eyeSeparation, perceptionRange } = sel.genome
    const eyeOff = (eyeAngle * Math.PI) / 180
    const halfFov = (eyeFov * Math.PI) / 360
    const range = perceptionRange
    const sep = eyeSeparation / 2
    const lEyeX = sel.x + Math.sin(sel.angle) * sep
    const lEyeY = sel.y - Math.cos(sel.angle) * sep
    const rEyeX = sel.x - Math.sin(sel.angle) * sep
    const rEyeY = sel.y + Math.cos(sel.angle) * sep

    ctx.beginPath()
    ctx.arc(sel.x, sel.y, range, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(99,102,241,0.08)'
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = 'rgba(139,92,246,0.08)'; ctx.strokeStyle = 'rgba(139,92,246,0.4)'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(lEyeX, lEyeY)
    ctx.arc(lEyeX, lEyeY, range, sel.angle - eyeOff - halfFov, sel.angle - eyeOff + halfFov, false)
    ctx.closePath(); ctx.fill(); ctx.stroke()

    ctx.fillStyle = 'rgba(99,102,241,0.08)'; ctx.strokeStyle = 'rgba(99,102,241,0.4)'
    ctx.beginPath(); ctx.moveTo(rEyeX, rEyeY)
    ctx.arc(rEyeX, rEyeY, range, sel.angle + eyeOff - halfFov, sel.angle + eyeOff + halfFov, false)
    ctx.closePath(); ctx.fill(); ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.beginPath(); ctx.arc(lEyeX, lEyeY, 2.5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(rEyeX, rEyeY, 2.5, 0, Math.PI * 2); ctx.fill()
  }

  // Creatures — prey are arrows, predators are larger chevrons with a ring
  for (const c of sim.creatures) {
    const isSel = c === selectedCreature
    const isPred = c.role === 'predator'
    const energyRatio = Math.max(0, c.energy / 160)
    const alpha = 0.4 + energyRatio * 0.6
    const sz = (isPred ? 7 : 5) + energyRatio * 2
    const sep = (c.genome?.eyeSeparation ?? 14) / 2

    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.rotate(c.angle)

    ctx.beginPath()
    if (isPred) {
      // sharper, longer chevron
      ctx.moveTo(sz * 2.1, 0)
      ctx.lineTo(-sz, -sz * 0.85)
      ctx.lineTo(-sz * 0.2, 0)
      ctx.lineTo(-sz, sz * 0.85)
    } else {
      ctx.moveTo(sz * 1.8, 0)
      ctx.lineTo(-sz, -sz * 0.7)
      ctx.lineTo(-sz * 0.4, 0)
      ctx.lineTo(-sz, sz * 0.7)
    }
    ctx.closePath()
    ctx.fillStyle = creatureColor(c.genome, alpha)
    ctx.fill()

    if (isPred) {
      ctx.strokeStyle = `hsla(${c.genome.colorH}, 85%, 65%, 0.9)`
      ctx.lineWidth = 1
      ctx.stroke()
    }
    if (isSel || c.isChampion) {
      ctx.strokeStyle = isSel ? '#6366f1' : '#f59e0b'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.beginPath(); ctx.arc(sz * 0.7, -sep, 1.5, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(sz * 0.7, sep, 1.5, 0, Math.PI * 2); ctx.fill()

    ctx.beginPath()
    ctx.arc(0, 0, sz * 0.55, -Math.PI / 2, -Math.PI / 2 + energyRatio * Math.PI * 2)
    ctx.strokeStyle = creatureColor(c.genome, 0.85)
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.restore()

    if (isSel) {
      ctx.fillStyle = '#e2e8f0'
      ctx.font = '10px Inter'
      ctx.textAlign = 'center'
      ctx.fillText(`${isPred ? 'Predator' : 'Prey'} G${c.generation}`, c.x, c.y - 16)
    }
  }

  ctx.restore()
}

// Generalized network inspector — draws an arbitrary number of layers (ARCH).
export function renderNetwork(canvas, creature) {
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const W = canvas.width / dpr
  const H = canvas.height / dpr
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, W, H)

  if (!creature) {
    ctx.fillStyle = '#64748b'
    ctx.font = '12px Inter'
    ctx.textAlign = 'center'
    ctx.fillText('Click a creature to inspect its network', W / 2, H / 2)
    ctx.restore()
    return
  }

  const acts = creature.activations
  const padX = 30, padY = 12
  const colW = (W - padX * 2) / (N_LAYERS - 1)
  const nodeR = Math.min(6, (H - padY * 2) / (Math.max(...ARCH) * 1.8))

  const nodeX = l => padX + l * colW
  const nodeY = (count, i) => {
    const spacing = Math.min((H - padY * 2) / Math.max(1, count - 1), 16)
    return H / 2 - spacing * (count - 1) / 2 + spacing * i
  }

  // Connections, layer by layer
  for (let l = 0; l < N_LAYERS - 1; l++) {
    const nIn = ARCH[l], nOut = ARCH[l + 1]
    for (let j = 0; j < nOut; j++) {
      for (let i = 0; i < nIn; i++) {
        const w = weightAt(creature.weights, l, j, i)
        const a = Math.min(0.7, Math.abs(w) * 0.5)
        if (a < 0.05) continue
        ctx.beginPath()
        ctx.moveTo(nodeX(l), nodeY(nIn, i))
        ctx.lineTo(nodeX(l + 1), nodeY(nOut, j))
        ctx.strokeStyle = w > 0 ? `rgba(99,102,241,${a})` : `rgba(239,68,68,${a})`
        ctx.lineWidth = Math.min(1.8, Math.abs(w) * 0.7)
        ctx.stroke()
      }
    }
  }

  // Nodes
  for (let l = 0; l < N_LAYERS; l++) {
    const count = ARCH[l]
    for (let i = 0; i < count; i++) {
      const act = acts[l][i]
      ctx.beginPath()
      ctx.arc(nodeX(l), nodeY(count, i), nodeR, 0, Math.PI * 2)
      ctx.fillStyle = act < 0
        ? `rgba(239,68,68,${0.3 + Math.min(1, Math.abs(act)) * 0.6})`
        : `rgba(99,102,241,${0.3 + Math.min(1, Math.abs(act)) * 0.6})`
      ctx.fill()
      ctx.strokeStyle = l === N_LAYERS - 1 ? '#f59e0b' : '#334155'
      ctx.lineWidth = 1.25
      ctx.stroke()
    }
  }

  // Labels: output layer always; input layer only when few enough to fit (the
  // retina has too many inputs — those are read in the Live Inputs panel instead).
  ctx.font = '7.5px Inter'
  ctx.fillStyle = '#94a3b8'
  const lastL = N_LAYERS - 1
  if (ARCH[0] <= 14) {
    ctx.textAlign = 'right'
    for (let i = 0; i < ARCH[0]; i++) ctx.fillText(INPUT_LABELS[i], nodeX(0) - nodeR - 2, nodeY(ARCH[0], i) + 2.5)
  } else {
    ctx.save(); ctx.translate(nodeX(0) - nodeR - 3, H / 2); ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'; ctx.fillStyle = '#475569'; ctx.fillText(`retina (${ARCH[0]} in)`, 0, 0); ctx.restore()
  }
  ctx.fillStyle = '#94a3b8'
  ctx.textAlign = 'left'
  for (let i = 0; i < ARCH[lastL]; i++) ctx.fillText(OUTPUT_LABELS[i], nodeX(lastL) + nodeR + 2, nodeY(ARCH[lastL], i) + 2.5)

  ctx.restore()
}

// Live population dynamics: prey / predators / food counts over time. Reveals the
// predator–prey cycles and the food-limited carrying capacity at a glance.
export function renderPopChart(canvas, history) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.width / dpr
  const H = canvas.height / dpr
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, W, H)

  if (!history || history.length < 2) {
    ctx.fillStyle = '#334155'
    ctx.font = '11px Inter'
    ctx.textAlign = 'center'
    ctx.fillText('Gathering population data…', W / 2, H / 2)
    ctx.restore()
    return
  }

  const series = [
    { key: 'prey', label: 'Prey', color: '#22c55e' },
    { key: 'pred', label: 'Predators', color: '#ef4444' },
    { key: 'food', label: 'Food', color: '#f59e0b' },
  ]
  const maxVal = Math.max(1, ...history.flatMap(p => [p.prey, p.pred, p.food]))
  const pad = { top: 16, right: 8, bottom: 8, left: 26 }
  const pw = W - pad.left - pad.right
  const ph = H - pad.top - pad.bottom
  const n = history.length
  const px = i => pad.left + (i / (n - 1)) * pw
  const py = v => pad.top + ph - (v / maxVal) * ph

  ctx.fillStyle = '#64748b'; ctx.font = '9px Inter'; ctx.textAlign = 'right'
  for (let i = 0; i <= 2; i++) {
    const y = pad.top + ph - (i / 2) * ph
    ctx.fillText(Math.round((maxVal * i) / 2), pad.left - 4, y + 3)
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + pw, y)
    ctx.strokeStyle = '#1e1e2e'; ctx.lineWidth = 1; ctx.stroke()
  }

  for (const s of series) {
    ctx.beginPath()
    history.forEach((p, i) => { const x = px(i), y = py(p[s.key]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.6
    ctx.stroke()
  }

  // Legend with current values
  ctx.font = '9px Inter'; ctx.textAlign = 'left'
  const cur = history[history.length - 1]
  let lx = pad.left
  for (const s of series) {
    ctx.fillStyle = s.color
    ctx.fillRect(lx, pad.top - 11, 8, 3)
    ctx.fillStyle = '#94a3b8'
    const txt = `${s.label} ${cur[s.key]}`
    ctx.fillText(txt, lx + 11, pad.top - 8)
    lx += 11 + ctx.measureText(txt).width + 12
  }
  ctx.restore()
}

// Tournament results: labeled learning curves. `series` is an array of
// { label, color, points: [{ gen, val }] } — e.g. prey vs predator fitness.
export function renderTrainingCurves(canvas, series) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.width / dpr
  const H = canvas.height / dpr
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0a0a0f'; ctx.fillRect(0, 0, W, H)

  const live = series.filter(s => s.points && s.points.length)
  if (!live.length) { ctx.restore(); return }

  const maxGen = Math.max(1, ...live.flatMap(s => s.points.map(p => p.gen)))
  const maxVal = Math.max(1, ...live.flatMap(s => s.points.map(p => p.val)))
  const pad = { top: 16, right: 10, bottom: 18, left: 28 }
  const pw = W - pad.left - pad.right
  const ph = H - pad.top - pad.bottom
  const px = gen => pad.left + (gen / maxGen) * pw
  const py = v => pad.top + ph - (v / maxVal) * ph

  ctx.fillStyle = '#64748b'; ctx.font = '9px Inter'; ctx.textAlign = 'right'
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + ph - (i / 3) * ph
    ctx.fillText(Math.round((maxVal * i) / 3), pad.left - 4, y + 3)
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + pw, y)
    ctx.strokeStyle = '#1e1e2e'; ctx.lineWidth = 1; ctx.stroke()
  }

  for (const s of live) {
    ctx.beginPath()
    s.points.forEach((p, k) => { const x = px(p.gen), y = py(p.val); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.8
    ctx.stroke()
  }

  ctx.fillStyle = '#64748b'; ctx.font = '8px Inter'; ctx.textAlign = 'left'
  ctx.fillText('gen 1', pad.left, pad.top + ph + 11)
  ctx.textAlign = 'right'; ctx.fillText(`gen ${maxGen}`, pad.left + pw, pad.top + ph + 11)

  // Legend
  ctx.font = '9px Inter'; ctx.textAlign = 'left'
  let lx = pad.left
  for (const s of live) {
    ctx.fillStyle = s.color
    ctx.fillRect(lx, pad.top - 9, 8, 3)
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(s.label, lx + 11, pad.top - 6)
    lx += 13 + ctx.measureText(s.label).width + 14
  }
  ctx.restore()
}
