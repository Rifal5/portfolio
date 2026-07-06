// 4-DOF articulated arm (RRRR) with physical joint types and limits.
//
//   J1  Base      — revolute about the vertical axis (yaw),   ±150°
//   J2  Shoulder  — revolute pitch (hinge),                    10°…170° from horizontal
//   J3  Elbow     — revolute pitch (hinge),                   −155°…−8° relative to upper arm
//   J4  Wrist     — revolute pitch (hinge),                   −135°…45°; driven automatically
//                    to keep the gripper vertical (an orientation constraint)
//   Gripper       — prismatic fingers (open/close)
//
// IK is solved analytically: base yaw by atan2, then the classic two-link
// planar solution (law of cosines, elbow-up branch) in the vertical plane,
// with every joint clamped to its limits afterwards. If a limit clamps, the
// end effector simply can't reach — the readout flags which joint saturated.

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

export const L = { base: 0.9, upper: 2.2, fore: 1.8, hand: 0.85 }

export const JOINTS = [
  { key: 'yaw',      name: 'J1 · Base',     type: 'Revolute · yaw — continuous 360°', min: -180, max: 180, continuous: true },
  { key: 'shoulder', name: 'J2 · Shoulder', type: 'Revolute · pitch', min: 10,   max: 170 },
  { key: 'elbow',    name: 'J3 · Elbow',    type: 'Revolute · pitch', min: -155, max: -8 },
  { key: 'wrist',    name: 'J4 · Wrist',    type: 'Revolute · pitch (auto — keeps gripper vertical)', min: -200, max: 45 },
]

const LIM = Object.fromEntries(JOINTS.map(j => [j.key, [j.min, j.max]]))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Solve IK for a world target (gripper-tip position). Returns joint angles in
// degrees, per-joint clamp flags, and the actual tip position after clamping.
// `yawOverride` (degrees) commands the continuous base joint directly — the arm
// is jogged in cylindrical coordinates (θ, r), like a teach pendant.
export function solveIK(target, yawOverride = null) {
  const clamped = { yaw: false, shoulder: false, elbow: false, wrist: false }

  // J1: base yaw — continuous (no limits) when commanded directly
  let yaw
  if (yawOverride != null) {
    yaw = yawOverride
  } else {
    yaw = Math.atan2(target.z, target.x) * DEG
  }
  const yawR = yaw * RAD

  // Planar coordinates in the arm plane:
  // r = projection of the target onto the plane direction.
  let r = Math.max(0.25, target.x * Math.cos(yawR) + target.z * Math.sin(yawR))

  // Wrist point sits L.hand straight above the tip (vertical-gripper constraint)
  let wx = r
  let wy = target.y + L.hand - L.base   // relative to the shoulder

  // Keep the wrist inside the reachable annulus of the two links
  const dMin = Math.abs(L.upper - L.fore) + 0.05
  const dMax = L.upper + L.fore - 0.02
  const d = Math.hypot(wx, wy)
  if (d > dMax) { wx *= dMax / d; wy *= dMax / d }
  else if (d < dMin) { const f = dMin / Math.max(d, 1e-6); wx *= f; wy *= f }

  // Two-link analytic solution (elbow-up branch)
  const d2 = wx * wx + wy * wy
  const c3 = clamp((d2 - L.upper * L.upper - L.fore * L.fore) / (2 * L.upper * L.fore), -1, 1)
  const s3 = Math.sqrt(1 - c3 * c3)
  let elbow = -Math.atan2(s3, c3) * DEG
  let shoulder = (Math.atan2(wy, wx) + Math.atan2(L.fore * s3, L.upper + L.fore * c3)) * DEG

  const shoulderC = clamp(shoulder, LIM.shoulder[0], LIM.shoulder[1])
  if (shoulderC !== shoulder) clamped.shoulder = true
  shoulder = shoulderC
  const elbowC = clamp(elbow, LIM.elbow[0], LIM.elbow[1])
  if (elbowC !== elbow) clamped.elbow = true
  elbow = elbowC

  // J4: orientation constraint — point the hand straight down
  let wrist = -90 - (shoulder + elbow)
  const wristC = clamp(wrist, LIM.wrist[0], LIM.wrist[1])
  if (wristC !== wrist) clamped.wrist = true
  wrist = wristC

  // Forward kinematics with the final (clamped) angles → actual tip
  const a2 = shoulder * RAD, a23 = (shoulder + elbow) * RAD, a234 = (shoulder + elbow + wrist) * RAD
  const px = L.upper * Math.cos(a2) + L.fore * Math.cos(a23) + L.hand * Math.cos(a234)
  const py = L.base + L.upper * Math.sin(a2) + L.fore * Math.sin(a23) + L.hand * Math.sin(a234)
  const tip = { x: px * Math.cos(yawR), y: py, z: px * Math.sin(yawR) }

  return { angles: { yaw, shoulder, elbow, wrist }, clamped, tip }
}
