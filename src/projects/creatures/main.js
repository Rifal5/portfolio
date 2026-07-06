import '../../styles/main.css'
import { Simulation } from './simulation.js'
import { render } from './canvas-render.js'

document.querySelector('#app').innerHTML = `
<div style="display:flex;flex-direction:column;height:100vh;padding:1rem;gap:1rem;">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
    <div style="display:flex;align-items:center;gap:1rem;">
      <a href="./index.html" style="color:#64748b;text-decoration:none;font-size:0.875rem;">← Simulations</a>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <h1 style="font-size:1.25rem;font-weight:700;">AI Creatures</h1>
        <span style="font-size:0.7rem;font-weight:500;color:#22c55e;background:#22c55e18;padding:0.15rem 0.6rem;border-radius:999px;">Emergent Behavior</span>
      </div>
    </div>
    <div style="display:flex;gap:0.5rem;">
      <button id="btn-pause" class="btn btn-ghost">Pause</button>
      <button id="btn-reset" class="btn btn-ghost">Reset</button>
    </div>
  </div>

  <div style="display:flex;gap:1rem;flex:1;min-height:0;">
    <!-- Canvas -->
    <div style="flex:1;position:relative;border-radius:0.75rem;overflow:hidden;border:1px solid #1e1e2e;">
      <canvas id="sim-canvas" style="width:100%;height:100%;display:block;"></canvas>
      <div id="stats" style="position:absolute;top:0.75rem;left:0.75rem;font-size:0.75rem;color:#64748b;display:flex;gap:1rem;background:#0a0a0fcc;padding:0.4rem 0.75rem;border-radius:0.5rem;border:1px solid #1e1e2e;"></div>
    </div>

    <!-- Controls -->
    <div style="width:200px;flex-shrink:0;display:flex;flex-direction:column;gap:0.75rem;">
      <div class="panel" style="flex:1;display:flex;flex-direction:column;gap:0.85rem;">
        <p style="font-size:0.8rem;font-weight:600;color:#e2e8f0;">Behavior Weights</p>

        <div>
          <div style="display:flex;justify-content:space-between;"><label>Speed</label><span id="lbl-speed" style="font-size:0.8rem;color:#e2e8f0;font-weight:500;">1.0×</span></div>
          <input type="range" id="sl-speed" min="0.2" max="3" step="0.1" value="1">
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;"><label>Separation</label><span id="lbl-sep" style="font-size:0.8rem;color:#e2e8f0;font-weight:500;">1.0×</span></div>
          <input type="range" id="sl-sep" min="0" max="3" step="0.1" value="1">
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;"><label>Alignment</label><span id="lbl-aln" style="font-size:0.8rem;color:#e2e8f0;font-weight:500;">1.0×</span></div>
          <input type="range" id="sl-aln" min="0" max="3" step="0.1" value="1">
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;"><label>Cohesion</label><span id="lbl-coh" style="font-size:0.8rem;color:#e2e8f0;font-weight:500;">1.0×</span></div>
          <input type="range" id="sl-coh" min="0" max="3" step="0.1" value="1">
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;"><label>Metabolism</label><span id="lbl-meta" style="font-size:0.8rem;color:#e2e8f0;font-weight:500;">1.0×</span></div>
          <input type="range" id="sl-meta" min="0.1" max="4" step="0.1" value="1">
        </div>
      </div>

      <div class="panel" style="font-size:0.75rem;color:#64748b;line-height:1.6;">
        <p style="font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;font-size:0.8rem;">How it works</p>
        <p>Each creature has <strong style="color:#e2e8f0;">energy</strong>. It seeks food to survive, and reproduces when full — passing traits to offspring.</p>
        <p style="margin-top:0.5rem;">Flocking emerges from three forces: <em>separate</em>, <em>align</em>, <em>cohere</em>.</p>
      </div>
    </div>
  </div>
</div>
`

const canvas = document.getElementById('sim-canvas')
let sim, paused = false, animId

function initCanvas() {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  if (!sim) {
    sim = new Simulation(rect.width, rect.height)
  } else {
    sim.resize(rect.width, rect.height)
  }
}

function loop() {
  if (!paused) sim.step()
  render(canvas, sim)

  const s = sim.stats
  document.getElementById('stats').innerHTML = `
    <span>🟢 Pop: <strong style="color:#e2e8f0;">${s.population}</strong></span>
    <span>Gen: <strong style="color:#6366f1;">${s.avgGen.toFixed(1)}</strong></span>
    <span>Born: <strong style="color:#22c55e;">${s.born}</strong></span>
    <span>Died: <strong style="color:#ef4444;">${s.died}</strong></span>
    <span>Tick: ${sim.tick}</span>
  `
  animId = requestAnimationFrame(loop)
}

function wireSlider(id, lblId, key, fmt) {
  const sl = document.getElementById(id)
  sl.addEventListener('input', () => {
    sim.params[key] = parseFloat(sl.value)
    document.getElementById(lblId).textContent = fmt(sim.params[key])
  })
}

document.getElementById('btn-pause').addEventListener('click', () => {
  paused = !paused
  document.getElementById('btn-pause').textContent = paused ? 'Resume' : 'Pause'
})
document.getElementById('btn-reset').addEventListener('click', () => sim.reset())

wireSlider('sl-speed', 'lbl-speed', 'speed', v => v.toFixed(1) + '×')
wireSlider('sl-sep',   'lbl-sep',   'separation', v => v.toFixed(1) + '×')
wireSlider('sl-aln',   'lbl-aln',   'alignment',  v => v.toFixed(1) + '×')
wireSlider('sl-coh',   'lbl-coh',   'cohesion',   v => v.toFixed(1) + '×')
wireSlider('sl-meta',  'lbl-meta',  'metabolism',  v => v.toFixed(1) + '×')

window.addEventListener('resize', () => {
  cancelAnimationFrame(animId)
  initCanvas()
  loop()
})

initCanvas()
loop()
