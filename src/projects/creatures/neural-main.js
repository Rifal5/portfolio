import '../../styles/main.css'
import { NeuralSimulation, serializeCreature, deserializeCreature, GENOME_DEFAULTS, mutateGenome } from './neural-sim.js'
import { renderWorld, renderNetwork, renderPopChart, renderTrainingCurves } from './neural-render.js'
import { INPUT_LABELS, OUTPUT_LABELS, ARCH } from './neural-net.js'

document.querySelector('#app').innerHTML = `
<div style="display:flex;flex-direction:column;height:100vh;background:#0a0a0f;">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;border-bottom:1px solid #1e1e2e;flex-shrink:0;">
    <div style="display:flex;align-items:center;gap:1rem;">
      <a href="./index.html" style="color:#64748b;text-decoration:none;font-size:0.875rem;">← Simulations</a>
      <div style="display:flex;align-items:center;gap:0.6rem;">
        <h1 style="font-size:1rem;font-weight:700;color:#e2e8f0;">Neural Evolution</h1>
        <span style="font-size:0.7rem;color:#6366f1;background:#6366f118;padding:0.1rem 0.5rem;border-radius:999px;">${ARCH.join('→')} net</span>
      </div>
    </div>
    <div id="stat-bar" style="font-size:0.75rem;color:#64748b;display:flex;gap:1.25rem;"></div>
    <div style="display:flex;gap:0.4rem;">
      <button id="btn-pause" class="btn btn-ghost" style="font-size:0.75rem;padding:0.3rem 0.75rem;">Pause</button>
      <button id="btn-reset" class="btn btn-ghost" style="font-size:0.75rem;padding:0.3rem 0.75rem;">Reset</button>
      <button id="btn-generate" class="btn btn-ghost" style="font-size:0.75rem;padding:0.3rem 0.75rem;color:#a5b4fc;border-color:#6366f155;" title="Evolve populations in parallel, then load their champions to compete">⚡ Generate Champions</button>
      <button id="btn-champion" class="btn btn-ghost" style="font-size:0.75rem;padding:0.3rem 0.75rem;" title="Seed 6 new creatures from the best seen weights">Inject Champion</button>
      <button id="btn-save" class="btn btn-ghost" style="font-size:0.75rem;padding:0.3rem 0.75rem;" title="Save the selected creature (or the prey champion) as JSON">Save Creature</button>
      <label class="btn btn-ghost" style="font-size:0.75rem;padding:0.3rem 0.75rem;cursor:pointer;" title="Load creature snapshot from JSON">
        Load Creature<input id="inp-load" type="file" accept=".json" style="display:none;">
      </label>
    </div>
  </div>

  <!-- Main content -->
  <div style="display:flex;flex:1;min-height:0;">

    <!-- World canvas -->
    <div id="world-wrap" style="flex:1;position:relative;cursor:crosshair;">
      <canvas id="world-canvas" style="width:100%;height:100%;display:block;"></canvas>
      <div style="position:absolute;bottom:0.75rem;left:0.75rem;font-size:0.7rem;color:#334155;">Click any creature to inspect its network and genome →</div>
      <div id="rescue-badge" style="position:absolute;top:0.75rem;left:50%;transform:translateX(-50%);display:none;font-size:0.72rem;color:#fbbf24;background:#0a0a0fcc;border:1px solid #fbbf2455;padding:0.3rem 0.75rem;border-radius:999px;">⚙ Rescuing…</div>
    </div>

    <!-- Side panel -->
    <div style="width:290px;flex-shrink:0;border-left:1px solid #1e1e2e;display:flex;flex-direction:column;overflow-y:auto;">

      <!-- Neural net viz -->
      <div style="border-bottom:1px solid #1e1e2e;padding:0.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
          <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;">Network Inspector</p>
          <span id="sel-label" style="font-size:0.7rem;color:#64748b;">none selected</span>
        </div>
        <canvas id="net-canvas" style="width:100%;height:160px;border-radius:0.4rem;background:#12121a;display:block;"></canvas>
      </div>

      <!-- Live I/O -->
      <div style="border-bottom:1px solid #1e1e2e;padding:0.6rem;">
        <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;margin-bottom:0.5rem;">Live Inputs / Outputs</p>
        <div id="io-panel" style="font-size:0.7rem;color:#64748b;"></div>
      </div>

      <!-- Genome editor -->
      <div style="border-bottom:1px solid #1e1e2e;padding:0.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.4rem;">
          <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;">Genome Editor</p>
          <div style="display:flex;gap:0.25rem;">
            <button id="btn-copy-genome" class="btn btn-ghost" style="font-size:0.65rem;padding:0.15rem 0.45rem;">Copy</button>
            <button id="btn-apply-genome" class="btn btn-ghost" style="font-size:0.65rem;padding:0.15rem 0.45rem;">Apply</button>
          </div>
        </div>
        <textarea id="genome-editor" spellcheck="false" style="
          width:100%;height:170px;background:#12121a;color:#94a3b8;
          font-family:'Courier New',monospace;font-size:0.65rem;
          border:1px solid #1e1e2e;border-radius:0.4rem;
          padding:0.5rem;resize:none;line-height:1.55;
          box-sizing:border-box;outline:none;">Select a creature to view its genome</textarea>
        <p id="genome-status" style="font-size:0.65rem;color:#475569;margin-top:0.2rem;min-height:1em;"></p>
      </div>

      <!-- Evolution parameters -->
      <div style="border-bottom:1px solid #1e1e2e;padding:0.6rem;display:flex;flex-direction:column;gap:0.55rem;">
        <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;">Mutation — Brain (weights)</p>
        <div>
          <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Rate</label><span id="lbl-bmr" style="font-size:0.72rem;color:#a5b4fc;">12%</span></div>
          <input type="range" id="sl-bmr" min="1" max="50" step="1" value="12">
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Strength</label><span id="lbl-bms" style="font-size:0.72rem;color:#a5b4fc;">0.25</span></div>
          <input type="range" id="sl-bms" min="0.05" max="1.0" step="0.05" value="0.25">
        </div>

        <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;margin-top:0.25rem;">Mutation — Genome (body)</p>
        <div>
          <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Rate</label><span id="lbl-gmr" style="font-size:0.72rem;color:#86efac;">18%</span></div>
          <input type="range" id="sl-gmr" min="1" max="60" step="1" value="18">
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Strength</label><span id="lbl-gms" style="font-size:0.72rem;color:#86efac;">0.60</span></div>
          <input type="range" id="sl-gms" min="0.05" max="1.5" step="0.05" value="0.6">
        </div>

        <div style="margin-top:0.25rem;">
          <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Sim Speed (scrub ▶▶)</label><span id="lbl-sp" style="font-size:0.72rem;color:#e2e8f0;">1×</span></div>
          <input type="range" id="sl-sp" min="1" max="30" step="1" value="1">
        </div>

        <div style="margin-top:0.35rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="font-size:0.75rem;font-weight:600;color:#e2e8f0;">World size</label>
            <select id="sel-world" style="background:#12121a;color:#e2e8f0;border:1px solid #1e1e2e;border-radius:0.3rem;font-size:0.7rem;padding:0.15rem 0.3rem;">
              <option value="1">Standard</option>
              <option value="1.5">Large</option>
              <option value="2">Huge</option>
              <option value="2.6">Massive (~1000)</option>
            </select>
          </div>
          <p style="font-size:0.64rem;color:#334155;margin-top:2px;">Bigger = more space, creatures &amp; obstacles (zoomed out). Resets the world.</p>
        </div>

        <div>
          <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Obstacles</label><span id="lbl-ob" style="font-size:0.72rem;color:#94a3b8;">6</span></div>
          <input type="range" id="sl-ob" min="0" max="80" step="1" value="6">
        </div>

        <details style="margin-top:0.35rem;">
          <summary style="font-size:0.75rem;font-weight:600;color:#e2e8f0;cursor:pointer;list-style:revert;">Food supply ▾</summary>
          <div style="display:flex;flex-direction:column;gap:0.55rem;margin-top:0.5rem;">
            <div>
              <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Spawn rate</label><span id="lbl-fi" style="font-size:0.72rem;color:#fbbf24;">1 / 13 ticks</span></div>
              <input type="range" id="sl-fi" min="2" max="40" step="1" value="13">
              <p style="font-size:0.64rem;color:#334155;margin-top:1px;">Lower = faster food inflow → higher prey capacity</p>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Plant richness (energy/food)</label><span id="lbl-fr" style="font-size:0.72rem;color:#22c55e;">55</span></div>
              <input type="range" id="sl-fr" min="15" max="140" step="5" value="55">
              <p style="font-size:0.64rem;color:#334155;margin-top:1px;">Energy prey get per plant eaten</p>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Prey richness (energy/kill)</label><span id="lbl-pr" style="font-size:0.72rem;color:#ef4444;">90</span></div>
              <input type="range" id="sl-pr" min="20" max="200" step="5" value="90">
              <p style="font-size:0.64rem;color:#334155;margin-top:1px;">Energy predators get per prey caught</p>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;"><label style="font-size:0.72rem;color:#64748b;">Max food (density)</label><span id="lbl-fm" style="font-size:0.72rem;color:#fbbf24;">40</span></div>
              <input type="range" id="sl-fm" min="10" max="400" step="5" value="40">
              <p style="font-size:0.64rem;color:#334155;margin-top:1px;">Standing crop the world grows toward</p>
            </div>
          </div>
        </details>
      </div>

      <!-- Gen chart -->
      <div style="padding:0.6rem;flex:1;min-height:120px;">
        <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;">Population Dynamics</p>
        <canvas id="gen-canvas" style="width:100%;height:120px;display:block;background:#12121a;border-radius:0.4rem;"></canvas>
        <p style="font-size:0.68rem;color:#334155;margin-top:0.4rem;">Prey / predators / food over time — watch the predator–prey cycles</p>
      </div>

      <!-- Legend -->
      <div style="padding:0.6rem;border-top:1px solid #1e1e2e;">
        <p style="font-size:0.72rem;font-weight:600;color:#e2e8f0;margin-bottom:0.3rem;">Ecosystem</p>
        <div style="font-size:0.68rem;color:#94a3b8;line-height:1.6;margin-bottom:0.4rem;">
          <span style="color:#22c55e;">▸ Prey</span> eat green food &amp; flee predators ·
          <span style="color:#ef4444;">▶ Predators</span> (bigger chevrons) hunt prey ·
          <span style="color:#334155;">■ obstacles</span> block movement
        </div>
        <div style="font-size:0.68rem;color:#334155;line-height:1.5;">
          <span style="color:#f59e0b;">★</span> Champion ·
          <span style="color:#6366f1;">◉</span> Selected ·
          Color = family lineage ·
          Energy arc = health ·
          White dots = eyes
        </div>
      </div>
    </div>

  </div>

  <!-- Generate Champions modal -->
  <div id="champ-modal" style="display:none;position:fixed;inset:0;background:#0a0a0fdd;z-index:50;align-items:center;justify-content:center;">
    <div style="background:#12121a;border:1px solid #1e1e2e;border-radius:0.75rem;padding:1.5rem;width:440px;max-width:92vw;box-shadow:0 20px 60px #000a;">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
        <span style="font-size:1.1rem;">⚡</span>
        <h2 style="font-size:1.05rem;font-weight:700;color:#e2e8f0;">Generate Champions</h2>
      </div>
      <p style="font-size:0.78rem;color:#64748b;line-height:1.55;margin-bottom:1.1rem;">
        Each island coevolves <span style="color:#22c55e;">prey</span> and <span style="color:#ef4444;">predators</span> together in parallel — an arms race. Prey are selected for food eaten, predators for prey caught, over the chosen number of generations. The best of each species from every island is then released into the arena. Uses the brain &amp; genome mutation settings from the side panel.
      </p>

      <div style="margin-bottom:0.9rem;">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.2rem;">
          <label style="font-size:0.78rem;color:#94a3b8;">Champions (islands)</label>
          <span id="lbl-islands" style="font-size:0.78rem;color:#e2e8f0;font-weight:600;">4</span>
        </div>
        <input type="range" id="sl-islands" min="1" max="20" step="1" value="4" style="width:100%;">
      </div>

      <div style="margin-bottom:1.1rem;">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.2rem;">
          <label style="font-size:0.78rem;color:#94a3b8;">Evolution time (generations)</label>
          <span id="lbl-gens" style="font-size:0.78rem;color:#e2e8f0;font-weight:600;">20</span>
        </div>
        <input type="range" id="sl-gens" min="5" max="100" step="5" value="20" style="width:100%;">
      </div>

      <div id="champ-progress" style="display:none;flex-direction:column;gap:0.4rem;margin-bottom:1.1rem;max-height:200px;overflow-y:auto;"></div>

      <!-- Results: learning curves + summary, shown when training completes -->
      <div id="champ-results" style="display:none;flex-direction:column;gap:0.6rem;margin-bottom:1.1rem;">
        <canvas id="champ-curve" style="width:100%;height:150px;display:block;border-radius:0.4rem;border:1px solid #1e1e2e;"></canvas>
        <div id="champ-summary" style="font-size:0.72rem;color:#94a3b8;line-height:1.5;"></div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
        <button id="btn-champ-cancel" class="btn btn-ghost" style="font-size:0.8rem;padding:0.4rem 0.9rem;">Cancel</button>
        <button id="btn-champ-run" class="btn" style="font-size:0.8rem;padding:0.4rem 0.9rem;background:#6366f1;color:#fff;border:none;">Run Tournament</button>
        <button id="btn-champ-load" class="btn" style="display:none;font-size:0.8rem;padding:0.4rem 0.9rem;background:#22c55e;color:#04210f;border:none;font-weight:600;">Load Champions →</button>
      </div>
    </div>
  </div>

</div>
`

