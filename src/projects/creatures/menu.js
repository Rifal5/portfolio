import '../../styles/main.css'

document.querySelector('#app').innerHTML = `
<div style="max-width:800px;margin:0 auto;padding:4rem 1.5rem;">
  <a href="../../../index.html" style="color:#64748b;text-decoration:none;font-size:0.875rem;display:inline-block;margin-bottom:2rem;">← Back</a>

  <div style="margin-bottom:3rem;">
    <p style="color:#22c55e;font-size:0.875rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.75rem;">AI Creatures</p>
    <h1 style="font-size:2rem;font-weight:700;margin-bottom:0.75rem;">Choose a Simulation</h1>
    <p style="color:#64748b;line-height:1.6;">Two different takes on emergent behavior — classical flocking rules vs learned neural behavior.</p>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;">

    <a href="./boids.html" style="text-decoration:none;color:inherit;">
      <div class="panel" style="height:100%;transition:border-color 0.15s;cursor:pointer;"
           onmouseenter="this.style.borderColor='#22c55e66'" onmouseleave="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
          <span style="font-size:1.4rem;">🐟</span>
          <h2 style="font-size:1rem;font-weight:600;">Boids</h2>
          <span style="font-size:0.7rem;color:#22c55e;background:#22c55e18;padding:0.15rem 0.6rem;border-radius:999px;margin-left:auto;">Classic</span>
        </div>
        <p style="color:#64748b;font-size:0.85rem;line-height:1.6;margin-bottom:1rem;">
          The original Craig Reynolds algorithm. Three hand-coded rules — separation, alignment, cohesion — produce realistic flocking. No learning, pure emergent math.
        </p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <span style="font-size:0.75rem;color:#64748b;background:#1e1e2e;padding:0.15rem 0.6rem;border-radius:0.35rem;">Separation</span>
          <span style="font-size:0.75rem;color:#64748b;background:#1e1e2e;padding:0.15rem 0.6rem;border-radius:0.35rem;">Alignment</span>
          <span style="font-size:0.75rem;color:#64748b;background:#1e1e2e;padding:0.15rem 0.6rem;border-radius:0.35rem;">Cohesion</span>
        </div>
      </div>
    </a>

    <a href="./neural.html" style="text-decoration:none;color:inherit;">
      <div class="panel" style="height:100%;transition:border-color 0.15s;cursor:pointer;"
           onmouseenter="this.style.borderColor='#6366f166'" onmouseleave="this.style.borderColor='var(--border)'">
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.75rem;">
          <span style="font-size:1.4rem;">🧠</span>
          <h2 style="font-size:1rem;font-weight:600;">Neural Evolution</h2>
          <span style="font-size:0.7rem;color:#6366f1;background:#6366f118;padding:0.15rem 0.6rem;border-radius:999px;margin-left:auto;">New</span>
        </div>
        <p style="color:#64748b;font-size:0.85rem;line-height:1.6;margin-bottom:1rem;">
          Each creature runs a tiny neural net — random sensor inputs pass through weight matrices to produce movement. Survivors reproduce and mutate. Watch behavior improve across generations.
        </p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <span style="font-size:0.75rem;color:#64748b;background:#1e1e2e;padding:0.15rem 0.6rem;border-radius:0.35rem;">8→8→3 Network</span>
          <span style="font-size:0.75rem;color:#64748b;background:#1e1e2e;padding:0.15rem 0.6rem;border-radius:0.35rem;">Mutation</span>
          <span style="font-size:0.75rem;color:#64748b;background:#1e1e2e;padding:0.15rem 0.6rem;border-radius:0.35rem;">Save Weights</span>
        </div>
      </div>
    </a>

  </div>
</div>
`
