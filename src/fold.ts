import { Matrix4, Vector3 } from 'three/webgpu'

export const SHEET_W = 210
export const SHEET_H = 297

type V2 = [number, number]
/** The paper left of a→b rotates by `angle` around a→b (positive = towards the viewer). */
type Crease = { a: V2; b: V2; angle: number; ref?: number }
type Axis = { origin: Vector3; dir: Vector3; angle: number }
type Poly = {
  flat: V2[] // outline on the flat sheet (mm)
  mats: Matrix4[] // flat sheet → folded, at the start of each step
  axes: (Axis | null)[] // hinge this polygon turns around during each step
  offsets: V2[] // layer offset along the paper normal at start/end of each step
  layer: number
  now: Matrix4
  z: number
}

const DEG = Math.PI / 180
const LAYER = 0.4 // mm between stacked layers, against z-fighting
const EPS = 1e-4

// World-record glider, https://einfach-basteln.com/weltrekord/
// A4 in mm, origin bottom-left, front side facing the viewer (+z). The diagonal pre-creases of the
// tutorial meet at (105, 192); the pencil line is y = 87. Creases are drawn in the state at the start
// of their step, or of step `ref`.
const STEPS: Crease[][] = [
  [{ a: [0, 87], b: [87, 297], angle: 180 * DEG }], // left edge onto the diagonal crease
  [{ a: [123, 297], b: [210, 87], angle: 180 * DEG }], // right edge onto the diagonal crease
  [{ a: [0, 192], b: [210, 192], angle: 180 * DEG }], // tip down to the pencil line
  [{ a: [0, 87], b: [105, 192], angle: 180 * DEG }], // upper left edge to the middle
  [{ a: [105, 192], b: [210, 87], angle: 180 * DEG }], // upper right edge to the middle
  [
    // fold in half, folded sides outside (not quite 90° each, so the keel halves don't z-fight)
    { a: [105, 0], b: [105, 297], angle: -88 * DEG },
    { a: [105, 297], b: [105, 0], angle: -88 * DEG },
  ],
  [
    // wings out along the pencil lines
    { a: [72, 0], b: [104, 192], angle: 88 * DEG, ref: 5 },
    { a: [106, 192], b: [138, 0], angle: 88 * DEG, ref: 5 },
  ],
]

export type Paper = ReturnType<typeof createPaper>

