import '../../styles/main.css'
import { solveCycle } from './cycle-solver.js'
import { renderTS, renderSchematic } from './cycle-render.js'

// ── Cycle configuration (editable) ───────────────────────────────────────────
const cfg = {
  boilerP: 100,       // bar
  condenserP: 0.08,   // bar (8 kPa)
  inletT: 550,        // °C
  massFlow: 50,       // kg/s
  turbineEff: 0.90,
  pumpEff: 0.82,
  genEff: 0.92,
  ttd: 0,               // closed-FWH terminal temperature difference (°C)
  mixerPos: 'after',    // where closed-FWH drains rejoin: 'before' | 'after' the heaters
  // A modular list — reorder / add / remove. Reheats sit between turbine stages.
  components: [
    { type: 'turbine', exitP: 10 },
    { type: 'reheat', toT: 550 },
    { type: 'turbine', exitP: 0.08 },
  ],
}

const GLOBAL_FIELDS = [
  { key: 'boilerP', label: 'Boiler pressure', unit: 'bar', min: 5, max: 150, step: 1 },
  { key: 'inletT', label: 'Turbine inlet temp', unit: '°C', min: 200, max: 700, step: 5 },
  { key: 'condenserP', label: 'Condenser pressure', unit: 'bar', min: 0.04, max: 2, step: 0.01 },
  { key: 'massFlow', label: 'Mass flow', unit: 'kg/s', min: 1, max: 300, step: 1 },
  { key: 'turbineEff', label: 'Turbine efficiency', unit: '', min: 0.5, max: 1, step: 0.01 },
  { key: 'pumpEff', label: 'Pump efficiency', unit: '', min: 0.5, max: 1, step: 0.01 },
  { key: 'genEff', label: 'Generator efficiency', unit: '', min: 0.5, max: 1, step: 0.01 },
  { key: 'ttd', label: 'CFWH TTD', unit: '°C', min: 0, max: 10, step: 0.5 },
]

document.querySelector('#app').innerHTML = `
<div style="display:flex;flex-direction:column;height:100vh;background:#0a0a0f;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 1rem;border-bottom:1px solid #1e1e2e;flex-shrink:0;">
    <div style="display:flex;align-items:center;gap:1rem;">
      <a href="${import.meta.env.BASE_URL}index.html" style="color:#64748b;text-decoration:none;font-size:0.875rem;">← Simulations</a>
      <div style="display:flex;align-items:center;gap:0.6rem;">
        <h1 style="font-size:1rem;font-weight:700;color:#e2e8f0;">Rankine Cycle Builder</h1>
        <span style="font-size:0.7rem;color:#f59e0b;background:#f59e0b18;padding:0.1rem 0.5rem;border-radius:999px;">Thermodynamics</span>
      </div>
    </div>
    <div id="headline" style="font-size:0.75rem;color:#64748b;display:flex;gap:1.25rem;"></div>
  </div>

  <div style="display:flex;flex:1;min-height:0;">
    <!-- Left: builder -->
    <div style="width:300px;flex-shrink:0;border-right:1px solid #1e1e2e;overflow-y:auto;padding:0.7rem;display:flex;flex-direction:column;gap:0.9rem;">
      <div>
        <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;margin-bottom:0.5rem;">Operating conditions</p>
        <div id="global-fields" style="display:flex;flex-direction:column;gap:0.5rem;"></div>
        <div style="margin-top:0.5rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label style="font-size:0.72rem;color:#64748b;">Drain mixer position</label>
            <select id="sel-mixer" style="background:#12121a;color:#e2e8f0;border:1px solid #1e1e2e;border-radius:0.3rem;font-size:0.7rem;padding:0.15rem 0.3rem;">
              <option value="after">After FWHs (before boiler)</option>
              <option value="before">Before FWHs (after condenser)</option>
            </select>
          </div>
          <p style="font-size:0.62rem;color:#334155;margin-top:2px;">"Before" matches the report: mixer after the condensate pump, a pump after each CFWH stages the pressure up.</p>
        </div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
          <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;">Cycle components</p>
          <div style="display:flex;gap:0.3rem;">
            <button id="add-turbine" class="btn btn-ghost" style="font-size:0.65rem;padding:0.15rem 0.45rem;color:#a5b4fc;">+ Turbine</button>
            <button id="add-reheat" class="btn btn-ghost" style="font-size:0.65rem;padding:0.15rem 0.45rem;color:#fdba74;">+ Reheat</button>
            <button id="add-fwh" class="btn btn-ghost" style="font-size:0.65rem;padding:0.15rem 0.45rem;color:#fde047;">+ Open FWH</button>
            <button id="add-cfwh" class="btn btn-ghost" style="font-size:0.65rem;padding:0.15rem 0.45rem;color:#f0abfc;">+ Closed FWH</button>
          </div>
        </div>
        <p style="font-size:0.64rem;color:#334155;line-height:1.5;margin-bottom:0.5rem;">Boiler → components (in order) → condenser → feedwater train. The last turbine always exhausts to the condenser. A FWH placed after a turbine extracts steam at that turbine's exit pressure.</p>
        <div id="component-list" style="display:flex;flex-direction:column;gap:0.4rem;"></div>
        <button id="preset-report" class="btn btn-ghost" style="margin-top:0.6rem;font-size:0.68rem;padding:0.3rem 0.6rem;color:#f59e0b;border-color:#f59e0b55;width:100%;" title="4 turbines, 1 reheat, 2 feedwater heaters — the ME 555 report topology">⚡ Load report cycle (4T · reheat · 2 FWH)</button>
      </div>
    </div>

    <!-- Right: results -->
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
      <div id="error-bar" style="display:none;padding:0.5rem 1rem;background:#ef444422;color:#fca5a5;font-size:0.78rem;border-bottom:1px solid #ef444444;"></div>
      <div style="display:flex;flex:1;min-height:0;">
        <div style="flex:1;display:flex;flex-direction:column;border-right:1px solid #1e1e2e;">
          <p style="font-size:0.72rem;font-weight:600;color:#e2e8f0;padding:0.5rem 0.7rem 0;">Schematic</p>
          <canvas id="schematic" style="flex:1;width:100%;display:block;"></canvas>
          <p style="font-size:0.72rem;font-weight:600;color:#e2e8f0;padding:0 0.7rem;">T–s Diagram</p>
          <canvas id="ts" style="flex:1;width:100%;display:block;"></canvas>
        </div>
        <div style="width:320px;flex-shrink:0;overflow-y:auto;padding:0.7rem;">
          <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;margin-bottom:0.4rem;">Performance</p>
          <div id="perf" style="font-size:0.72rem;color:#94a3b8;"></div>
          <p style="font-size:0.75rem;font-weight:600;color:#e2e8f0;margin:0.9rem 0 0.4rem;">State points</p>
          <div id="states" style="font-size:0.68rem;color:#94a3b8;"></div>
        </div>
      </div>
    </div>
  </div>
</div>
`

