// Live neural-network visualization. Draws the evolved policy as a layered graph:
// input nodes (labeled, showing the live sensor encoding), hidden layers, and the
// single force output. Edges are coloured by weight sign (cyan +, red −) with
// opacity ∝ |weight|; nodes are filled by their live activation (green +, red −).
// Redrawn each frame from the controller's `viz` so you watch the network think.

export function renderNet(canvas, viz) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0) return
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')
  ctx.save(); ctx.scale(dpr, dpr)
  const W = rect.width, H = rect.height
  ctx.clearRect(0, 0, W, H)

  const arch = viz.arch, nL = arch.length
  const padL = 46, padR = 40, padT = 10, padB = 10
  const colX = l => padL + (W - padL - padR) * (l / (nL - 1))
  const nodeY = (l, j) => padT + (H - padT - padB) * ((j + 0.5) / arch[l])

  // Edges (skip the faintest for clarity).
  for (let l = 0; l < nL - 1; l++) {
    for (let j = 0; j < arch[l + 1]; j++) {
      const y1 = nodeY(l + 1, j), x1 = colX(l + 1)
      for (let i = 0; i < arch[l]; i++) {
        const w = viz.weightAt(l, j, i)
        const a = Math.min(1, Math.abs(w) / 2)
        if (a < 0.08) continue
        ctx.strokeStyle = w >= 0 ? `rgba(56,189,248,${a * 0.5})` : `rgba(239,68,68,${a * 0.5})`
        ctx.lineWidth = 0.4 + a
        ctx.beginPath(); ctx.moveTo(colX(l), nodeY(l, i)); ctx.lineTo(x1, y1); ctx.stroke()
      }
    }
  }

  // Nodes, filled by activation.
  for (let l = 0; l < nL; l++) {
    for (let j = 0; j < arch[l]; j++) {
      const act = viz.activations[l] ? viz.activations[l][j] : 0
      const v = Math.max(-1, Math.min(1, act))
      ctx.beginPath(); ctx.arc(colX(l), nodeY(l, j), 4, 0, Math.PI * 2)
      ctx.fillStyle = v >= 0 ? `rgba(34,197,94,${0.25 + 0.75 * v})` : `rgba(239,68,68,${0.25 + 0.75 * -v})`
      ctx.fill(); ctx.strokeStyle = '#334155'; ctx.lineWidth = 0.5; ctx.stroke()
    }
  }

  // Input labels (left) + output label (right).
  ctx.font = '8px Inter, sans-serif'; ctx.textBaseline = 'middle'
  ctx.fillStyle = '#64748b'; ctx.textAlign = 'right'
  for (let j = 0; j < arch[0]; j++) ctx.fillText(viz.labels[j], padL - 7, nodeY(0, j))
  ctx.textAlign = 'left'; ctx.fillStyle = '#e2e8f0'
  const out = viz.activations[nL - 1] ? viz.activations[nL - 1][0] : 0
  ctx.fillText(`force ${(out >= 0 ? '+' : '')}${out.toFixed(2)}`, colX(nL - 1) + 8, nodeY(nL - 1, 0))
  ctx.restore()
}
