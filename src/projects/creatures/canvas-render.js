export function render(canvas, sim) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width / (window.devicePixelRatio || 1)
  const H = canvas.height / (window.devicePixelRatio || 1)

  ctx.fillStyle = '#0a0a0f'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const dpr = window.devicePixelRatio || 1
  ctx.save()
  ctx.scale(dpr, dpr)

  // Food
  for (const f of sim.foods) {
    ctx.beginPath()
    ctx.arc(f.pos.x, f.pos.y, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#22c55e88'
    ctx.fill()
  }

  // Creatures
  for (const c of sim.creatures) {
    const angle = Math.atan2(c.vel.y, c.vel.x)
    const energyRatio = Math.min(1, c.energy / 100)
    const alpha = 0.5 + energyRatio * 0.5

    ctx.save()
    ctx.translate(c.pos.x, c.pos.y)
    ctx.rotate(angle)

    // Body
    ctx.beginPath()
    ctx.moveTo(c.size, 0)
    ctx.lineTo(-c.size * 0.6, -c.size * 0.5)
    ctx.lineTo(-c.size * 0.3, 0)
    ctx.lineTo(-c.size * 0.6, c.size * 0.5)
    ctx.closePath()
    ctx.fillStyle = `hsla(${c.hue % 360}, 70%, 60%, ${alpha})`
    ctx.fill()

    // Energy indicator
    ctx.beginPath()
    ctx.arc(0, 0, c.size * 0.4, -Math.PI / 2, -Math.PI / 2 + energyRatio * Math.PI * 2)
    ctx.strokeStyle = `hsla(${c.hue % 360}, 90%, 80%, 0.8)`
    ctx.lineWidth = 1.5
    ctx.stroke()

    ctx.restore()
  }

  ctx.restore()
}