const schematicCanvas = document.getElementById('schematic')
const tsCanvas = document.getElementById('ts')

// ── Global field inputs ───────────────────────────────────────────────────────
const gf = document.getElementById('global-fields')
gf.innerHTML = GLOBAL_FIELDS.map(f => `
  <div>
    <div style="display:flex;justify-content:space-between;">
      <label style="font-size:0.72rem;color:#64748b;">${f.label}</label>
      <span id="lbl-${f.key}" style="font-size:0.72rem;color:#e2e8f0;">${cfg[f.key]}${f.unit ? ' ' + f.unit : ''}</span>
    </div>
    <input type="range" id="in-${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${cfg[f.key]}" style="width:100%;">
  </div>`).join('')
for (const f of GLOBAL_FIELDS) {
  const el = document.getElementById(`in-${f.key}`)
  el.addEventListener('input', () => {
    cfg[f.key] = parseFloat(el.value)
    document.getElementById(`lbl-${f.key}`).textContent = `${cfg[f.key]}${f.unit ? ' ' + f.unit : ''}`
    recompute()
  })
}

// ── Component list ────────────────────────────────────────────────────────────
function renderComponents() {
  const list = document.getElementById('component-list')
  const turbineIdxs = cfg.components.map((c, i) => c.type === 'turbine' ? i : -1).filter(i => i >= 0)
  list.innerHTML = cfg.components.map((c, i) => {
    const isTurbine = c.type === 'turbine'
    const isLastTurbine = isTurbine && i === turbineIdxs[turbineIdxs.length - 1]
    const accent = isTurbine ? '#6366f1' : c.type === 'reheat' ? '#f97316' : c.type === 'cfwh' ? '#e879f9' : '#eab308'
    const name = isTurbine ? 'Turbine' : c.type === 'reheat' ? 'Reheater' : c.type === 'cfwh' ? 'Closed FWH' : 'Open FWH'
    const param = isTurbine
      ? (isLastTurbine
          ? `<span style="font-size:0.66rem;color:#64748b;">exits to condenser (${cfg.condenserP} bar)</span>`
          : `<label style="font-size:0.66rem;color:#64748b;">exit P</label>
             <input type="number" data-i="${i}" data-k="exitP" value="${c.exitP}" step="0.5" min="0.05" style="width:60px;background:#12121a;color:#e2e8f0;border:1px solid #1e1e2e;border-radius:4px;font-size:0.7rem;padding:1px 4px;"> <span style="font-size:0.66rem;color:#64748b;">bar</span>`)
      : c.type === 'reheat'
      ? `<label style="font-size:0.66rem;color:#64748b;">reheat to</label>
         <input type="number" data-i="${i}" data-k="toT" value="${c.toT}" step="10" min="100" style="width:60px;background:#12121a;color:#e2e8f0;border:1px solid #1e1e2e;border-radius:4px;font-size:0.7rem;padding:1px 4px;"> <span style="font-size:0.66rem;color:#64748b;">°C</span>`
      : c.type === 'cfwh'
      ? `<span style="font-size:0.66rem;color:#64748b;">extraction heats feedwater in tubes (TTD 0); drain pumped forward → mixing chamber</span>`
      : `<span style="font-size:0.66rem;color:#64748b;">extraction mixes directly into the feed line at extraction pressure</span>`
    return `
    <div class="panel" style="padding:0.4rem 0.5rem;border-left:2px solid ${accent};">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.3rem;">
        <span style="font-size:0.72rem;font-weight:600;color:${accent};">${i + 1}. ${name}</span>
        <span style="display:flex;gap:0.15rem;">
          <button data-move="up" data-i="${i}" class="btn btn-ghost" style="font-size:0.6rem;padding:0 0.35rem;" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-move="down" data-i="${i}" class="btn btn-ghost" style="font-size:0.6rem;padding:0 0.35rem;" ${i === cfg.components.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-remove="${i}" class="btn btn-ghost" style="font-size:0.6rem;padding:0 0.35rem;color:#ef4444;">✕</button>
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:0.3rem;">${param}</div>
    </div>`
  }).join('')

  list.querySelectorAll('input[data-k]').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = +inp.dataset.i, k = inp.dataset.k
      cfg.components[i][k] = parseFloat(inp.value)
      recompute()
    })
  })
  list.querySelectorAll('button[data-remove]').forEach(b => b.addEventListener('click', () => {
    cfg.components.splice(+b.dataset.remove, 1); renderComponents(); recompute()
  }))
  list.querySelectorAll('button[data-move]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.i, dir = b.dataset.move === 'up' ? -1 : 1, j = i + dir
    if (j < 0 || j >= cfg.components.length) return
    ;[cfg.components[i], cfg.components[j]] = [cfg.components[j], cfg.components[i]]
    renderComponents(); recompute()
  }))
}

