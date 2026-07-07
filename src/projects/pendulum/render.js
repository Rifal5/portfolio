import { PARAMS } from './physics.js'

const BG = '#0a0a0f'

// World-to-pixel scale: fit the track (±trackHalfWidth, plus margin for the
// cart and a fully horizontal pole) inside the canvas width.
function scaleFor(W, p) {
  const worldSpan = p.trackHalfWidth * 2 + 2 * p.poleHalfLength * 2 + 1.2
  return W / worldSpan
}

export function render(canvas, state, opts = {}) {
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

  const p = opts.params || PARAMS
  const scale = scaleFor(W, p)
  const originX = W / 2
  const trackY = H * 0.62

  const wx = x => originX + x * scale
  const wy = y => trackY - y * scale

  // Track rail
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(wx(-p.trackHalfWidth - 0.35), trackY)
  ctx.lineTo(wx(p.trackHalfWidth + 0.35), trackY)
  ctx.stroke()
  // end stops
  ctx.strokeStyle = '#334155'
  ctx.lineWidth = 6
  for (const ex of [-p.trackHalfWidth, p.trackHalfWidth]) {
    ctx.beginPath()
    ctx.moveTo(wx(ex), trackY - 14)
    ctx.lineTo(wx(ex), trackY + 14)
    ctx.stroke()
  }
  // center mark
  ctx.strokeStyle = '#334155aa'
  ctx.setLineDash([3, 4])
  ctx.beginPath(); ctx.moveTo(wx(0), trackY - 20); ctx.lineTo(wx(0), trackY + 20); ctx.stroke()
  ctx.setLineDash([])

  const cartW = 0.42 * scale, cartH = 0.26 * scale
  const cx = wx(state.x), cy = trackY

  // Pole (drawn under the cart cap so the pivot reads cleanly)
  const poleLen = p.poleHalfLength * 2 * scale
  const tipX = cx + Math.sin(state.theta) * poleLen
  const tipY = cy - Math.cos(state.theta) * poleLen
  const upright = Math.abs(((state.theta + Math.PI) % (2 * Math.PI)) - Math.PI) < 0.25
  ctx.strokeStyle = upright ? '#22c55e' : '#f59e0b'
  ctx.lineWidth = 9
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx, cy - cartH * 0.1)
  ctx.lineTo(tipX, tipY)
  ctx.stroke()
  // bob at the tip
  ctx.beginPath()
  ctx.arc(tipX, tipY, 8, 0, Math.PI * 2)
  ctx.fillStyle = upright ? '#4ade80' : '#fbbf24'
  ctx.fill()

  // Cart body
  ctx.fillStyle = '#12121a'
  ctx.strokeStyle = '#6366f1'
  ctx.lineWidth = 1.5
  roundRect(ctx, cx - cartW / 2, cy - cartH / 2, cartW, cartH, 6)
  ctx.fill(); ctx.stroke()
  // wheels
  ctx.fillStyle = '#334155'
  for (const dx of [-cartW * 0.3, cartW * 0.3]) {
    ctx.beginPath()
    ctx.arc(cx + dx, cy + cartH / 2, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  // pivot dot
  ctx.beginPath()
  ctx.arc(cx, cy - cartH * 0.1, 4, 0, Math.PI * 2)
  ctx.fillStyle = '#e2e8f0'
  ctx.fill()

  // Applied-force arrow on the cart
  if (opts.force && Math.abs(opts.force) > 0.15) {
    const dir = Math.sign(opts.force)
    const len = Math.min(1, Math.abs(opts.force) / p.forceMax) * 46
    const ax = cx + dir * (cartW / 2 + 6)
    ctx.strokeStyle = '#38bdf8'
    ctx.fillStyle = '#38bdf8'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(ax, cy)
    ctx.lineTo(ax + dir * len, cy)
    ctx.stroke()
    ctx.beginPath()
    const hx = ax + dir * len
    ctx.moveTo(hx, cy)
    ctx.lineTo(hx - dir * 7, cy - 5)
    ctx.lineTo(hx - dir * 7, cy + 5)
    ctx.closePath()
    ctx.fill()
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
