import { randomParams, mutate, forward, ARCH, N_IN, N_OUT, BINS_PER_EYE, RETINA_CHANNELS, RETINA_SIZE } from './neural-net.js'

// ── Spatial grid ───────────────────────────────────────────────────────────────
// Buckets items into cells so a creature only scans the handful of cells its eyes
// can reach (3×3 neighbourhood), instead of every item in the world. Cell size =
// max perception range, so anything within sight is in the neighbourhood.
const GRID_CELL = 250

class SpatialGrid {
  constructor(w, h, cell) {
    this.cell = cell
    this.cols = Math.max(1, Math.ceil(w / cell))
    this.rows = Math.max(1, Math.ceil(h / cell))
    this.buckets = Array.from({ length: this.cols * this.rows }, () => [])
  }
  clear() { for (const b of this.buckets) b.length = 0 }
  _cx(x) { return Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cell))) }
  _cy(y) { return Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cell))) }
  insert(it) { this.buckets[this._cy(it.y) * this.cols + this._cx(it.x)].push(it) }
  query(x, y, out) {
    out.length = 0
    const cx = this._cx(x), cy = this._cy(y)
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      if (gy < 0 || gy >= this.rows) continue
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx >= this.cols) continue
        const b = this.buckets[gy * this.cols + gx]
        for (let i = 0; i < b.length; i++) out.push(b[i])
      }
    }
    return out
  }
}

// Reusable scratch buffers for grid queries (single-threaded sensing).
const _scratchA = [], _scratchB = [], _scratchC = []

// Candidate items near (x,y): from the spatial grid in the live sim, or the plain
// arrays in the headless worker (small populations, no grid needed).
function queryItems(world, kind, x, y, scratch) {
  if (world.grids) {
    const grid = kind === 'food' ? world.grids.food : kind === 'prey' ? world.grids.prey : world.grids.pred
    if (grid) return grid.query(x, y, scratch)
  }
  return kind === 'food' ? world.foods : kind === 'prey' ? world.prey : world.predators
}

// ── Genome ─────────────────────────────────────────────────────────────────────
export const GENOME_DEFAULTS = {
  eyeAngle:        20,    // degrees — divergence from forward (0=human, 90=chameleon)
  eyeFov:          70,    // degrees — arc covered by each eye
  eyeSeparation:   14,    // pixels between the two eye centers
  maxSpeed:        2.5,
  turnRate:        0.18,
  metabolism:      0.045,
  speedCost:       0.012,
  perceptionRange: 130,
  reproThreshold:  0.82,
  colorS:          70,
  colorL:          60,
}

const GENOME_BOUNDS = {
  eyeAngle:        [0, 135],
  eyeFov:          [20, 150],
  eyeSeparation:   [2, 40],
  maxSpeed:        [0.5, 5],
  turnRate:        [0.05, 0.5],
  metabolism:      [0.01, 0.2],
  speedCost:       [0.001, 0.05],
  perceptionRange: [40, 250],
  reproThreshold:  [0.5, 0.99],
  colorS:          [30, 95],
  colorL:          [35, 75],
}

export const MUT_DEFAULTS = {
  brainMutationRate:     0.12,
  brainMutationStrength: 0.25,
  genomeMutationRate:    0.18,
  genomeMutationStrength:0.6,
}

// Role presets nudge starting body plans; evolution takes it from there.
// Prey and predators start from an IDENTICAL body plan — the only built-in
// difference is diet (prey eat food, predators eat prey). Each side evolves its
// own hunting/evasion traits from this fair starting point. Colour just marks role.
const PREY_GENOME = { ...GENOME_DEFAULTS, colorH: 150 }      // green-ish
const PREDATOR_GENOME = { ...GENOME_DEFAULTS, colorH: 0 }    // red-ish

