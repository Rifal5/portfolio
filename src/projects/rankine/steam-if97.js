// Water/steam properties via the IAPWS-IF97 industrial formulation.
// Regions implemented: 1 (compressed liquid), 2 (superheated vapor), 4 (saturation).
// Valid here for P ≈ 0.01–160 bar, T up to 700 °C — the whole builder envelope.
// Units at the public API: P in bar, T in °C, h in kJ/kg, s in kJ/kg·K, v in m³/kg.

const R = 0.461526          // kJ/(kg·K)
const K = 273.15

// ── Region 4: saturation line ────────────────────────────────────────────────
const N4 = [
  0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2,
  0.12020824702470e5, -0.32325550322333e7, 0.14915108613530e2,
  -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849,
  0.65017534844798e3,
]

function psatMPa(T_K) {
  const th = T_K + N4[8] / (T_K - N4[9])
  const A = th * th + N4[0] * th + N4[1]
  const B = N4[2] * th * th + N4[3] * th + N4[4]
  const C = N4[5] * th * th + N4[6] * th + N4[7]
  const x = 2 * C / (-B + Math.sqrt(B * B - 4 * A * C))
  return x * x * x * x
}

function tsatK(p_MPa) {
  const b = Math.pow(p_MPa, 0.25)
  const E = b * b + N4[2] * b + N4[5]
  const F = N4[0] * b * b + N4[3] * b + N4[6]
  const G = N4[1] * b * b + N4[4] * b + N4[7]
  const D = 2 * G / (-F - Math.sqrt(F * F - 4 * E * G))
  return 0.5 * (N4[9] + D - Math.sqrt((N4[9] + D) * (N4[9] + D) - 4 * (N4[8] + N4[9] * D)))
}

// ── Region 1: compressed liquid ──────────────────────────────────────────────
const I1 = [0,0,0,0,0,0,0,0,1,1,1,1,1,1,2,2,2,2,2,3,3,3,4,4,4,5,8,8,21,23,29,30,31,32]
const J1 = [-2,-1,0,1,2,3,4,5,-9,-7,-1,0,1,3,-3,0,1,3,17,-4,0,6,-5,-2,10,-8,-11,-6,-29,-31,-38,-39,-40,-41]
const n1 = [
  0.14632971213167, -0.84548187169114, -0.37563603672040e1, 0.33855169168385e1,
  -0.95791963387872, 0.15772038513228, -0.16616417199501e-1, 0.81214629983568e-3,
  0.28319080123804e-3, -0.60706301565874e-3, -0.18990068218419e-1, -0.32529748770505e-1,
  -0.21841717175414e-1, -0.52838357969930e-4, -0.47184321073267e-3, -0.30001780793026e-3,
  0.47661393906987e-4, -0.44141845330846e-5, -0.72694996297594e-15, -0.31679644845054e-4,
  -0.28270797985312e-5, -0.85205128120103e-9, -0.22425281908000e-5, -0.65171222895601e-6,
  -0.14341729937924e-12, -0.40516996860117e-6, -0.12734301741641e-8, -0.17424871230634e-9,
  -0.68762131295531e-18, 0.14478307828521e-19, 0.26335781662795e-22, -0.11947622640071e-22,
  0.18228094581404e-23, -0.93537087292458e-25,
]

function region1(p_MPa, T_K) {
  const pi = p_MPa / 16.53
  const tau = 1386 / T_K
  const a = 7.1 - pi, b = tau - 1.222
  let g = 0, gp = 0, gt = 0
  for (let i = 0; i < 34; i++) {
    const pa = Math.pow(a, I1[i]), tb = Math.pow(b, J1[i])
    g += n1[i] * pa * tb
    gp -= n1[i] * I1[i] * Math.pow(a, I1[i] - 1) * tb
    gt += n1[i] * pa * J1[i] * Math.pow(b, J1[i] - 1)
  }
  return {
    v: R * T_K * pi * gp / (p_MPa * 1000),
    h: R * T_K * tau * gt,
    s: R * (tau * gt - g),
  }
}

// ── Region 2: superheated vapor ──────────────────────────────────────────────
const J0 = [0, 1, -5, -4, -3, -2, -1, 2, 3]
const n0 = [
  -0.96927686500217e1, 0.10086655968018e2, -0.56087911283020e-2,
  0.71452738081455e-1, -0.40710498223928, 0.14240819171444e1,
  -0.43839511319450e1, -0.28408632460772, 0.21268463753307e-1,
]
const I2 = [1,1,1,1,1,2,2,2,2,2,3,3,3,3,3,4,4,4,5,6,6,6,7,7,7,8,8,9,10,10,10,16,16,18,20,20,20,21,22,23,24,24,24]
const J2 = [0,1,2,3,6,1,2,4,7,36,0,1,3,6,35,1,2,3,7,3,16,35,0,11,25,8,36,13,4,10,14,29,50,57,20,35,48,21,53,39,26,40,58]
const n2 = [
  -0.17731742473213e-2, -0.17834862292358e-1, -0.45996013696365e-1,
  -0.57581259083432e-1, -0.50325278727930e-1, -0.33032641670203e-4,
  -0.18948987516315e-3, -0.39392777243355e-2, -0.43797295650573e-1,
  -0.26674547914087e-4, 0.20481737692309e-7, 0.43870667284435e-6,
  -0.32277677238570e-4, -0.15033924542148e-2, -0.40668253562649e-1,
  -0.78847309559367e-9, 0.12790717852285e-7, 0.48225372718507e-6,
  0.22922076337661e-5, -0.16714766451061e-10, -0.21171472321355e-2,
  -0.23895741934104e2, -0.59059564324270e-17, -0.12621808899101e-5,
  -0.38946842435739e-1, 0.11256211360459e-10, -0.82311340897998e1,
  0.19809712802088e-7, 0.10406965210174e-18, -0.10234747095929e-12,
  -0.10018179379511e-8, -0.80882908646985e-10, 0.10693031879409,
  -0.33662250574171, 0.89185845355421e-24, 0.30629316876232e-12,
  -0.42002467698208e-5, -0.59056029685639e-25, 0.37826947613457e-5,
  -0.12768608934681e-14, 0.73087610595061e-28, 0.55414715350778e-16,
  -0.94369707241210e-6,
]