// ── Canvas setup ───────────────────────────────────────────────────────────────
const worldCanvas = document.getElementById('world-canvas')
const netCanvas = document.getElementById('net-canvas')
const genCanvas = document.getElementById('gen-canvas')

let sim, paused = false, animId, selectedCreature = null

function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.parentElement.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
}

function resizeSideCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(canvas.clientWidth * dpr)
  const h = Math.round(canvas.clientHeight * dpr)
  // setting .width resets the whole canvas — only do it when the size changed
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
}

function initSim() {
  resizeCanvas(worldCanvas)
  const dpr = window.devicePixelRatio || 1
  sim = new NeuralSimulation(worldCanvas.width / dpr, worldCanvas.height / dpr)
  sim.onExtinction = tryRescue   // wire the rescue trigger onto each new sim
}

// ── I/O panel ──────────────────────────────────────────────────────────────────
const SHORT_IN = INPUT_LABELS
const SHORT_OUT = OUTPUT_LABELS

function updateIOPanel(c) {
  if (!c) { document.getElementById('io-panel').innerHTML = ''; return }

  const inRows = Array.from(c.inputs).map((v, i) => {
    const mag = Math.min(100, Math.abs(v) * 100)
    const col = v < 0 ? '#ef4444' : '#6366f1'
    return `
    <div style="display:flex;gap:0.3rem;align-items:center;margin-bottom:2px;">
      <span style="width:62px;color:#475569;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${SHORT_IN[i]}</span>
      <div style="flex:1;height:5px;background:#1e1e2e;border-radius:2px;">
        <div style="height:100%;background:${col};border-radius:2px;width:${mag}%;"></div>
      </div>
      <span style="width:30px;text-align:right;">${v.toFixed(2)}</span>
    </div>`}).join('')

  const outRows = Array.from(c.lastOutputs).map((v, i) => {
    const pct = Math.round(((v + 1) / 2) * 100)
    return `<div style="display:flex;gap:0.3rem;align-items:center;margin-bottom:2px;">
      <span style="width:62px;color:#f59e0b;flex-shrink:0;">${SHORT_OUT[i]}</span>
      <div style="flex:1;height:5px;background:#1e1e2e;border-radius:2px;">
        <div style="height:100%;background:#f59e0b;border-radius:2px;width:${pct}%;"></div>
      </div>
      <span style="width:30px;text-align:right;">${v.toFixed(2)}</span>
    </div>`
  }).join('')

  document.getElementById('io-panel').innerHTML =
    `<div style="margin-bottom:0.3rem;color:#475569;font-weight:600;font-size:0.65rem;letter-spacing:0.05em;">INPUTS</div>${inRows}` +
    `<div style="margin:0.3rem 0;color:#64748b;font-weight:600;font-size:0.65rem;letter-spacing:0.05em;border-top:1px solid #1e1e2e;padding-top:0.3rem;">OUTPUTS</div>${outRows}`
}