export function mutateGenome(genome, rate = MUT_DEFAULTS.genomeMutationRate, strength = MUT_DEFAULTS.genomeMutationStrength) {
  const g = { ...genome }
  for (const key of Object.keys(GENOME_BOUNDS)) {
    if (Math.random() < rate) {
      const [lo, hi] = GENOME_BOUNDS[key]
      const noise = (Math.random() + Math.random() - 1) * (hi - lo) * 0.12 * strength
      g[key] = Math.max(lo, Math.min(hi, g[key] + noise))
    }
  }
  g.colorH = (genome.colorH + (Math.random() - 0.5) * 40 + 360) % 360
  return g
}

// ── Serialization ──────────────────────────────────────────────────────────────
export function serializeCreature(c) {
  return JSON.stringify({
    weights: Array.from(c.weights), genome: c.genome,
    generation: c.generation, role: c.role, arch: ARCH,
  }, null, 2)
}

export function deserializeCreature(json) {
  const data = JSON.parse(json)
  if (Array.isArray(data)) {
    return { weights: new Float32Array(data), genome: { ...GENOME_DEFAULTS, colorH: Math.random() * 360 }, generation: 0, role: 'prey' }
  }
  const genome = { ...GENOME_DEFAULTS, ...data.genome }
  if (genome.colorH == null) genome.colorH = Math.random() * 360
  return {
    weights: new Float32Array(data.weights),
    genome, generation: data.generation ?? 0, role: data.role ?? 'prey',
  }
}

// ── Constants ──────────────────────────────────────────────────────────────────
const PREY_MAX_ENERGY = 160
const PRED_MAX_ENERGY = 160      // equal to prey — same energy tank, only diet differs
const FOOD_ENERGY = 55
const DEFAULT_MEAT_ENERGY = 90   // energy a predator gains per prey caught (user-adjustable)
const PRED_METABOLIC_FACTOR = 1.35 // predators burn energy faster than prey — hunters can't
                                   // idle, so they turn over instead of stagnating
const REPRODUCE_COST = 90        // costlier reproduction damps prey overshoot
const MAX_FOOD = 40              // standing food crop (a buffer)
const FOOD_SPAWN_INTERVAL = 13   // ticks between each new food — the food inflow RATE sets the prey carrying capacity
const CREATURE_R = 5
const CATCH_R = 11               // predator catch radius

// Caps and default food scale with world AREA (relative to a ~500k px² base world),
// so a bigger world naturally supports more creatures (up to ~1000 prey).
const BASE_AREA = 640 * 780
const PREY_CAP_PER_AREA = 240 / BASE_AREA
const PRED_CAP_PER_AREA = 12 / BASE_AREA
const FOOD_PER_AREA = 40 / BASE_AREA
const DEFAULT_FOOD_ENERGY = 55  // richness (energy per food); user-adjustable

// Live-arena fitness blends food/kills with SURVIVAL (age). sqrt(age) keeps a
// lucky long-lived hider from running away with it, while FITNESS_FOOD_W keeps
// foraging decisive. Survival is weighted a touch higher (bias to survival).
const FITNESS_FOOD_W = 1.0
const FITNESS_SURVIVE_W = 0.9

function maxEnergyFor(role) { return role === 'predator' ? PRED_MAX_ENERGY : PREY_MAX_ENERGY }

// ── Creature ───────────────────────────────────────────────────────────────────
export class NeuralCreature {
  constructor(x, y, { weights = null, generation = 0, genome = null, role = 'prey' } = {}) {
    this.x = x
    this.y = y
    this.role = role
    this.angle = Math.random() * Math.PI * 2
    this.speed = 0.5 + Math.random() * 0.5
    this.energy = maxEnergyFor(role) * (0.45 + Math.random() * 0.2)
    this.generation = generation
    const base = genome ? { ...genome } : { ...(role === 'predator' ? PREDATOR_GENOME : PREY_GENOME) }
    if (base.colorH == null) base.colorH = role === 'predator' ? 0 : 150
    this.genome = base
    this.age = 0
    this.foodEaten = 0    // prey fitness
    this.preyEaten = 0    // predator fitness
    this.weights = weights || randomParams()

    this.inputs = new Float32Array(N_IN)
    this.activations = ARCH.map(n => new Float32Array(n)) // per-layer, for inspector
    this.lastOutputs = new Float32Array(N_OUT)
    this.wantsReproduce = false
    this.dead = false
    this.isChampion = false
  }

