import { Matrix4, Vector3 } from 'three/webgpu'

export const SHEET_W = 210
export const SHEET_H = 297

type V2 = [number, number]
/** The paper left of a→b turns by `angle` around a→b (positive = towards the viewer). */
type Crease = { a: V2; b: V2; angle: number }
type Step = {
  at: number // start in fold units; each fold takes one unit
  ref?: number // step whose starting state the creases are drawn in (default: this step)
  creases: Crease[]
}
type Hinge = { origin: Vector3; dir: Vector3; angle: number }
type Poly = {
  flat: V2[] // outline on the flat sheet (mm)
  mats: Matrix4[] // flat sheet → folded, at the start of each step
  hinges: (Hinge | null)[] // per step, in the coordinates of the step's ref state
  offsets: V2[] // layer offset along the paper normal at start/end of each step
  layer: number
  now: Matrix4
  z: number
}

const DEG = Math.PI / 180
const LAYER = 0.1 // mm between stacked layers (about real paper): pieces look joined, but don't z-fight
const EPS = 1e-4

// World-record glider, https://einfach-basteln.com/weltrekord/
// A4 in mm, origin bottom-left, front side facing the viewer (+z). The diagonal pre-creases of the tutorial
// meet at (105, 192); the pencil line is y = 87. Folds overlap a little so the motion flows; mirrored folds
// overlap more, the second one lands after the first.
const STEPS: Step[] = [
  { at: 0, creases: [{ a: [0, 87], b: [87, 297], angle: 180 * DEG }] }, // left edge onto the diagonal crease
  { at: 0.55, creases: [{ a: [123, 297], b: [210, 87], angle: 180 * DEG }] }, // right edge onto the diagonal crease
  { at: 1.45, creases: [{ a: [0, 192], b: [210, 192], angle: 180 * DEG }] }, // tip down to the pencil line
  { at: 2.4, creases: [{ a: [0, 87], b: [105, 192], angle: 180 * DEG }] }, // upper left edge to the middle
  { at: 2.95, creases: [{ a: [105, 192], b: [210, 87], angle: 180 * DEG }] }, // upper right edge to the middle
  {
    at: 3.9, // fold in half, folded sides outside (not quite 90° each, so the keel halves don't touch)
    creases: [
      { a: [105, 0], b: [105, 297], angle: -88 * DEG },
      { a: [105, 297], b: [105, 0], angle: -88 * DEG },
    ],
  },
  {
    at: 4.5, // wings out along the pencil lines, drawn on the sheet before the half fold
    ref: 5,
    creases: [
      { a: [72, 0], b: [104, 192], angle: 88 * DEG },
      { a: [106, 192], b: [138, 0], angle: 88 * DEG },
    ],
  },
]
const UNITS = STEPS[STEPS.length - 1].at + 1

// Hinges apply in the order of the state their crease is drawn in. Within one state the later step goes first,
// so the wings (drawn before the half fold) ride along with it.
const ORDER = STEPS.map((_, j) => j).sort((i, j) => (STEPS[i].ref ?? i) - (STEPS[j].ref ?? j) || j - i)

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2)

export type Paper = ReturnType<typeof createPaper>

