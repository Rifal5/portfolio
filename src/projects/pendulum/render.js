// Canvas renderer for the cart-pole. Draws the track, the cart, and the pole as
// a chain of links (one link for the single pole, two for the double) via the
// plant's renderLinks(state). In realistic mode it also draws a faint "ghost"
// pole from the estimator's reconstructed state, so you can literally see the
// observer's error — the ghost lags/wobbles slightly behind the true pole.

const BG = '#0a0a0f'

function scaleFor(W, plant) {
  const p = plant.PARAMS
  const worldSpan = p.trackHalfWidth * 2 + 2 * plant.meta.reach + 1.2
  return W / worldSpan
}

function linkUpright(theta) {
  let a = (theta + Math.PI) % (2 * Math.PI)
  if (a < 0) a += 2 * Math.PI
  return Math.abs(a - Math.PI) < 0.25
}

// Draw a link chain. `ghost` renders it in a flat grey (the estimator ghost);
// otherwise each link is coloured green/amber by its OWN uprightness.
function drawChain(ctx, cx, cy, links, scale, { width, alpha, ghost }) {
  ctx.globalAlpha = alpha
  ctx.lineCap = 'round'
  let x = cx, y = cy
  for (const lk of links) {
    const tipX = x + Math.sin(lk.theta) * lk.len * scale
    const tipY = y - Math.cos(lk.theta) * lk.len * scale
    const up = linkUpright(lk.theta)
    ctx.strokeStyle = ghost ? '#64748b' : (up ? '#22c55e' : '#f59e0b')
    ctx.lineWidth = width
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tipX, tipY); ctx.stroke()
    ctx.beginPath(); ctx.arc(tipX, tipY, width * 0.85, 0, Math.PI * 2)
    ctx.fillStyle = ghost ? '#64748b' : (up ? '#4ade80' : '#fbbf24')
    ctx.fill()
    x = tipX; y = tipY
  }
  ctx.globalAlpha = 1
}

export function render(canvas, plant, state, opts = {}) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.save()
  ctx.scale(dpr, dpr)
  const W = rect.width, H = rect.height
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  const p = plant.PARAMS
  const scale = scaleFor(W, plant)
  const originX = W / 2
  const trackY = H * 0.62
  const wx = x => originX + x * scale

  // Track rail + end stops + centre mark
  ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 4; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(wx(-p.trackHalfWidth - 0.35), trackY); ctx.lineTo(wx(p.trackHalfWidth + 0.35), trackY); ctx.stroke()
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 6
  for (const ex of [-p.trackHalfWidth, p.trackHalfWidth]) {
    ctx.beginPath(); ctx.moveTo(wx(ex), trackY - 14); ctx.lineTo(wx(ex), trackY + 14); ctx.stroke()
  }
  ctx.strokeStyle = '#334155aa'; ctx.setLineDash([3, 4])
  ctx.beginPath(); ctx.moveTo(wx(0), trackY - 20); ctx.lineTo(wx(0), trackY + 20); ctx.stroke()
  ctx.setLineDash([])

  const cartW = 0.42 * scale, cartH = 0.26 * scale
  const cx = wx(state.x), cy = trackY
  const pivotY = cy - cartH * 0.1

  // Estimator ghost (behind the true pole), if provided.
  if (opts.estimate) {
    drawChain(ctx, wx(opts.estimate.x), pivotY, plant.renderLinks(opts.estimate), scale,
      { width: 7, alpha: 0.35, ghost: true })
  }

  // True pole chain — each link coloured by its own uprightness.
  drawChain(ctx, cx, pivotY, plant.renderLinks(state), scale, { width: 9, alpha: 1 })

  // Cart body + wheels + pivot
  ctx.fillStyle = '#12121a'; ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 1.5
  roundRect(ctx, cx - cartW / 2, cy - cartH / 2, cartW, cartH, 6)
  ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#334155'
  for (const dx of [-cartW * 0.3, cartW * 0.3]) {
    ctx.beginPath(); ctx.arc(cx + dx, cy + cartH / 2, 5, 0, Math.PI * 2); ctx.fill()
  }
  ctx.beginPath(); ctx.arc(cx, pivotY, 4, 0, Math.PI * 2); ctx.fillStyle = '#e2e8f0'; ctx.fill()

  // Applied-force arrow
  if (opts.force && Math.abs(opts.force) > 0.15) {
    const dir = Math.sign(opts.force)
    const len = Math.min(1, Math.abs(opts.force) / p.forceMax) * 46
    const ax = cx + dir * (cartW / 2 + 6)
    ctx.strokeStyle = '#38bdf8'; ctx.fillStyle = '#38bdf8'; ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(ax, cy); ctx.lineTo(ax + dir * len, cy); ctx.stroke()
    const hx = ax + dir * len
    ctx.beginPath(); ctx.moveTo(hx, cy); ctx.lineTo(hx - dir * 7, cy - 5); ctx.lineTo(hx - dir * 7, cy + 5); ctx.closePath(); ctx.fill()
  }

  ctx.restore()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