  // Accumulate point items (food / prey / predators) into the retina by ANGLE.
  // Each visible item drops a +1 into the (eye, bin, channel) cell it falls in —
  // no distance term, so the network learns from WHERE things are, not how near.
  _retinaPoints(items, channel, eyes, range2, halfFov, binW) {
    for (let ei = 0; ei < 2; ei++) {
      const eye = eyes[ei]
      const base = ei * (BINS_PER_EYE * RETINA_CHANNELS)
      for (let i = 0; i < items.length; i++) {
        const p = items[i]
        if (p === this || p.eaten || p.dead) continue
        const dx = p.x - this.x, dy = p.y - this.y
        if (dx * dx + dy * dy > range2) continue
        let a = Math.atan2(p.y - eye.y, p.x - eye.x) - eye.dir
        a -= Math.PI * 2 * Math.round(a / (Math.PI * 2))
        if (a < -halfFov || a > halfFov) continue
        let bin = Math.floor((a + halfFov) / binW)
        if (bin < 0) bin = 0; else if (bin >= BINS_PER_EYE) bin = BINS_PER_EYE - 1
        this.inputs[base + bin * RETINA_CHANNELS + channel] += 1
      }
    }
  }

  // Obstacles subtend an angular RANGE, so they fill every bin their silhouette
  // spans — the creature "sees the wall along the angles it occupies".
  _retinaObstacles(obstacles, channel, eyes, range, halfFov, binW) {
    for (let ei = 0; ei < 2; ei++) {
      const eye = eyes[ei]
      const base = ei * (BINS_PER_EYE * RETINA_CHANNELS)
      for (const o of obstacles) {
        const dx = o.x - this.x, dy = o.y - this.y
        if (Math.hypot(dx, dy) - o.r > range) continue
        const de = Math.hypot(o.x - eye.x, o.y - eye.y)
        let ac = Math.atan2(o.y - eye.y, o.x - eye.x) - eye.dir
        ac -= Math.PI * 2 * Math.round(ac / (Math.PI * 2))
        const half = de > o.r ? Math.asin(o.r / de) : Math.PI
        const lo = ac - half, hi = ac + half
        for (let b = 0; b < BINS_PER_EYE; b++) {
          const binLo = -halfFov + b * binW, binHi = binLo + binW
          if (hi >= binLo && lo <= binHi) this.inputs[base + b * RETINA_CHANNELS + channel] += 1
        }
      }
    }
  }

  _sense(world) {
    const g = this.genome
    const eyeOff = (g.eyeAngle * Math.PI) / 180
    const halfFov = (g.eyeFov * Math.PI) / 360
    const binW = (halfFov * 2) / BINS_PER_EYE
    const range = g.perceptionRange, range2 = range * range
    const sep = g.eyeSeparation / 2

    // Each eye: a physical position (perpendicular offset) and a look direction
    // (heading ± eyeAngle). Bins divide its field of view.
    const eyes = [
      { x: this.x + Math.sin(this.angle) * sep, y: this.y - Math.cos(this.angle) * sep, dir: this.angle - eyeOff },
      { x: this.x - Math.sin(this.angle) * sep, y: this.y + Math.cos(this.angle) * sep, dir: this.angle + eyeOff },
    ]

    const inp = this.inputs
    inp.fill(0)

    // Channel 0 = target (food for prey, prey for predators)
    const targets = queryItems(world, this.role === 'predator' ? 'prey' : 'food', this.x, this.y, _scratchA)
    this._retinaPoints(targets, 0, eyes, range2, halfFov, binW)
    // Channel 1 = threat (predators; predators have no predator)
    if (this.role !== 'predator') {
      const threats = queryItems(world, 'pred', this.x, this.y, _scratchB)
      this._retinaPoints(threats, 1, eyes, range2, halfFov, binW)
    }
    // Channel 2 = obstacles
    this._retinaObstacles(world.obstacles, 2, eyes, range, halfFov, binW)

    // Squash counts into 0..~1 (distance-agnostic density per direction)
    for (let i = 0; i < RETINA_SIZE; i++) inp[i] = Math.tanh(inp[i] * 0.7)
    inp[RETINA_SIZE] = this.energy / maxEnergyFor(this.role)
  }

