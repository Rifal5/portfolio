// Tiny dense linear algebra for small (<=6x6) matrices — just enough for the
// control library (Riccati/LQR iteration and the Kalman filter). Matrices are
// plain arrays-of-arrays of numbers; vectors are plain number arrays. Nothing
// here is performance-critical (it runs offline for gains, and on ~6x6 state
// online), so it favours clarity over cleverness. No external deps.

export function zeros(rows, cols) {
  return Array.from({ length: rows }, () => new Array(cols).fill(0))
}

export function identity(n) {
  const I = zeros(n, n)
  for (let i = 0; i < n; i++) I[i][i] = 1
  return I
}

export function diag(values) {
  const n = values.length
  const D = zeros(n, n)
  for (let i = 0; i < n; i++) D[i][i] = values[i]
  return D
}

export function transpose(A) {
  return A[0].map((_, j) => A.map(row => row[j]))
}

export function matMul(A, B) {
  const r = A.length, k = A[0].length, c = B[0].length
  const out = zeros(r, c)
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++) {
      let s = 0
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j]
      out[i][j] = s
    }
  return out
}

export function matAdd(A, B) { return A.map((row, i) => row.map((v, j) => v + B[i][j])) }
export function matSub(A, B) { return A.map((row, i) => row.map((v, j) => v - B[i][j])) }
export function matScale(A, s) { return A.map(row => row.map(v => v * s)) }

// Matrix * column-vector -> vector.
export function matVec(A, v) {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0))
}

// Column vector <-> single-column matrix helpers (RK4/LQR pass vectors around).
export function colVec(v) { return v.map(x => [x]) }
export function flatCol(M) { return M.map(row => row[0]) }

// Gauss-Jordan inverse with partial pivoting. Throws on singular input — small
// enough that the caller can catch and fall back if needed.
export function inv(M) {
  const n = M.length
  const A = M.map((row, i) => [...row, ...identity(n)[i]])
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-12) throw new Error('inv: singular matrix')
    ;[A[col], A[piv]] = [A[piv], A[col]]
    const d = A[col][col]
    for (let j = 0; j < 2 * n; j++) A[col][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col]
      if (f === 0) continue
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[col][j]
    }
  }
  return A.map(row => row.slice(n))
}
