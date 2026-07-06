const FOOD_COUNT = 30
const FOOD_ENERGY = 40
const REPRODUCE_ENERGY = 120
const REPRODUCE_COST = 60
const METABOLISM = 0.04
const MAX_CREATURES = 150

export class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y }
  add(v) { return new Vec2(this.x + v.x, this.y + v.y) }
  sub(v) { return new Vec2(this.x - v.x, this.y - v.y) }
  scale(s) { return new Vec2(this.x * s, this.y * s) }
  mag() { return Math.sqrt(this.x * this.x + this.y * this.y) }
  norm() { const m = this.mag(); return m > 0 ? this.scale(1 / m) : new Vec2() }
  limit(max) { return this.mag() > max ? this.norm().scale(max) : new Vec2(this.x, this.y) }
  static random() { return new Vec2(Math.random() * 2 - 1, Math.random() * 2 - 1).norm() }
}

export class Food {
  constructor(w, h) {
    this.pos = new Vec2(Math.random() * w, Math.random() * h)
    this.eaten = false
  }
}

export class Creature {
  constructor(x, y, generation = 0) {
    this.pos = new Vec2(x, y)
    this.vel = Vec2.random().scale(1 + Math.random())
    this.acc = new Vec2()
    this.energy = 60 + Math.random() * 20
    this.age = 0
    this.generation = generation
    this.size = 5 + Math.random() * 2
    this.hue = 120 + generation * 15
    this.perception = 80 + Math.random() * 60
    this.maxSpeed = 1.5 + Math.random() * 1.5
    this.maxForce = 0.08 + Math.random() * 0.04
    this.separationWeight = 1.5
    this.alignWeight = 0.8
    this.cohesionWeight = 0.5
    this.foodWeight = 2.5
  }

  applyForce(f) { this.acc = this.acc.add(f) }

  seek(target) {
    const desired = target.sub(this.pos).norm().scale(this.maxSpeed)
    return desired.sub(this.vel).limit(this.maxForce)
  }

  separate(others) {
    let sum = new Vec2(), count = 0
    for (const o of others) {
      const d = this.pos.sub(o.pos)
      const dist = d.mag()
      if (dist > 0 && dist < this.size * 4) {
        sum = sum.add(d.norm().scale(1 / dist))
        count++
      }
    }
    if (count === 0) return new Vec2()
    return sum.scale(1 / count).norm().scale(this.maxSpeed).sub(this.vel).limit(this.maxForce * 2)
  }

  align(neighbors) {
    if (neighbors.length === 0) return new Vec2()
    let sum = new Vec2()
    for (const n of neighbors) sum = sum.add(n.vel)
    return sum.scale(1 / neighbors.length).norm().scale(this.maxSpeed).sub(this.vel).limit(this.maxForce)
  }

  cohere(neighbors) {
    if (neighbors.length === 0) return new Vec2()
    let sum = new Vec2()
    for (const n of neighbors) sum = sum.add(n.pos)
    return this.seek(sum.scale(1 / neighbors.length))
  }

  seekFood(foods) {
    let nearest = null, nearDist = Infinity
    for (const f of foods) {
      if (f.eaten) continue
      const d = f.pos.sub(this.pos).mag()
      if (d < this.perception && d < nearDist) { nearest = f; nearDist = d }
    }
    if (!nearest) return new Vec2()
    return this.seek(nearest.pos).limit(this.maxForce * 1.5)
  }

  update(creatures, foods, w, h, params) {
    const neighbors = creatures.filter(c => c !== this && c.pos.sub(this.pos).mag() < this.perception)

    const sep = this.separate(creatures).scale(this.separationWeight * params.separation)
    const aln = this.align(neighbors).scale(this.alignWeight * params.alignment)
    const coh = this.cohere(neighbors).scale(this.cohesionWeight * params.cohesion)
    const food = this.seekFood(foods).scale(this.foodWeight)

    this.applyForce(sep)
    this.applyForce(aln)
    this.applyForce(coh)
    this.applyForce(food)

    // Wander if no food nearby
    if (food.mag() < 0.01) {
      this.applyForce(Vec2.random().scale(0.02))
    }

    this.vel = this.vel.add(this.acc).limit(this.maxSpeed * params.speed)
    this.pos = this.pos.add(this.vel)
    this.acc = new Vec2()

    // Wrap edges
    if (this.pos.x < 0) this.pos.x += w
    if (this.pos.x > w) this.pos.x -= w
    if (this.pos.y < 0) this.pos.y += h
    if (this.pos.y > h) this.pos.y -= h

    this.energy -= METABOLISM * params.metabolism
    this.age++

    // Eat food
    for (const f of foods) {
      if (!f.eaten && f.pos.sub(this.pos).mag() < this.size + 4) {
        f.eaten = true
        this.energy += FOOD_ENERGY
      }
    }
  }

  canReproduce() { return this.energy >= REPRODUCE_ENERGY }
  isDead() { return this.energy <= 0 }

  reproduce() {
    this.energy -= REPRODUCE_COST
    const child = new Creature(
      this.pos.x + (Math.random() - 0.5) * 20,
      this.pos.y + (Math.random() - 0.5) * 20,
      this.generation + 1,
    )
    child.maxSpeed = Math.max(0.5, this.maxSpeed + (Math.random() - 0.5) * 0.3)
    child.perception = Math.max(30, this.perception + (Math.random() - 0.5) * 20)
    child.hue = this.hue + (Math.random() - 0.5) * 20
    return child
  }
}

export class Simulation {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.creatures = []
    this.foods = []
    this.params = { speed: 1, separation: 1, alignment: 1, cohesion: 1, metabolism: 1 }
    this.tick = 0
    this.stats = { population: 0, avgGen: 0, foodLeft: 0, born: 0, died: 0 }
    this.reset()
  }

  reset() {
    this.creatures = Array.from({ length: 20 }, () =>
      new Creature(Math.random() * this.w, Math.random() * this.h)
    )
    this.foods = Array.from({ length: FOOD_COUNT }, () => new Food(this.w, this.h))
    this.tick = 0
    this.stats.born = 0
    this.stats.died = 0
  }

  resize(w, h) { this.w = w; this.h = h }

  step() {
    this.tick++
    const born = [], died = []

    for (const c of this.creatures) {
      c.update(this.creatures, this.foods, this.w, this.h, this.params)
      if (c.isDead()) died.push(c)
      else if (c.canReproduce() && this.creatures.length + born.length < MAX_CREATURES) {
        born.push(c.reproduce())
      }
    }

    this.stats.died += died.length
    this.stats.born += born.length

    this.creatures = this.creatures.filter(c => !died.includes(c))
    this.creatures.push(...born)

    // Respawn eaten food
    this.foods = this.foods.filter(f => !f.eaten)
    while (this.foods.length < FOOD_COUNT) {
      this.foods.push(new Food(this.w, this.h))
    }

    const avgGen = this.creatures.length
      ? this.creatures.reduce((s, c) => s + c.generation, 0) / this.creatures.length
      : 0

    this.stats.population = this.creatures.length
    this.stats.avgGen = avgGen
    this.stats.foodLeft = this.foods.length
  }
}