  // Per-tick energy drain. The body is expensive to run:
  //  • movement is QUADRATIC in speed — cruising/sneaking is cheap, sprinting and
  //    spinning are costly, so predators learn to stalk and prey stop twitching;
  //  • steering costs effort, discouraging endless spin-in-place;
  //  • bigger eyes (wider FOV / longer range) and a more powerful body cost upkeep,
  //    so investing in those traits must earn its keep — a real evolutionary trade-off.
  _metabolicCost(turnMag) {
    const g = this.genome
    let cost = g.metabolism                              // baseline upkeep
    cost += g.speedCost * this.speed * this.speed         // quadratic movement
    cost += 0.007 * turnMag                               // steering effort (|turn| 0..1)
    cost += 0.009 * (g.perceptionRange / 130) * (0.6 + 0.4 * g.eyeFov / 70) // vision upkeep
    cost += 0.005 * (g.maxSpeed / 2.5)                    // body/engine upkeep
    if (this.role === 'predator') cost *= PRED_METABOLIC_FACTOR
    return cost
  }

  update(world) {
    this._sense(world)
    const out = forward(this.weights, this.inputs, this.activations)
    this.lastOutputs[0] = out[0]; this.lastOutputs[1] = out[1]; this.lastOutputs[2] = out[2]

    this.angle += out[0] * this.genome.turnRate
    const thrust = (out[1] + 1) * this.genome.maxSpeed * 0.5
    this.speed += (thrust - this.speed) * 0.15
    this.speed = Math.max(0.1, Math.min(this.genome.maxSpeed, this.speed))

    let nx = this.x + Math.cos(this.angle) * this.speed
    let ny = this.y + Math.sin(this.angle) * this.speed

    // Obstacle collision — push back out to the surface
    for (const o of world.obstacles) {
      const dx = nx - o.x, dy = ny - o.y
      const d = Math.hypot(dx, dy)
      const minD = o.r + CREATURE_R
      if (d < minD && d > 0.0001) {
        nx = o.x + (dx / d) * minD
        ny = o.y + (dy / d) * minD
      }
    }
    this.x = nx; this.y = ny

    const w = world.w, h = world.h
    if (this.x < 0) this.x += w; else if (this.x > w) this.x -= w
    if (this.y < 0) this.y += h; else if (this.y > h) this.y -= h

    this.energy -= this._metabolicCost(Math.abs(out[0]))
    this.age++

    if (this.role === 'prey') {
      const foods = queryItems(world, 'food', this.x, this.y, _scratchC)
      for (let i = 0; i < foods.length; i++) {
        const f = foods[i]
        if (!f.eaten) {
          const dx = f.x - this.x, dy = f.y - this.y
          if (dx * dx + dy * dy < 100) {
            f.eaten = true
            this.energy = Math.min(PREY_MAX_ENERGY, this.energy + (world.foodRichness ?? DEFAULT_FOOD_ENERGY))
            this.foodEaten++
          }
        }
      }
    } else {
      // Predator: catch the nearest prey within reach
      const nearby = queryItems(world, 'prey', this.x, this.y, _scratchC)
      for (let i = 0; i < nearby.length; i++) {
        const p = nearby[i]
        if (p.dead) continue
        const dx = p.x - this.x, dy = p.y - this.y
        if (dx * dx + dy * dy < CATCH_R * CATCH_R) {
          p.dead = true
          this.energy = Math.min(PRED_MAX_ENERGY, this.energy + (world.meatRichness ?? DEFAULT_MEAT_ENERGY))
          this.preyEaten++
          break
        }
      }
    }

    const thr = maxEnergyFor(this.role) * this.genome.reproThreshold
    this.wantsReproduce = out[2] > 0.4 && this.energy >= thr
  }

  isDead() { return this.dead || this.energy <= 0 }