export function createPaper() {
  const sheet: V2[] = [[0, 0], [SHEET_W, 0], [SHEET_W, SHEET_H], [0, SHEET_H]]
  let polys: Poly[] = [{ flat: sheet, mats: [new Matrix4()], axes: [], offsets: [], layer: 0, now: new Matrix4(), z: 0 }]

  STEPS.forEach((creases, k) => {
    for (const crease of creases) polys = polys.flatMap((poly) => split(poly, crease, crease.ref ?? k))

    const movers = new Set<Poly>()
    for (const poly of polys) {
      const start = poly.mats[k]
      const crease = creases.find((c) => side(c, centroid(poly, c.ref ?? k)) > EPS)
      if (!crease) {
        poly.axes.push(null)
        poly.mats.push(start)
        continue
      }
      // Carry the crease from its drawing state to where this polygon is now.
      const carry = start.clone().multiply(poly.mats[crease.ref ?? k].clone().invert())
      const origin = new Vector3(crease.a[0], crease.a[1], 0).applyMatrix4(carry)
      const dir = new Vector3(crease.b[0], crease.b[1], 0).applyMatrix4(carry).sub(origin).normalize()
      const axis = { origin, dir, angle: crease.angle }
      poly.axes.push(axis)
      poly.mats.push(hinge(axis, 1, new Matrix4()).multiply(start))
      movers.add(poly)
    }

    // A flat 180° fold puts the movers on top of the stack, in reverse order.
    const flat = creases.every((c) => Math.abs(c.angle) > 179 * DEG)
    const top = Math.max(...polys.map((p) => p.layer))
    const moverTop = Math.max(...[...movers].map((p) => p.layer))
    for (const poly of polys) {
      const start = poly.offsets.at(-1)?.[1] ?? 0
      if (flat && movers.has(poly)) poly.layer = top + 1 + moverTop - poly.layer
      // elements[10] is ±1 in flat states: which way the paper's own normal points.
      const end = flat ? poly.mats[k + 1].elements[10] * poly.layer * LAYER : start
      poly.offsets.push([start, end])
    }
  })

  const verts = polys.flatMap((poly) =>
    poly.flat.slice(2).flatMap((_, i) => [poly.flat[0], poly.flat[i + 1], poly.flat[i + 2]].map((p) => ({ poly, p }))),
  )
  const positions = new Float32Array(verts.length * 3)
  const uvs = new Float32Array(verts.flatMap(({ p }) => [p[0] / SHEET_W, p[1] / SHEET_H]))
  const v = new Vector3()
  const turn = new Matrix4()

  /** u = 0: flat sheet, u = steps: finished plane, fractions are mid-fold. Writes into `positions`. */
  function foldAt(u: number): void {
    const k = Math.min(Math.floor(u), STEPS.length - 1)
    const t = Math.min(u - k, 1)
    for (const poly of polys) {
      const axis = poly.axes[k]
      poly.now.copy(poly.mats[k])
      if (axis) poly.now.premultiply(hinge(axis, t, turn))
      const [start, end] = poly.offsets[k]
      poly.z = start + (end - start) * t
    }
    verts.forEach(({ poly, p }, i) => {
      v.set(p[0], p[1], poly.z).applyMatrix4(poly.now)
      positions[i * 3] = v.x
      positions[i * 3 + 1] = v.y
      positions[i * 3 + 2] = v.z
    })
  }

  foldAt(0)
  return { steps: STEPS.length, positions, uvs, foldAt }
}

function split(poly: Poly, crease: Crease, ref: number): Poly[] {
  const m = poly.mats[ref]
  const d = poly.flat.map(([x, y]) => side(crease, project(m, x, y)))
  if (d.every((s) => s > -EPS) || d.every((s) => s < EPS)) return [poly]

  const left: V2[] = []
  const right: V2[] = []
  poly.flat.forEach((p, i) => {
    const j = (i + 1) % poly.flat.length
    const q = poly.flat[j]
    if (d[i] > -EPS) left.push(p)
    if (d[i] < EPS) right.push(p)
    if ((d[i] > EPS && d[j] < -EPS) || (d[i] < -EPS && d[j] > EPS)) {
      const t = d[i] / (d[i] - d[j])
      const cut: V2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
      left.push(cut)
      right.push(cut)
    }
  })
  return [left, right]
    .filter((flat) => area(flat) > 1e-3)
    .map((flat) => ({ ...poly, flat, mats: [...poly.mats], axes: [...poly.axes], offsets: [...poly.offsets], now: new Matrix4() }))
}

function side({ a, b }: Crease, [x, y]: V2): number {
  return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
}

function project(m: Matrix4, x: number, y: number): V2 {
  const v = new Vector3(x, y, 0).applyMatrix4(m)
  return [v.x, v.y]
}

function centroid(poly: Poly, ref: number): V2 {
  const points = poly.flat.map(([x, y]) => project(poly.mats[ref], x, y))
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length]
}

function area(flat: V2[]): number {
  return Math.abs(flat.reduce((s, p, i) => s + p[0] * flat[(i + 1) % flat.length][1] - flat[(i + 1) % flat.length][0] * p[1], 0)) / 2
}

const tmp = new Matrix4()
function hinge({ origin, dir, angle }: Axis, amount: number, out: Matrix4): Matrix4 {
  return out
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(tmp.makeRotationAxis(dir, angle * amount))
    .multiply(tmp.makeTranslation(-origin.x, -origin.y, -origin.z))
}
