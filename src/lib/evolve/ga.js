// Generic neuroevolution engine — the tournament-selection + elitism + Gaussian
// mutation loop from the creatures champion-worker, but with the environment
// factored out behind a pluggable `evaluate(weights) -> fitness`. Pure and
// synchronous so it runs headlessly (node harness / offline training) or inside
// a Web Worker unchanged.

export function evolve({
  paramCount, randomParams, mutate, evaluate,
  pop = 48, gens = 60, elite = 4, tournamentK = 3,
  mut = { rate: 0.14, strength: 0.3 },
  seed = null, onProgress = null,
}) {
  // Initial population: optional seed (a champion to refine) + random the rest.
  let population = []
  for (let i = 0; i < pop; i++) {
    population.push(seed && i === 0 ? new Float32Array(seed) : randomParams())
  }

  let best = { weights: population[0], fitness: -Infinity, gen: 0 }
  const history = []

  for (let g = 0; g < gens; g++) {
    const scored = population.map(w => ({ w, f: evaluate(w) }))
    scored.sort((a, b) => b.f - a.f)
    if (scored[0].f > best.fitness) best = { weights: new Float32Array(scored[0].w), fitness: scored[0].f, gen: g }
    const avg = scored.reduce((s, x) => s + x.f, 0) / scored.length
    history.push({ gen: g, best: scored[0].f, avg })
    if (onProgress) onProgress({ gen: g, gens, best: scored[0].f, avg })

    // Next generation: keep the elite, fill the rest by tournament + mutation.
    const next = scored.slice(0, elite).map(s => s.w)
    while (next.length < pop) {
      const parent = tournament(scored, tournamentK)
      next.push(mutate(parent, mut.rate, mut.strength))
    }
    population = next
  }

  return { best, history }
}

function tournament(scored, k) {
  let winner = null
  for (let i = 0; i < k; i++) {
    const c = scored[(Math.random() * scored.length) | 0]
    if (!winner || c.f > winner.f) winner = c
  }
  return winner.w
}
