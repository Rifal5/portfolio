// Headless coevolution worker — one independent "island" evolves PREY and
// PREDATORS together in the same world (an arms race), and returns the best of
// each. Several of these run in parallel (one per OS thread).
//
// Prey fitness blends foraging and SURVIVAL (time until first caught), biased
// toward survival. This dampens two kinds of luck: stumbling into a food cluster
// (rewarded less because you must also survive) and simply spawning far from a
// predator (rewarded less because you must also forage).
import { NeuralCreature, mutateGenome } from './neural-sim.js'
import { mutate } from './neural-net.js'

const PREY_POP = 22
const PRED_POP = 8
const EVAL_TICKS = 1600
const PREY_ELITE = 4
const PRED_ELITE = 2
const FOOD_MAX = 45
const PREY_START_E = 150
const PRED_START_E = 150         // equal to prey — only diet differs
const CATCH_R = 11

// Prey fitness = food eaten + (survival fraction) · SURV_W. SURV_W is set so the
// survival term (max ~30) is a bit larger than typical food intake (~20) → biased
// to survival, while food stays decisive enough that pure hiders don't win.
const SURV_W = 30

function makeFoods(w, h) {
  return Array.from({ length: FOOD_MAX }, () => ({ x: Math.random() * w, y: Math.random() * h, eaten: false }))
}
function makeObstacles(w, h) {
  return Array.from({ length: 3 }, () => ({
    x: 60 + Math.random() * (w - 120), y: 60 + Math.random() * (h - 120), r: 28 + Math.random() * 30,
  }))
}
function preyFitness(p) {
  const food = p.caught ? p._fitFood : p.foodEaten
  return food + (p.survivalTicks / EVAL_TICKS) * SURV_W
}
const predFitness = p => p.preyEaten

function tournament(pop, fit) {
  let best = pop[(Math.random() * pop.length) | 0]
  for (let i = 0; i < 2; i++) {
    const c = pop[(Math.random() * pop.length) | 0]
    if (fit(c) > fit(best)) best = c
  }
  return best
}
function breed(pop, size, elite, fit, role, w, h, rates, gen) {
  pop.sort((a, b) => fit(b) - fit(a))
  const next = []
  for (let i = 0; i < elite && i < pop.length; i++) {
    const el = pop[i]
    next.push(new NeuralCreature(Math.random() * w, Math.random() * h,
      { weights: new Float32Array(el.weights), generation: gen, genome: { ...el.genome }, role }))
  }
  while (next.length < size) {
    const p = tournament(pop, fit)
    next.push(new NeuralCreature(Math.random() * w, Math.random() * h, {
      weights: mutate(p.weights, rates.brainRate, rates.brainStr),
      generation: gen,
      genome: mutateGenome(p.genome, rates.genRate, rates.genStr),
      role,
    }))
  }
  return next
}

// Build a starting population. If a seed champion is given, the population is
// that champion plus mutated copies of it (used for on-extinction "rescue" runs);
// otherwise it's random (used for a fresh tournament).
function seededPop(seed, count, role, w, h, rates) {
  if (!seed) return Array.from({ length: count }, () => new NeuralCreature(Math.random() * w, Math.random() * h, { role }))
  const base = new Float32Array(seed.weights)
  return Array.from({ length: count }, (_, i) => new NeuralCreature(Math.random() * w, Math.random() * h, {
    role,
    weights: i === 0 ? new Float32Array(base) : mutate(base, rates.brainRate, rates.brainStr),
    genome: i === 0 ? { ...seed.genome } : mutateGenome(seed.genome, rates.genRate, rates.genStr),
  }))
}