// ── Genome editor ──────────────────────────────────────────────────────────────
const genomeEditor = document.getElementById('genome-editor')
const genomeStatus = document.getElementById('genome-status')
// Dirty flag: set when user types so the render loop doesn't overwrite in-progress edits
let genomeEdited = false

genomeEditor.addEventListener('input', () => { genomeEdited = true; genomeStatus.textContent = '' })

function updateGenomeEditor(c) {
  if (!c || genomeEdited) return
  genomeEditor.value = JSON.stringify(c.genome, null, 2)
  genomeStatus.textContent = ''
}

function clearGenomeEditor() {
  genomeEdited = false
  genomeEditor.value = 'Select a creature to view its genome'
  genomeStatus.textContent = ''
}

document.getElementById('btn-apply-genome').addEventListener('click', () => {
  if (!selectedCreature) { genomeStatus.style.color = '#ef4444'; genomeStatus.textContent = 'No creature selected'; return }
  try {
    const parsed = JSON.parse(genomeEditor.value)
    // Require colorH (may not be in GENOME_DEFAULTS since it's randomised)
    if (typeof parsed.colorH !== 'number') throw new Error('Missing colorH')
    for (const key of Object.keys(GENOME_DEFAULTS)) {
      if (typeof parsed[key] !== 'number') throw new Error(`Missing or non-number: ${key}`)
    }
    selectedCreature.genome = { ...GENOME_DEFAULTS, ...parsed }
    genomeEdited = false   // allow live updates to resume
    genomeStatus.style.color = '#22c55e'
    genomeStatus.textContent = 'Applied!'
    setTimeout(() => { if (genomeStatus.textContent === 'Applied!') genomeStatus.textContent = '' }, 1500)
  } catch (e) {
    genomeStatus.style.color = '#ef4444'
    genomeStatus.textContent = e.message
  }
})

