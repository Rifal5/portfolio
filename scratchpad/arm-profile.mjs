// Phase 7 checkpoint: the joint profiler must move each joint toward the IK
// target WITHOUT exceeding its velocity/acceleration limits (no teleport) and
// converge to the target.

import { makeJointProfiler } from '../src/projects/robot-arm/motion.js'

const vMax = { yaw: 200, shoulder: 140, elbow: 160, wrist: 240 }
const aMax = { yaw: 700, shoulder: 500, elbow: 600, wrist: 900 }
const profiler = makeJointProfiler({ vMax, aMax })

const start = { yaw: 0, shoulder: 90, elbow: -90, wrist: -45 }
const target = { yaw: 170, shoulder: 20, elbow: -150, wrist: 30 } // a big commanded step
profiler.reset(start)

const dt = 1 / 240
const joints = ['yaw', 'shoulder', 'elbow', 'wrist']
let prevVel = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0 }
const maxV = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0 }
const maxA = { yaw: 0, shoulder: 0, elbow: 0, wrist: 0 }
let firstStepPose = null

for (let i = 0; i < Math.round(4 / dt); i++) {
  profiler.step(target, dt)
  if (i === 0) firstStepPose = { ...profiler.pose }
  const v = profiler.velocity
  for (const j of joints) {
    maxV[j] = Math.max(maxV[j], Math.abs(v[j]))
    maxA[j] = Math.max(maxA[j], Math.abs((v[j] - prevVel[j]) / dt))
  }
  prevVel = v
}

let ok = true
// No teleport: after ONE 1/240 s step, no joint jumped more than vMax*dt (+eps).
for (const j of joints) {
  const jump = Math.abs(firstStepPose[j] - start[j])
  if (jump > vMax[j] * dt + 1e-6) { ok = false; console.log(`  FAIL: ${j} teleported ${jump.toFixed(2)}° in one step`) }
}
// Velocity + acceleration bounds respected (2% tolerance for discretization).
for (const j of joints) {
  console.log(`${j.padEnd(9)} maxV=${maxV[j].toFixed(1)}/${vMax[j]}  maxA=${maxA[j].toFixed(0)}/${aMax[j]}`)
  if (maxV[j] > vMax[j] * 1.02) { ok = false; console.log(`  FAIL: ${j} exceeded vMax`) }
  if (maxA[j] > aMax[j] * 1.05) { ok = false; console.log(`  FAIL: ${j} exceeded aMax`) }
}
// Converged to target.
for (const j of joints) {
  const err = Math.abs(profiler.pose[j] - target[j])
  if (err > 0.5) { ok = false; console.log(`  FAIL: ${j} did not converge (err ${err.toFixed(2)}°)`) }
}
console.log(ok ? '\nPASS: joints slew to IK target within velocity/accel limits, no teleport' : '\nFAIL: see above')
process.exit(ok ? 0 : 1)
