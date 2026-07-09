// Plant registry — the UI picks a plant by key. Each plant implements the same
// interface (meta, initialState, toVec/fromVec, derivative, step, energy, measure, PARAMS).
import * as single from './single.js'
import * as double from './double.js'

export const PLANTS = { single, double }
export const PLANT_KEYS = Object.keys(PLANTS)