document.getElementById('add-turbine').addEventListener('click', () => {
  cfg.components.push({ type: 'turbine', exitP: 1 }); renderComponents(); recompute()
})
document.getElementById('add-reheat').addEventListener('click', () => {
  cfg.components.push({ type: 'reheat', toT: cfg.inletT }); renderComponents(); recompute()
})
document.getElementById('add-fwh').addEventListener('click', () => {
  cfg.components.push({ type: 'fwh' }); renderComponents(); recompute()
})
document.getElementById('add-cfwh').addEventListener('click', () => {
  cfg.components.push({ type: 'cfwh' }); renderComponents(); recompute()
})
document.getElementById('sel-mixer').addEventListener('change', e => {
  cfg.mixerPos = e.target.value; recompute()
})

// ── Report preset: the ME 555 topology (4 turbines, reheat, 2 open FWHs) ──────
document.getElementById('preset-report').addEventListener('click', () => {
  Object.assign(cfg, {
    boilerP: 100, condenserP: 0.08, inletT: 700, massFlow: 51,
    turbineEff: 0.90, pumpEff: 0.82, genEff: 0.92,
    ttd: 0, mixerPos: 'before',   // Figure 1: mixer sits after the condensate pump, before the CFWHs
    components: [
      { type: 'turbine', exitP: 10 },
      { type: 'reheat', toT: 700 },
      { type: 'turbine', exitP: 7 },
      { type: 'cfwh' },
      { type: 'turbine', exitP: 1 },
      { type: 'cfwh' },
      { type: 'turbine', exitP: 0.08 },
    ],
  })
  // sync the sliders + labels to the new values
  for (const f of GLOBAL_FIELDS) {
    const el = document.getElementById(`in-${f.key}`)
    el.value = cfg[f.key]
    document.getElementById(`lbl-${f.key}`).textContent = `${cfg[f.key]}${f.unit ? ' ' + f.unit : ''}`
  }
  document.getElementById('sel-mixer').value = cfg.mixerPos
  renderComponents(); recompute()
})

// ── Compute + render ──────────────────────────────────────────────────────────
function fmt(n, d = 1) { return n == null ? '—' : n.toFixed(d) }

