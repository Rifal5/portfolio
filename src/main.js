import './styles/main.css'

const projects = [
  {
    id: 'rankine',
    title: 'Rankine Cycle',
    tag: 'Thermodynamics',
    description: 'Interactive steam power cycle simulator. Adjust boiler pressure, condenser pressure, and superheat temperature to see live efficiency, work output, and P-V diagrams.',
    tech: ['SVG', 'Canvas', 'Steam Tables'],
    href: `${import.meta.env.BASE_URL}src/projects/rankine/index.html`,
    color: '#f59e0b',
  },
  {
    id: 'creatures',
    title: 'AI Creatures',
    tag: 'Emergent Behavior',
    description: 'A 2D canvas simulation of autonomous agents with flocking, food-seeking, and reproduction. Watch complex group behavior emerge from simple per-creature rules.',
    tech: ['Canvas 2D', 'Boids', 'Energy System'],
    href: `${import.meta.env.BASE_URL}src/projects/creatures/index.html`,
    color: '#22c55e',
  },
  {
    id: 'robot-arm',
    title: 'Robot Arm — Pick & Place',
    tag: 'Inverse Kinematics',
    description: 'Drive a 4-DOF articulated arm with WASD and pick up colored boxes with the spacebar. Analytic IK with real joint types and limits — revolute yaw base, pitch hinges, prismatic gripper.',
    tech: ['Three.js', 'Analytic IK', 'Joint limits'],
    href: `${import.meta.env.BASE_URL}src/projects/robot-arm/index.html`,
    color: '#6366f1',
  },
]

document.querySelector('#app').innerHTML = `
<div style="max-width:900px;margin:0 auto;padding:4rem 1.5rem;">
  <header style="margin-bottom:4rem;">
    <p style="color:var(--accent);font-size:0.875rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.75rem;">Portfolio</p>
    <h1 style="font-size:2.5rem;font-weight:700;line-height:1.15;margin-bottom:1rem;">Interactive Simulations</h1>
    <p style="color:var(--muted);font-size:1.1rem;max-width:480px;line-height:1.6;">
      Three browser-based technical demos — physics, AI behavior, and 3D visualization.
    </p>
  </header>

  <div style="display:grid;gap:1.25rem;">
    ${projects.map(p => `
    <a href="${p.href}" style="display:block;text-decoration:none;color:inherit;">
      <div class="panel" style="display:flex;gap:1.5rem;align-items:flex-start;transition:border-color 0.15s;cursor:pointer;"
           onmouseenter="this.style.borderColor='${p.color}44'" onmouseleave="this.style.borderColor='var(--border)'">
        <div style="width:3px;min-height:80px;border-radius:2px;background:${p.color};flex-shrink:0;margin-top:2px;"></div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem;">
            <h2 style="font-size:1.1rem;font-weight:600;">${p.title}</h2>
            <span style="font-size:0.7rem;font-weight:500;color:${p.color};background:${p.color}18;padding:0.15rem 0.6rem;border-radius:999px;">${p.tag}</span>
          </div>
          <p style="color:var(--muted);font-size:0.9rem;line-height:1.6;margin-bottom:0.75rem;">${p.description}</p>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            ${p.tech.map(t => `<span style="font-size:0.75rem;color:var(--muted);background:var(--border);padding:0.15rem 0.6rem;border-radius:0.35rem;">${t}</span>`).join('')}
          </div>
        </div>
        <div style="color:var(--muted);font-size:1.2rem;flex-shrink:0;padding-top:0.25rem;">→</div>
      </div>
    </a>
    `).join('')}
  </div>
</div>
`
