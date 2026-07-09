// The pendulum simulation loop — one place that ties the plant, controller, and
// (in realistic mode) the sensor/estimator/actuator together, so main.js just
// renders. Runs physics on a fixed substep via the shared accumulator; the
// controller is evaluated at a fixed control rate.
//
// Ideal vs Realistic:
//   IDEAL      — controller sees the true state; force is applied directly.
//   REALISTIC  — a full hardware-style loop: positions are read through a noisy,
//                quantized sensor; an EKF reconstructs the state (incl. the
//                unmeasured velocities); the controller acts on that estimate;
//                and the command passes through an actuator model (saturation,
//                slew, lag) before hitting the plant.
//
// One honest subtlety: swing-up is a phase-sensitive energy maneuver and the
// separation principle (observer + feedback compose) only holds near the
// equilibrium. So in realistic mode the swing-up phase runs on the true state
// (a stand-in for the open-loop resonant pumping / dedicated high-rate estimator
// a real rig would use), and the EKF-based LQG regulator takes over once the
// system reaches the balance region — which is exactly where sensor noise and
// actuator dynamics dominate real-world performance, and where the estimator is
// valid. The actuator model is always active in realistic mode.

import { makeAccumulator } from '../../lib/control/integrate.js'
import { makeSensor } from '../../lib/control/sensor.js'
import { makeActuator } from '../../lib/control/actuator.js'
import { makeEKF } from '../../lib/control/observer.js'

export const SUBSTEP = 1 / 240

// Realistic-mode defaults, specified per-quantity so they apply to any plant
// (the sim assembles plant-sized arrays/maps from these below).
export const REALISM = {
  controlHz: 240,
  sensor: { angleNoise: 0.004, posNoise: 0.003, angleRes: 0.00314, posRes: 0.001 }, // ~0.18° encoder
  actuator: { slewPerForceMax: 11, tau: 0.02, deadband: 0.05 },
  ekf: { posProcess: 1e-6, velProcess: 3e-3, meas: 2e-5 },
}

// Build plant-sized sensor / EKF noise configs from the per-quantity defaults.
function buildConfigs(plant, realism) {
  const isAngle = name => name.startsWith('theta')
  const noise = {}, resolution = {}
  for (const d of plant.meta.measured) {
    noise[d] = isAngle(d) ? realism.sensor.angleNoise : realism.sensor.posNoise
    resolution[d] = isAngle(d) ? realism.sensor.angleRes : realism.sensor.posRes
  }
  const processNoise = plant.meta.dims.map(d => (d.endsWith('dot') ? realism.ekf.velProcess : realism.ekf.posProcess))
  const measNoise = plant.meta.measured.map(() => realism.ekf.meas)
  return { sensor: { noise, resolution }, processNoise, measNoise }
}

export function makeSim({ plant, controller, realistic = false, realism = REALISM, balanceRegion }) {
  const controlDt = 1 / realism.controlHz
  const cfg = buildConfigs(plant, realism)
  const accumulator = makeAccumulator(SUBSTEP)
  const sensor = makeSensor(cfg.sensor)
  const actuator = makeActuator({
    forceMax: plant.PARAMS.forceMax,
    slewMax: plant.PARAMS.forceMax * realism.actuator.slewPerForceMax,
    tau: realism.actuator.tau, deadband: realism.actuator.deadband,
  })
  const ekf = makeEKF(plant, { dt: controlDt, processNoise: cfg.processNoise, measNoise: cfg.measNoise, x0: plant.toVec(plant.initialState()) })
  // Default balance region: single uses the pole's angle band; other plants (double,
  // stabilize-only) estimate throughout since there is no nonlinear swing-up phase.
  const inBalance = balanceRegion || (plant.meta.name === 'single' ? (s) => Math.abs(wrapPi(s.theta)) < 0.35 : () => true)

  let ctrl = controller
  let trueState = plant.initialState()
  let est = trueState
  let cmd = 0, uReal = 0, controlTimer = Infinity
  let engaged = false // has the EKF-based regulator taken over?
  let mode = 'init'

  function controlTick() {
    if (!realistic) {
      est = trueState
      const r = ctrl.compute(trueState); cmd = r.force; mode = r.mode
      return
    }
    ekf.predict(uReal)
    ekf.update(sensor.measure(plant.measure(trueState)))
    est = ekf.state()
    if (!engaged && inBalance(trueState)) engaged = true
    const r = ctrl.compute(engaged ? est : trueState); cmd = r.force; mode = r.mode
  }

  function physicsSub(h) {
    controlTimer += h
    if (controlTimer >= controlDt) { controlTimer = 0; controlTick() }
    uReal = realistic ? actuator.apply(cmd, h) : cmd
    trueState = plant.step(trueState, uReal, h)
  }

  return {
    advance(dt) { accumulator.advance(dt, physicsSub) },
    reset(s = null) {
      trueState = s || plant.initialState(); est = trueState
      ctrl.reset(); ekf.reset(plant.toVec(trueState)); actuator.reset()
      accumulator.reset(); cmd = 0; uReal = 0; controlTimer = Infinity; engaged = false; mode = 'init'
    },
    disturb(fn) { trueState = fn(trueState) },
    setController(c) { ctrl = c; c.reset(); engaged = false },
    get state() { return trueState },
    get estimate() { return est },
    get force() { return uReal },
    get mode() { return mode },
    get realistic() { return realistic },
    set realistic(v) { realistic = v; if (!v) { engaged = false; ekf.reset(plant.toVec(trueState)); actuator.reset() } },
  }
}

function wrapPi(a) {
  a = (a + Math.PI) % (Math.PI * 2)
  if (a < 0) a += Math.PI * 2
  return a - Math.PI
}