self.onmessage = (e) => {
  const { id, generations, width, height, mut, seedPrey, seedPredator } = e.data
  const w = width || 900, h = height || 650
  const rates = {
    brainRate: mut?.brainMutationRate ?? 0.12,
    brainStr:  mut?.brainMutationStrength ?? 0.25,
    genRate:   mut?.genomeMutationRate ?? 0.18,
    genStr:    mut?.genomeMutationStrength ?? 0.6,
  }
  const obstacles = makeObstacles(w, h)

  let prey = seededPop(seedPrey, PREY_POP, 'prey', w, h, rates)
  let preds = seededPop(seedPredator, PRED_POP, 'predator', w, h, rates)
  let bestPrey = null, bestPred = null

  for (let gen = 1; gen <= generations; gen++) {
    const foods = makeFoods(w, h)
    const world = { w, h, foods, obstacles, prey, predators: preds }

    for (const c of prey) {
      c.x = Math.random() * w; c.y = Math.random() * h; c.angle = Math.random() * Math.PI * 2
      c.energy = PREY_START_E; c.speed = 0.6; c.age = 0; c.foodEaten = 0; c.dead = false
      c.survivalTicks = 0; c.caught = false; c._fitFood = 0
    }
    for (const c of preds) {
      c.x = Math.random() * w; c.y = Math.random() * h; c.angle = Math.random() * Math.PI * 2
      c.energy = PRED_START_E; c.speed = 0.6; c.age = 0; c.preyEaten = 0; c.dead = false
    }

    for (let t = 0; t < EVAL_TICKS; t++) {
      for (const c of prey) if (c.energy > 0 && !c.dead) c.update(world)
      for (const c of preds) if (c.energy > 0) c.update(world)
      // Survival credit accrues only while a prey is uncaught and alive; on the
      // FIRST capture its fitness (food + survival) is frozen, then it's teleported
      // so predators keep having targets for the rest of the window.
      for (const p of prey) {
        if (!p.caught && p.energy > 0) p.survivalTicks++
        if (p.dead) {
          if (!p.caught) { p.caught = true; p._fitFood = p.foodEaten }
          p.dead = false
          p.x = Math.random() * w; p.y = Math.random() * h
          p.energy = Math.max(p.energy, PREY_START_E * 0.5)
        }
      }
      for (const f of foods) if (f.eaten) { f.x = Math.random() * w; f.y = Math.random() * h; f.eaten = false }
    }

    prey.sort((a, b) => preyFitness(b) - preyFitness(a))
    preds.sort((a, b) => predFitness(b) - predFitness(a))
    const preyTop = prey[0], predTop = preds[0]
    const preyAvg = prey.reduce((s, c) => s + c.foodEaten, 0) / prey.length
    const predAvg = preds.reduce((s, c) => s + c.preyEaten, 0) / preds.length
    if (!bestPrey || preyFitness(preyTop) > bestPrey._fit)
      bestPrey = { weights: new Float32Array(preyTop.weights), genome: { ...preyTop.genome }, generation: gen, foodEaten: preyTop.caught ? preyTop._fitFood : preyTop.foodEaten, _fit: preyFitness(preyTop) }
    if (!bestPred || predTop.preyEaten > bestPred.preyEaten)
      bestPred = { weights: new Float32Array(predTop.weights), genome: { ...predTop.genome }, generation: gen, preyEaten: predTop.preyEaten }

    self.postMessage({
      type: 'progress', id, gen, totalGen: generations,
      preyBest: bestPrey.foodEaten, predBest: bestPred.preyEaten,
      preyAvg: Math.round(preyAvg * 10) / 10, predAvg: Math.round(predAvg * 10) / 10,
    })

    if (gen < generations) {
      prey = breed(prey, PREY_POP, PREY_ELITE, preyFitness, 'prey', w, h, rates, gen)
      preds = breed(preds, PRED_POP, PRED_ELITE, predFitness, 'predator', w, h, rates, gen)
    }
  }

  self.postMessage({
    type: 'done', id,
    prey: bestPrey ? { weights: Array.from(bestPrey.weights), genome: bestPrey.genome, generation: bestPrey.generation, foodEaten: bestPrey.foodEaten } : null,
    predator: bestPred ? { weights: Array.from(bestPred.weights), genome: bestPred.genome, generation: bestPred.generation, preyEaten: bestPred.preyEaten } : null,
  })
}