document.getElementById('btn-copy-genome').addEventListener('click', () => {
  if (!selectedCreature) return
  navigator.clipboard.writeText(JSON.stringify(selectedCreature.genome, null, 2))
  const btn = document.getElementById('btn-copy-genome')
  btn.textContent = 'Copied!'
  setTimeout(() => { btn.textContent = 'Copy' }, 1500)
})

// ── Render loop ────────────────────────────────────────────────────────────────
// Canvases repaint every frame; DOM panels (innerHTML churn) and side-canvas
// size checks only every few frames — invisible to the eye, kinder to the GC.
let frameN = 0
function loop() {
  if (!paused) sim.step()

  renderWorld(worldCanvas, sim, selectedCreature)

  if (frameN % 3 === 0) {
    resizeSideCanvas(netCanvas)
    resizeSideCanvas(genCanvas)
  }
  renderNetwork(netCanvas, selectedCreature)
  renderPopChart(genCanvas, sim.popHistory)

  if (frameN % 3 === 0) {
    const s = sim.stats
    document.getElementById('stat-bar').innerHTML = `
      <span>🟢 Prey <strong style="color:#22c55e;">${s.prey}</strong></span>
      <span>🔺 Predators <strong style="color:#ef4444;">${s.predators}</strong></span>
      <span>Max gen <strong style="color:#a5b4fc;">${s.maxGen}</strong></span>
      <span>Avg food <strong style="color:#86efac;">${s.avgFood}</strong></span>
      <span style="color:#334155;">tick ${s.tick}</span>
    `
    if (selectedCreature) {
      const role = selectedCreature.role === 'predator' ? 'Predator' : 'Prey'
      const fit = selectedCreature.role === 'predator' ? `prey:${selectedCreature.preyEaten}` : `food:${selectedCreature.foodEaten}`
      document.getElementById('sel-label').textContent = `${role} G${selectedCreature.generation} · ${fit}`
      updateIOPanel(selectedCreature)
      updateGenomeEditor(selectedCreature)
    }
  }
  frameN++

  // Deselect if creature died
  if (selectedCreature && !sim.creatures.includes(selectedCreature)) {
    selectedCreature = null
    genomeEdited = false
    document.getElementById('sel-label').textContent = 'died'
    updateIOPanel(null)
    clearGenomeEditor()
  }

  animId = requestAnimationFrame(loop)
}