  reproduce(mut = MUT_DEFAULTS) {
    this.energy -= REPRODUCE_COST
    return new NeuralCreature(
      this.x + (Math.random() - 0.5) * 24,
      this.y + (Math.random() - 0.5) * 24,
      {
        weights: mutate(this.weights, mut.brainMutationRate, mut.brainMutationStrength),
        generation: this.generation + 1,
        genome: mutateGenome(this.genome, mut.genomeMutationRate, mut.genomeMutationStrength),
        role: this.role,
      }
    )
  }
}

// ── Food & obstacles ─────────────────────────────────────────────────────────
export class Food {
  constructor(w, h, obstacles) {
    do {
      this.x = Math.random() * w
      this.y = Math.random() * h
    } while (obstacles && obstacles.some(o => Math.hypot(o.x - this.x, o.y - this.y) < o.r + 8))
    this.eaten = false
  }
}

// Default obstacle count for a given area (also the slider's per-world default).
function defaultObstacleCount(w, h) {
  return Math.max(4, Math.min(60, Math.round((w * h) / 70000)))
}

function makeObstacles(w, h, n) {
  // Count scales with world area unless an explicit count is given; sizes span
  // small pebbles to big boulders.
  if (n == null) n = defaultObstacleCount(w, h)
  const obs = []
  let tries = 0
  while (obs.length < n && tries++ < Math.max(150, n * 30)) {
    // Weighted size mix: mostly small/medium, occasional large boulder.
    const roll = Math.random()
    const r = roll < 0.55 ? 14 + Math.random() * 22      // small
          : roll < 0.88 ? 34 + Math.random() * 34        // medium
          : 70 + Math.random() * 55                       // large
    const x = r + 12 + Math.random() * (w - 2 * r - 24)
    const y = r + 12 + Math.random() * (h - 2 * r - 24)
    if (obs.every(o => Math.hypot(o.x - x, o.y - y) > o.r + r + 24)) obs.push({ x, y, r })
  }
  return obs
}

// ── Simulation ─────────────────────────────────────────────────────────────────
export class NeuralSimulation {
  constructor(w, h) {
    this.baseW = w                 // viewport size (before world scaling)
    this.baseH = h
    this.worldScale = 1            // >1 = bigger world, zoomed out
    this.w = w
    this.h = h
    this.creatures = []
    this.foods = []
    this.obstacles = []
    this.tick = 0
    this.params = { ...MUT_DEFAULTS, speed: 1 }
    this.foodSpawnInterval = FOOD_SPAWN_INTERVAL // user-adjustable inflow rate
    this.foodRichness = DEFAULT_FOOD_ENERGY      // plant energy per food (prey)
    this.meatRichness = DEFAULT_MEAT_ENERGY      // energy a predator gains per prey
    this._deriveCaps()             // sets preyCap, predCap, maxFood from area
    this.popHistory = []
    this.champion = null       // best prey (by fitness)
    this.predChampion = null   // best predator (by fitness)
    this.totalBorn = 0
    this.totalDied = 0
    this._foodTimer = 0
    this.onExtinction = null   // (role) => void — fired when a role crashes
    this.reset()
  }

  // Population caps and default standing crop scale with world area.
  _deriveCaps() {
    const area = this.w * this.h
    this.preyCap = Math.min(1200, Math.round(area * PREY_CAP_PER_AREA))
    this.predCap = Math.max(8, Math.round(area * PRED_CAP_PER_AREA))
    this.maxFood = Math.max(12, Math.round(area * FOOD_PER_AREA))
    this.obstacleCount = defaultObstacleCount(this.w, this.h)
    this._foodGrid = new SpatialGrid(this.w, this.h, GRID_CELL)
    this._preyGrid = new SpatialGrid(this.w, this.h, GRID_CELL)
    this._predGrid = new SpatialGrid(this.w, this.h, GRID_CELL)
  }

  // User-adjustable obstacle count; regenerates the field immediately.
  setObstacleCount(n) {
    this.obstacleCount = n
    this.obstacles = makeObstacles(this.w, this.h, n)
  }