function region2(p_MPa, T_K) {
  const pi = p_MPa
  const tau = 540 / T_K
  let g0 = Math.log(pi), g0t = 0
  for (let i = 0; i < 9; i++) {
    g0 += n0[i] * Math.pow(tau, J0[i])
    g0t += n0[i] * J0[i] * Math.pow(tau, J0[i] - 1)
  }
  const b = tau - 0.5
  let gr = 0, grp = 0, grt = 0
  for (let i = 0; i < 43; i++) {
    const pp = Math.pow(pi, I2[i]), tb = Math.pow(b, J2[i])
    gr += n2[i] * pp * tb
    grp += n2[i] * I2[i] * Math.pow(pi, I2[i] - 1) * tb
    grt += n2[i] * pp * J2[i] * Math.pow(b, J2[i] - 1)
  }
  return {
    v: R * T_K * (1 + pi * grp) / (p_MPa * 1000),
    h: R * T_K * tau * (g0t + grt),
    s: R * (tau * (g0t + grt) - (g0 + gr)),
  }
}

// ── Public API (P in bar, T in °C) ───────────────────────────────────────────
export function satByP(P_bar) {
  const p = P_bar / 10
  const T_K = tsatK(p)
  const liq = region1(p, T_K)
  const vap = region2(p, T_K)
  return { P: P_bar, Tsat: T_K - K, hf: liq.h, hg: vap.h, sf: liq.s, sg: vap.s, vf: liq.v, vg: vap.v }
}

export function superheated(P_bar, T_C) {
  const p = P_bar / 10
  const Tsat = tsatK(p) - K
  const T = Math.max(T_C, Tsat + 0.01)
  const st = region2(p, T + K)
  return { P: P_bar, T, h: st.h, s: st.s, v: st.v }
}

// Compressed-liquid state at (P, T) — for closed-FWH feedwater outlet targets.
export function liquidPT(P_bar, T_C) {
  const st = region1(P_bar / 10, T_C + K)
  return { P: P_bar, T: T_C, h: st.h, s: st.s, v: st.v }
}

function bisect(f, lo, hi, iters = 60) {
  let flo = f(lo)
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (flo * fm <= 0) hi = mid
    else { lo = mid; flo = fm }
  }
  return (lo + hi) / 2
}

// State at pressure P with known entropy (isentropic expansion endpoint).
export function stateFromPS(P_bar, s) {
  const sat = satByP(P_bar)
  const p = P_bar / 10
  if (s >= sat.sg) {
    const T = bisect(Tc => region2(p, Tc + K).s - s, sat.Tsat, 800)
    const st = region2(p, T + K)
    return { P: P_bar, T, h: st.h, s, x: null }
  }
  if (s <= sat.sf) {
    const T = bisect(Tc => region1(p, Tc + K).s - s, 0.01, sat.Tsat)
    const st = region1(p, T + K)
    return { P: P_bar, T, h: st.h, s, x: null }
  }
  const x = (s - sat.sf) / (sat.sg - sat.sf)
  return { P: P_bar, T: sat.Tsat, h: sat.hf + x * (sat.hg - sat.hf), s, x }
}

// State at pressure P with known enthalpy.
export function stateFromPH(P_bar, h) {
  const sat = satByP(P_bar)
  const p = P_bar / 10
  if (h >= sat.hg) {
    const T = bisect(Tc => region2(p, Tc + K).h - h, sat.Tsat, 800)
    const st = region2(p, T + K)
    return { P: P_bar, T, h, s: st.s, x: null }
  }
  if (h <= sat.hf) {
    const T = bisect(Tc => region1(p, Tc + K).h - h, 0.01, sat.Tsat)
    const st = region1(p, T + K)
    return { P: P_bar, T, h, s: st.s, x: null }
  }
  const x = (h - sat.hf) / (sat.hg - sat.hf)
  return { P: P_bar, T: sat.Tsat, h, s: sat.sf + x * (sat.sg - sat.sf), x }
}

// Saturation dome for the T-s plot (liquid + vapor branches, up to 350 °C,
// closed with the critical point apex).
export function domePoints() {
  const liq = [], vap = []
  for (let T = 5; T <= 350; T += 5) {
    const p = psatMPa(T + K)
    const l = region1(p, T + K), v = region2(p, T + K)
    liq.push({ s: l.s, T })
    vap.push({ s: v.s, T })
  }
  const crit = { s: 4.412, T: 373.95 }
  liq.push(crit); vap.push(crit)
  return { liq, vap }
}