export function createPaper() {
  const sheet: V2[] = [[0, 0], [SHEET_W, 0], [SHEET_W, SHEET_H], [0, SHEET_H]]
  let polys: Poly[] = [{ flat: sheet, mats: [new Matrix4()], hinges: [], offsets: [], layer: 0, now: new Matrix4(), z: 0 }]

  STEPS.forEach((step, k) => {
    const ref = step.ref ?? k
    for (const crease of step.creases) polys = polys.flatMap((poly) => split(poly, crease, ref))

    const movers = new Set<Poly>()
    for (const poly of polys) {
      const start = poly.mats[k]
      const crease = step.creases.find((c) => side(c, centroid(poly, ref)) > EPS)
      if (!crease) {
        poly.hinges.push(null)
        poly.mats.push(start)
        continue
      }
      const hinge = {
        origin: new Vector3(crease.a[0], crease.a[1], 0),
        dir: new Vector3(crease.b[0] - crease.a[0], crease.b[1] - crease.a[1], 0).normalize(),
        angle: crease.angle,
      }
      poly.hinges.push(hinge)
      // Folded state after this step: the hinge carried from its ref state to where the polygon is now.
      const carry = start.clone().multiply(poly.mats[ref].clone().invert())
      poly.mats.push(carry.multiply(rotation(hinge, 1, new Matrix4())).multiply(poly.mats[ref]))
      movers.add(poly)
    }

    // A flat 180° fold lands the movers upside down: the old top of the stack at the bottom. Each one goes
    // right above whatever it actually overlaps, so stacks stay as thin as the real paper.
    const flat = step.creases.every((c) => Math.abs(c.angle) > 179 * DEG)
    const starts = new Map(polys.map((p) => [p, p.offsets.at(-1)?.[1] ?? 0]))
    if (flat) {
      const outline = new Map(polys.map((p) => [p, p.flat.map(([x, y]) => project(p.mats[k + 1], x, y))]))
      const placed = polys.filter((p) => !movers.has(p))
      for (const mover of [...movers].sort((a, b) => b.layer - a.layer)) {
        const below = placed.filter((p) => overlaps(outline.get(p)!, outline.get(mover)!))
        mover.layer = Math.max(-1, ...below.map((p) => p.layer)) + 1
        placed.push(mover)
      }
    }
    for (const poly of polys) {
      const start = starts.get(poly)!
      // elements[10] is ±1 in flat states: which way this polygon's own normal points.
      poly.offsets.push([start, flat ? poly.mats[k + 1].elements[10] * poly.layer * LAYER : start])
    }
  })

  const verts = polys.flatMap((poly) =>
    poly.flat.slice(2).flatMap((_, i) => [poly.flat[0], poly.flat[i + 1], poly.flat[i + 2]].map((p) => ({ poly, p }))),
  )
  const positions = new Float32Array(verts.length * 3)
  const uvs = new Float32Array(verts.flatMap(({ p }) => [p[0] / SHEET_W, p[1] / SHEET_H]))
  const v = new Vector3()
  const turn = new Matrix4()

  /** Progress (0–1) per step. Writes into `positions`. */
  function pose(progress: number[]): void {
    for (const poly of polys) {
      poly.now.identity()
      for (const j of ORDER) {
        const hinge = poly.hinges[j]
        if (hinge && progress[j] > 0) poly.now.premultiply(rotation(hinge, progress[j], turn))
      }
      poly.z = poly.offsets.reduce((z, [start, end], j) => z + (end - start) * progress[j], 0)
    }
    verts.forEach(({ poly, p }, i) => {
      v.set(p[0], p[1], poly.z).applyMatrix4(poly.now)
      positions[i * 3] = v.x
      positions[i * 3 + 1] = v.y
      positions[i * 3 + 2] = v.z
    })
  }

  /** 0 = flat sheet, 1 = finished plane, eased and overlapping in between. */
  function foldAt(u: number): void {
    pose(STEPS.map((step) => ease(u * UNITS - step.at)))
  }

  foldAt(0)
  return { steps: STEPS.length, positions, uvs, pose, foldAt }
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
    .map((flat) => ({ ...poly, flat, mats: [...poly.mats], hinges: [...poly.hinges], offsets: [...poly.offsets], now: new Matrix4() }))
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

// Separating axis test for convex outlines. Touching edges don't count as overlapping.
function overlaps(a: V2[], b: V2[]): boolean {
  for (const outline of [a, b]) {
    for (let i = 0; i < outline.length; i++) {
      const p = outline[i]
      const q = outline[(i + 1) % outline.length]
      const nx = q[1] - p[1]
      const ny = p[0] - q[0]
      const length = Math.hypot(nx, ny)
      if (length < EPS) continue
      const along = ([x, y]: V2) => (x * nx + y * ny) / length
      const pa = a.map(along)
      const pb = b.map(along)
      if (Math.max(...pa) <= Math.min(...pb) + 0.01 || Math.max(...pb) <= Math.min(...pa) + 0.01) return false
    }
  }
  return true
}

const tmp = new Matrix4()
function rotation({ origin, dir, angle }: Hinge, amount: number, out: Matrix4): Matrix4 {
  return out
    .makeTranslation(origin.x, origin.y, origin.z)
    .multiply(tmp.makeRotationAxis(dir, angle * amount))
    .multiply(tmp.makeTranslation(-origin.x, -origin.y, -origin.z))
}