  // Change world size (1 = viewport). Keeps the current (evolved) population —
  // scatters it across the resized world and, for a bigger world, tops it up from
  // the current champions so the new space isn't sparse. Does NOT reset to gen 0.
  setWorldScale(scale) {
    this.worldScale = scale
    this.w = this.baseW * scale
    this.h = this.baseH * scale
    this._deriveCaps()
    this.obstacles = makeObstacles(this.w, this.h, this.obstacleCount)

    for (const c of this.creatures) { c.x = Math.random() * this.w; c.y = Math.random() * this.h }

    const targetPrey = Math.max(20, Math.round(this.preyCap * 0.15))
    const targetPred = Math.max(4, Math.round(this.predCap * 0.2))
    const cur = this._roleCounts()
    if (cur.prey < targetPrey) this._respawn('prey', targetPrey - cur.prey, this.champion)
    if (cur.predator < targetPred) this._respawn('predator', targetPred - cur.predator, this.predChampion)

    this.foods = Array.from({ length: this.maxFood }, () => new Food(this.w, this.h, this.obstacles))
    this._foodTimer = 0
  }

  reset(seedData = null) {
    this.obstacles = makeObstacles(this.w, this.h, this.obstacleCount)
    this.creatures = []
    const nPrey = Math.max(20, Math.round(this.preyCap * 0.15))
    const nPred = Math.max(4, Math.round(this.predCap * 0.2))
    for (let i = 0; i < nPrey; i++) {
      if (seedData) {
        this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, {
          weights: mutate(seedData.weights, 0.3, 0.5),
          generation: 1, genome: mutateGenome(seedData.genome), role: 'prey',
        }))
      } else {
        this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, { role: 'prey' }))
      }
    }
    for (let i = 0; i < nPred; i++) {
      this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, { role: 'predator' }))
    }
    this.foods = Array.from({ length: this.maxFood }, () => new Food(this.w, this.h, this.obstacles))
    this.tick = 0
    this.popHistory = []
    this.champion = null
    this.predChampion = null
    this.totalBorn = this.creatures.length
    this.totalDied = 0
    this._foodTimer = 0
  }

  resize(w, h) {
    this.baseW = w
    this.baseH = h
    this.w = w * this.worldScale
    this.h = h * this.worldScale
    this._deriveCaps()
    this.obstacles = makeObstacles(this.w, this.h, this.obstacleCount)
    for (const c of this.creatures) {
      if (c.x > this.w) c.x = Math.random() * this.w
      if (c.y > this.h) c.y = Math.random() * this.h
    }
  }

  _world() {
    const prey = [], predators = []
    this._foodGrid.clear(); this._preyGrid.clear(); this._predGrid.clear()
    for (const c of this.creatures) {
      if (c.role === 'predator') { predators.push(c); this._predGrid.insert(c) }
      else { prey.push(c); this._preyGrid.insert(c) }
    }
    for (const f of this.foods) if (!f.eaten) this._foodGrid.insert(f)
    return {
      w: this.w, h: this.h, foods: this.foods, obstacles: this.obstacles,
      foodRichness: this.foodRichness, meatRichness: this.meatRichness, prey, predators,
      grids: { food: this._foodGrid, prey: this._preyGrid, pred: this._predGrid },
    }
  }

  // Seed the arena from a coevolution tournament: trained prey AND predators,
  // each with a small mutated family so the lineage is viable.
  loadChampions(preyList = [], predList = [], copiesEach = 5) {
    this.creatures = []
    this.foods = Array.from({ length: this.maxFood }, () => new Food(this.w, this.h, this.obstacles))
    this.tick = 0
    this.popHistory = []
    this.champion = null
    this.predChampion = null
    this.totalBorn = 0
    this.totalDied = 0
    this._foodTimer = 0

    const seedFamily = (d, role, families) => {
      if (!d) return
      const gen = d.generation || 0
      this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h,
        { weights: new Float32Array(d.weights), generation: gen, genome: { ...d.genome }, role }))
      for (let k = 1; k < families; k++) {
        this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, {
          weights: mutate(new Float32Array(d.weights), this.params.brainMutationRate, this.params.brainMutationStrength),
          generation: gen,
          genome: mutateGenome(d.genome, this.params.genomeMutationRate, this.params.genomeMutationStrength),
          role,
        }))
      }
      this.totalBorn += families
    }

    // Seed within trophic budgets that DON'T scale with island count, so loading
    // 20 islands doesn't dump 60 predators into the arena. Budgets scale with the
    // world's carrying capacity. Best champions first.
    const prey = preyList.filter(Boolean).sort((a, b) => b.foodEaten - a.foodEaten)
    let preyBudget = Math.max(40, Math.round(this.preyCap * 0.4))
    for (const d of prey) {
      if (preyBudget <= 0) break
      const fam = Math.min(copiesEach, preyBudget)
      seedFamily(d, 'prey', fam)
      preyBudget -= fam
    }

    // Predators sit at the top of the pyramid — a handful scaled to the world.
    const preds = predList.filter(Boolean).sort((a, b) => b.preyEaten - a.preyEaten)
    let predBudget = Math.max(6, Math.round(this.predCap * 0.5))
    for (const d of preds) {
      if (predBudget <= 0) break
      const fam = Math.min(2, predBudget)
      seedFamily(d, 'predator', fam)
      predBudget -= fam
    }

    // Ensure both roles exist even if a list was empty
    while (this.creatures.filter(c => c.role === 'prey').length < 6)
      this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, { role: 'prey' }))
    while (this.creatures.filter(c => c.role === 'predator').length < 3)
      this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, { role: 'predator' }))
  }

  // Inject champion families for BOTH roles from their current best.
  injectChampion() {
    const seed = (champ, role, n) => {
      if (!champ) return
      for (let i = 0; i < n; i++) {
        this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, {
          weights: mutate(champ.weights, this.params.brainMutationRate, this.params.brainMutationStrength),
          generation: champ.generation + 1,
          genome: mutateGenome(champ.genome, this.params.genomeMutationRate, this.params.genomeMutationStrength),
          role,
        }))
      }
    }
    seed(this.champion, 'prey', 6)
    seed(this.predChampion, 'predator', 4)
  }

  step() {
    const stepsPerFrame = Math.round(this.params.speed)
    for (let s = 0; s < stepsPerFrame; s++) this._step()
    this.tick++
    this._recordPopulation()
  }

  _step() {
    const world = this._world()
    let preyN = world.prey.length, predN = world.predators.length
    const born = [], died = []

    for (const c of this.creatures) {
      c.isChampion = false
      c.update(world)
      if (c.isDead()) { died.push(c); continue }
      if (c.wantsReproduce) {
        if (c.role === 'prey' && preyN < this.preyCap) { born.push(c.reproduce(this.params)); preyN++; this.totalBorn++ }
        else if (c.role === 'predator' && predN < this.predCap) { born.push(c.reproduce(this.params)); predN++; this.totalBorn++ }
      }
    }

    this.totalDied += died.length
    if (died.length) this.creatures = this.creatures.filter(c => !c.isDead())
    this.creatures.push(...born)

    // Champions per role, ranked by blended fitness (food/kills + survival).
    let topPrey = null, topPreyFit = -Infinity
    for (const c of this.creatures) {
      const f = this._creatureFitness(c)
      if (c.role === 'prey') {
        if (f > topPreyFit) { topPreyFit = f; topPrey = c }
        if (!this.champion || f > this.champion.fitness) {
          this.champion = { weights: new Float32Array(c.weights), genome: { ...c.genome }, foodEaten: c.foodEaten, generation: c.generation, fitness: f }
        }
      } else if (!this.predChampion || f > this.predChampion.fitness) {
        this.predChampion = { weights: new Float32Array(c.weights), genome: { ...c.genome }, preyEaten: c.preyEaten, generation: c.generation, fitness: f }
      }
    }
    if (topPrey) topPrey.isChampion = true

    // Food grows back at a fixed RATE up to a standing crop. This makes food the
    // limiting resource, so the prey population settles at a natural carrying
    // capacity instead of pinning against a hard cap. Both are user-adjustable.
    this.foods = this.foods.filter(f => !f.eaten)
    this._foodTimer++
    if (this._foodTimer >= this.foodSpawnInterval) {
      this._foodTimer = 0
      if (this.foods.length < this.maxFood) this.foods.push(new Food(this.w, this.h, this.obstacles))
    }

    // Prevent extinction of either role — a light respawn keeps the arena running
    // right now, while onExtinction lets the UI kick off a background "rescue"
    // evolution that will inject a stronger comeback lineage shortly.
    const counts = this._roleCounts()
    // Predators are only "crashed" below 5% of the prey population — a safety net,
    // not a target, so they can naturally climb toward the ~10% equilibrium.
    const predFloor = Math.max(2, counts.prey * 0.05)
    if (counts.prey < 5) { this._respawn('prey', 10, this.champion); this.onExtinction && this.onExtinction('prey') }
    if (counts.predator < predFloor) { this._respawn('predator', 4, this.predChampion); this.onExtinction && this.onExtinction('predator') }
  }

  // Inject a freshly rescue-evolved lineage (champion + mutated family) of one role
  // into the running arena, without disturbing the other role.
  injectEvolved(role, data, n = 10) {
    if (!data) return
    // Advance the generation counter past the current frontier so a rescued
    // lineage reads as a genuine step forward (not frozen at the tournament's
    // internal generation number).
    let maxGen = 0
    for (const c of this.creatures) if (c.role === role && c.generation > maxGen) maxGen = c.generation
    const gen = Math.max(maxGen, data.generation || 0) + 1
    const base = new Float32Array(data.weights)
    for (let i = 0; i < n; i++) {
      this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, {
        weights: i === 0 ? new Float32Array(base) : mutate(base, this.params.brainMutationRate, this.params.brainMutationStrength),
        genome: i === 0 ? { ...data.genome } : mutateGenome(data.genome, this.params.genomeMutationRate, this.params.genomeMutationStrength),
        generation: gen, role,
      }))
      this.totalBorn++
    }
  }

  _respawn(role, n, seed) {
    for (let i = 0; i < n; i++) {
      const opts = { role }
      if (seed) {
        opts.weights = mutate(seed.weights, this.params.brainMutationRate * 1.5, this.params.brainMutationStrength * 1.5)
        opts.genome = mutateGenome(seed.genome, this.params.genomeMutationRate, this.params.genomeMutationStrength)
        opts.generation = seed.generation + 1
      }
      this.creatures.push(new NeuralCreature(Math.random() * this.w, Math.random() * this.h, opts))
      this.totalBorn++
    }
  }

  // Blend of what a creature gathered (prey: food, predator: prey caught) and how
  // long it has survived. Used to pick which lineage reseeds the population.
  _creatureFitness(c) {
    const gathered = c.role === 'predator' ? c.preyEaten : c.foodEaten
    return gathered * FITNESS_FOOD_W + Math.sqrt(c.age) * FITNESS_SURVIVE_W
  }

  _roleCounts() {
    let prey = 0, predator = 0
    for (const c of this.creatures) c.role === 'predator' ? predator++ : prey++
    return { prey, predator }
  }

  // Rolling record of population counts for the live dynamics chart.
  _recordPopulation() {
    const c = this._roleCounts()
    this.popHistory.push({ prey: c.prey, pred: c.predator, food: this.foods.length })
    if (this.popHistory.length > 200) this.popHistory.shift()
  }

  get stats() {
    const counts = this._roleCounts()
    const prey = this.creatures.filter(c => c.role === 'prey')
    const maxGen = prey.length ? prey.reduce((m, c) => Math.max(m, c.generation), 0) : 0
    const avgFood = prey.length ? prey.reduce((s, c) => s + c.foodEaten, 0) / prey.length : 0
    return {
      prey: counts.prey, predators: counts.predator,
      maxGen, avgFood: avgFood.toFixed(1),
      tick: this.tick, born: this.totalBorn, died: this.totalDied,
    }
  }
}