// ── Interaction ────────────────────────────────────────────────────────────────
worldCanvas.addEventListener('click', e => {
  const rect = worldCanvas.getBoundingClientRect()
  // Map screen → world coordinates (the whole world is drawn across the canvas).
  const mx = (e.clientX - rect.left) * (sim.w / rect.width)
  const my = (e.clientY - rect.top) * (sim.h / rect.height)
  let best = null, bestDist = 30 * sim.worldScale + 12
  for (const c of sim.creatures) {
    const d = Math.hypot(c.x - mx, c.y - my)
    if (d < bestDist) { bestDist = d; best = c }
  }
  selectedCreature = best
  genomeEdited = false   // reset dirty flag when switching creatures
  if (!best) {
    document.getElementById('sel-label').textContent = 'none selected'
    updateIOPanel(null)
    clearGenomeEditor()
  }
})

document.getElementById('btn-pause').addEventListener('click', () => {
  paused = !paused
  document.getElementById('btn-pause').textContent = paused ? 'Resume' : 'Pause'
})
document.getElementById('btn-reset').addEventListener('click', () => {
  selectedCreature = null
  genomeEdited = false
  clearGenomeEditor()
  initSim()
})
document.getElementById('btn-champion').addEventListener('click', () => sim.injectChampion())

document.getElementById('btn-save').addEventListener('click', () => {
  // Prefer the currently selected creature; otherwise fall back to the prey champion.
  const c = selectedCreature || sim.champion
  if (!c) return alert('Nothing to save yet — click a creature, or let the simulation run.')
  const role = c.role || 'prey'
  const blob = new Blob([serializeCreature(c)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${role}-gen${c.generation}.json`
  a.click()
})

document.getElementById('inp-load').addEventListener('change', e => {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = ev => {
    try {
      const data = deserializeCreature(ev.target.result)
      selectedCreature = null
      genomeEdited = false
      // Seed into the matching role so a loaded predator loads AS a predator
      // (loadChampions fills the other role with a viable random population).
      if (data.role === 'predator') sim.loadChampions([], [data])
      else sim.loadChampions([data], [])
      document.getElementById('sel-label').textContent = 'none selected'
      clearGenomeEditor()
    } catch (err) {
      alert('Invalid file: ' + err.message)
    }
  }
  reader.readAsText(file)
})

function wireSlider(id, lblId, setter, fmt) {
  const sl = document.getElementById(id)
  sl.addEventListener('input', () => {
    setter(parseFloat(sl.value))
    document.getElementById(lblId).textContent = fmt(parseFloat(sl.value))
  })
}
wireSlider('sl-bmr', 'lbl-bmr', v => { sim.params.brainMutationRate = v / 100 }, v => v + '%')
wireSlider('sl-bms', 'lbl-bms', v => { sim.params.brainMutationStrength = v }, v => v.toFixed(2))
wireSlider('sl-gmr', 'lbl-gmr', v => { sim.params.genomeMutationRate = v / 100 }, v => v + '%')
wireSlider('sl-gms', 'lbl-gms', v => { sim.params.genomeMutationStrength = v }, v => v.toFixed(2))
wireSlider('sl-sp', 'lbl-sp', v => { sim.params.speed = v }, v => v + '×')
wireSlider('sl-fi', 'lbl-fi', v => { sim.foodSpawnInterval = v }, v => '1 / ' + v + ' ticks')
wireSlider('sl-fr', 'lbl-fr', v => { sim.foodRichness = v }, v => String(v))
wireSlider('sl-pr', 'lbl-pr', v => { sim.meatRichness = v }, v => String(v))
wireSlider('sl-fm', 'lbl-fm', v => { sim.maxFood = v }, v => String(v))
wireSlider('sl-ob', 'lbl-ob', v => { sim.setObstacleCount(v) }, v => String(v))

// Sync the area-derived environment sliders (max food, obstacle count) to the sim.
function syncEnvSliders() {
  const fm = document.getElementById('sl-fm')
  fm.value = sim.maxFood; document.getElementById('lbl-fm').textContent = String(sim.maxFood)
  const ob = document.getElementById('sl-ob')
  ob.value = sim.obstacleCount; document.getElementById('lbl-ob').textContent = String(sim.obstacleCount)
}

// World size — regenerates the world at a new scale, then re-syncs the sliders.
document.getElementById('sel-world').addEventListener('change', e => {
  selectedCreature = null
  genomeEdited = false
  clearGenomeEditor()
  sim.setWorldScale(parseFloat(e.target.value))
  syncEnvSliders()
})

// ── Generate Champions tournament ────────────────────────────────────────────
const champModal = document.getElementById('champ-modal')
const champProgress = document.getElementById('champ-progress')
const champResults = document.getElementById('champ-results')
const champCurve = document.getElementById('champ-curve')
const champSummary = document.getElementById('champ-summary')
const btnRun = document.getElementById('btn-champ-run')
const btnCancel = document.getElementById('btn-champ-cancel')
const btnLoad = document.getElementById('btn-champ-load')
let activeWorkers = []
let running = false
let lastPreyChamps = []
let lastPredChamps = []
let lastHistories = []   // per-island array of { gen, preyBest, predBest, preyAvg, predAvg }

document.getElementById('sl-islands').addEventListener('input', e => {
  document.getElementById('lbl-islands').textContent = e.target.value
})
document.getElementById('sl-gens').addEventListener('input', e => {
  document.getElementById('lbl-gens').textContent = e.target.value
})

document.getElementById('btn-generate').addEventListener('click', () => {
  champModal.style.display = 'flex'
})

function terminateWorkers() {
  activeWorkers.forEach(w => w.terminate())
  activeWorkers = []
}

function closeModal() {
  terminateWorkers()
  running = false
  champModal.style.display = 'none'
  champProgress.style.display = 'none'
  champProgress.innerHTML = ''
  champResults.style.display = 'none'
  btnRun.style.display = ''
  btnRun.disabled = false
  btnRun.textContent = 'Run Tournament'
  btnCancel.textContent = 'Cancel'
  btnLoad.style.display = 'none'
}

btnCancel.addEventListener('click', closeModal)

// Aggregate per-island histories into prey/predator best-fitness curves
// (max across islands at each generation).
function buildCurveSeries() {
  const maxGen = Math.max(0, ...lastHistories.flatMap(h => h.map(p => p.gen)))
  const preyPts = [], predPts = []
  for (let g = 1; g <= maxGen; g++) {
    let prey = 0, pred = 0, seen = false
    for (const h of lastHistories) {
      const row = h.find(p => p.gen === g)
      if (row) { prey = Math.max(prey, row.preyBest); pred = Math.max(pred, row.predBest); seen = true }
    }
    if (seen) { preyPts.push({ gen: g, val: prey }); predPts.push({ gen: g, val: pred }) }
  }
  return [
    { label: 'Prey (food eaten)', color: '#22c55e', points: preyPts },
    { label: 'Predator (prey caught)', color: '#ef4444', points: predPts },
  ]
}

// Show the results screen: coevolution learning curves + summary, with a Load button.
function showResults() {
  champProgress.style.display = 'none'
  champResults.style.display = 'flex'
  btnRun.style.display = 'none'
  btnLoad.style.display = ''
  btnCancel.textContent = 'Discard'

  const dpr = window.devicePixelRatio || 1
  const rect = champCurve.getBoundingClientRect()
  champCurve.width = rect.width * dpr
  champCurve.height = rect.height * dpr
  renderTrainingCurves(champCurve, buildCurveSeries())

  const preyBest = Math.max(0, ...lastPreyChamps.map(c => c ? c.foodEaten : 0))
  const predBest = Math.max(0, ...lastPredChamps.map(c => c ? c.preyEaten : 0))
  const nIslands = lastHistories.length
  champSummary.innerHTML =
    `<strong style="color:#e2e8f0;">${nIslands} islands coevolved.</strong> ` +
    `Best prey foraged <strong style="color:#86efac;">${preyBest}</strong> food; ` +
    `best predator caught <strong style="color:#fca5a5;">${predBest}</strong> prey. ` +
    `Both species (plus families) will be released into the arena.`
}

btnLoad.addEventListener('click', () => {
  const prey = lastPreyChamps.filter(Boolean)
  const preds = lastPredChamps.filter(Boolean)
  if (prey.length || preds.length) {
    selectedCreature = null
    genomeEdited = false
    clearGenomeEditor()
    sim.loadChampions(prey, preds)
  }
  closeModal()
})

function renderProgress(rows) {
  champProgress.innerHTML = rows.map((r, i) => {
    const frac = r.done ? 1 : (r.totalGen ? Math.min(1, r.gen / r.totalGen) : 0)
    const barColor = r.done ? '#22c55e' : '#6366f1'
    return `<div style="font-size:0.72rem;color:#94a3b8;">
      <div style="display:flex;justify-content:space-between;margin-bottom:2px;">
        <span>Island ${i + 1}${r.done ? ' ✓' : ''}</span>
        <span style="color:#64748b;">gen ${r.gen || 0}/${r.totalGen || '?'} · <span style="color:#22c55e;">prey ${r.preyBest || 0}</span> · <span style="color:#ef4444;">pred ${r.predBest || 0}</span></span>
      </div>
      <div style="height:6px;background:#1e1e2e;border-radius:3px;overflow:hidden;">
        <div style="height:100%;width:${Math.round(frac * 100)}%;background:${barColor};transition:width 0.2s;"></div>
      </div>
    </div>`
  }).join('')
}

btnRun.addEventListener('click', () => {
  if (running) return
  running = true
  const nIslands = parseInt(document.getElementById('sl-islands').value, 10)
  const nGens = parseInt(document.getElementById('sl-gens').value, 10)

  const rows = Array.from({ length: nIslands }, () => ({ gen: 0, totalGen: nGens, preyBest: 0, predBest: 0, done: false }))
  champResults.style.display = 'none'
  champProgress.style.display = 'flex'
  renderProgress(rows)
  btnRun.disabled = true
  btnRun.textContent = 'Evolving…'
  btnCancel.textContent = 'Stop'

  const preyChamps = new Array(nIslands).fill(null)
  const predChamps = new Array(nIslands).fill(null)
  const histories = Array.from({ length: nIslands }, () => [])
  let remaining = nIslands
  terminateWorkers()

  for (let i = 0; i < nIslands; i++) {
    const worker = new Worker(new URL('./champion-worker.js', import.meta.url), { type: 'module' })
    activeWorkers.push(worker)
    worker.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') {
        rows[m.id].gen = m.gen
        rows[m.id].totalGen = m.totalGen
        rows[m.id].preyBest = m.preyBest
        rows[m.id].predBest = m.predBest
        histories[m.id].push({ gen: m.gen, preyBest: m.preyBest, predBest: m.predBest, preyAvg: m.preyAvg, predAvg: m.predAvg })
        renderProgress(rows)
      } else if (m.type === 'done') {
        preyChamps[m.id] = m.prey
        predChamps[m.id] = m.predator
        rows[m.id].done = true
        rows[m.id].gen = rows[m.id].totalGen
        rows[m.id].preyBest = m.prey ? m.prey.foodEaten : rows[m.id].preyBest
        rows[m.id].predBest = m.predator ? m.predator.preyEaten : rows[m.id].predBest
        renderProgress(rows)
        worker.terminate()
        remaining--
        if (remaining === 0) {
          running = false
          lastPreyChamps = preyChamps
          lastPredChamps = predChamps
          lastHistories = histories
          showResults()
        }
      }
    }
    worker.postMessage({
      // Train in a fixed, dense world (viewport size) regardless of the live world
      // scale — a small dense arena learns far faster than a huge sparse one, and
      // distance-based behaviour transfers to any world size.
      id: i, generations: nGens, width: sim.baseW, height: sim.baseH,
      mut: {
        brainMutationRate: sim.params.brainMutationRate,
        brainMutationStrength: sim.params.brainMutationStrength,
        genomeMutationRate: sim.params.genomeMutationRate,
        genomeMutationStrength: sim.params.genomeMutationStrength,
      },
    })
  }
})

// ── On-extinction rescue evolution ───────────────────────────────────────────
// When a role crashes, the arena keeps running (a light respawn holds the line)
// while a background worker evolves that role — seeded from the current champions
// of BOTH species, so the comeback lineage is trained against the current rival —
// then injects the improved lineage back in.
const rescueActive = { prey: false, predator: false }
const rescueCooldownUntil = { prey: 0, predator: 0 }
const rescueWorkers = []

function updateRescueBadge() {
  const roles = Object.keys(rescueActive).filter(r => rescueActive[r])
  const el = document.getElementById('rescue-badge')
  if (roles.length) { el.textContent = `⚙ Rescuing ${roles.join(' & ')} — evolving a comeback…`; el.style.display = '' }
  else el.style.display = 'none'
}

function tryRescue(role) {
  if (rescueActive[role]) return
  if (sim.tick < rescueCooldownUntil[role]) return
  const preySeed = sim.champion, predSeed = sim.predChampion
  const targetSeed = role === 'prey' ? preySeed : predSeed
  if (!targetSeed) return   // nothing to evolve from yet

  rescueActive[role] = true
  updateRescueBadge()

  const worker = new Worker(new URL('./champion-worker.js', import.meta.url), { type: 'module' })
  rescueWorkers.push(worker)
  worker.onmessage = (e) => {
    if (e.data.type !== 'done') return
    const data = role === 'prey' ? e.data.prey : e.data.predator
    if (data) sim.injectEvolved(role, data, role === 'prey' ? 12 : 6)
    worker.terminate()
    const idx = rescueWorkers.indexOf(worker)
    if (idx >= 0) rescueWorkers.splice(idx, 1)
    rescueActive[role] = false
    rescueCooldownUntil[role] = sim.tick + 400   // don't re-trigger immediately
    updateRescueBadge()
  }
  const seedFor = s => s ? { weights: Array.from(s.weights), genome: s.genome } : null
  worker.postMessage({
    id: 0, generations: 40, width: sim.baseW, height: sim.baseH,
    mut: {
      brainMutationRate: sim.params.brainMutationRate,
      brainMutationStrength: sim.params.brainMutationStrength,
      genomeMutationRate: sim.params.genomeMutationRate,
      genomeMutationStrength: sim.params.genomeMutationStrength,
    },
    seedPrey: seedFor(preySeed),
    seedPredator: seedFor(predSeed),
  })
}

window.addEventListener('resize', () => {
  cancelAnimationFrame(animId)
  resizeCanvas(worldCanvas)
  const dpr = window.devicePixelRatio || 1
  sim.resize(worldCanvas.width / dpr, worldCanvas.height / dpr)
  loop()
})

initSim()
syncEnvSliders()
loop()