function recompute() {
  const result = solveCycle(cfg)
  const errBar = document.getElementById('error-bar')

  renderSchematic(schematicCanvas, cfg, result.error ? null : result)

  if (result.error) {
    errBar.style.display = 'block'; errBar.textContent = '⚠ ' + result.error
    document.getElementById('perf').innerHTML = ''
    document.getElementById('states').innerHTML = ''
    document.getElementById('headline').innerHTML = ''
    renderTS(tsCanvas, null)
    return
  }
  errBar.style.display = 'none'
  renderTS(tsCanvas, result)

  const p = result.perf
  document.getElementById('headline').innerHTML = `
    <span>η <strong style="color:#22c55e;">${(p.eta * 100).toFixed(1)}%</strong></span>
    <span>Net <strong style="color:#f59e0b;">${fmt(p.netPowerMW, 1)} MW</strong></span>
    <span>BWR <strong style="color:#e2e8f0;">${(p.bwr * 100).toFixed(1)}%</strong></span>
    ${p.exitQuality != null ? `<span>x<sub>exit</sub> <strong style="color:${p.exitQuality < 0.88 ? '#ef4444' : '#e2e8f0'};">${p.exitQuality.toFixed(3)}</strong></span>` : ''}`

  const rows = [
    ['Thermal efficiency', `${(p.eta * 100).toFixed(1)} %`],
    ['Net power', `${fmt(p.netPowerMW, 2)} MW`],
    ['Gross turbine power', `${fmt(p.grossPowerMW, 2)} MW`],
    ['Turbine work', `${fmt(p.wTurb)} kJ/kg`],
    ['Pump work', `${fmt(p.wPump, 2)} kJ/kg`],
    ['Back-work ratio', `${(p.bwr * 100).toFixed(1)} %`],
    ['Heat in (boiler)', `${fmt(p.qBoiler)} kJ/kg`],
    ['Heat in (reheat)', `${fmt(p.qReheat)} kJ/kg`],
    ['Heat rejected', `${fmt(p.qOut)} kJ/kg`],
    ['Turbine-exit quality', p.exitQuality != null ? p.exitQuality.toFixed(3) : 'superheated'],
  ]
  // extraction fractions from the feedwater-heater energy balances
  result.extractions.forEach((e, i) => {
    rows.push([`y${i + 1} — ${e.mode} FWH @ ${e.P < 1 ? e.P.toFixed(2) : e.P.toFixed(1)} bar`, e.y.toFixed(3)])
  })
  document.getElementById('perf').innerHTML = rows.map(([k, v]) => `
    <div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #12121a;">
      <span>${k}</span><span style="color:#e2e8f0;font-weight:500;">${v}</span></div>`).join('')

  document.getElementById('states').innerHTML = `
    <div style="display:grid;grid-template-columns:1.4fr 0.7fr 0.7fr 0.8fr 0.7fr;gap:2px;color:#475569;font-weight:600;font-size:0.64rem;border-bottom:1px solid #1e1e2e;padding-bottom:2px;">
      <span>state</span><span style="text-align:right;">P·bar</span><span style="text-align:right;">T·°C</span><span style="text-align:right;">h</span><span style="text-align:right;">x</span>
    </div>` +
    result.states.map((s, i) => `
    <div style="display:grid;grid-template-columns:1.4fr 0.7fr 0.7fr 0.8fr 0.7fr;gap:2px;padding:1px 0;">
      <span>${i + 1}. ${s.label}</span>
      <span style="text-align:right;">${s.P < 1 ? s.P.toFixed(2) : s.P.toFixed(0)}</span>
      <span style="text-align:right;">${s.T.toFixed(0)}</span>
      <span style="text-align:right;">${s.h.toFixed(0)}</span>
      <span style="text-align:right;">${s.x != null ? s.x.toFixed(2) : '—'}</span>
    </div>`).join('') +
    (result.drains || []).map(d => `
    <div style="display:grid;grid-template-columns:1.4fr 0.7fr 0.7fr 0.8fr 0.7fr;gap:2px;padding:1px 0;color:#e879f9aa;">
      <span>↳ ${d.label}</span>
      <span style="text-align:right;">${d.P < 1 ? d.P.toFixed(2) : d.P.toFixed(0)}</span>
      <span style="text-align:right;">${d.T.toFixed(0)}</span>
      <span style="text-align:right;">${d.h.toFixed(0)}</span>
      <span style="text-align:right;">y=${d.y.toFixed(3)}</span>
    </div>`).join('')
}

window.addEventListener('resize', recompute)
renderComponents()
recompute()
