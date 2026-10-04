// Dev server only: the fold steps as SVG diagrams, for the folding manual printed on the flyer.
// Drawn from the same fold model as the game (fold.ts), projected with three's cameras; never in builds.
import * as THREE from 'three/webgpu'
import { createPaper, SHEET_H, SHEET_W } from './fold.ts'

type V3 = [number, number, number]
// Folds finished per figure (see STEPS in fold.ts), and where it is looked at from.
const TOP: V3 = [0, 0, 1]
const FIGURES: { done: number; from: V3; half?: number }[] = [
  { done: 2, from: TOP }, // side edges to the diagonals
  { done: 3, from: TOP }, // tip down
  { done: 5, from: TOP }, // top edges to the middle
  { done: 5, half: 0.5, from: [0.2, -0.5, 0.84] }, // folding in half: half-way, like a roof
  { done: 7, from: [-0.45, -0.5, -0.74] }, // wings out: the plane
]
const EPS = 0.02
// The fold lines printed on the flyer (sheet mm, origin bottom left): fewer than the model's creases, which also
// run through the hidden layers.
const PRINTED: [number, number, number, number][] = [
  [0, 87, 87, 297], // side edges
  [210, 87, 123, 297],
  [43.5, 192, 166.5, 192], // tip
  [0, 297, 210, 87], // the two diagonals
  [210, 297, 0, 87],
  [105, 0, 105, 192], // middle
  [72, 0, 103.8, 190.8], // wings
  [138, 0, 106.2, 190.8],
]

export type Figure = { colour: 'back' | 'front'; faces: number[][][]; lines: number[][]; creases: number[][] }[]

/**
 * Per figure: runs of faces to paint in order (far to near), each with its outline and the fold lines printed on it.
 * Coordinates in 0–size.
 */
export function figures(size = 400): Figure[] {
  const paper = createPaper()
  const { positions, uvs } = paper
  // fold.ts hands out triangle fans, one per flat face: put the faces back together.
  const faces: number[][] = []
  for (let t = 0; t < positions.length / 9; t++) {
    const [a, b, c] = [t * 3, t * 3 + 1, t * 3 + 2]
    const same = (i: number, j: number) => uvs[i * 2] === uvs[j * 2] && uvs[i * 2 + 1] === uvs[j * 2 + 1]
    const face = faces.at(-1)
    if (face && same(face[0], a) && same(face.at(-1)!, b)) face.push(c)
    else faces.push([a, b, c])
  }
  const camera = new THREE.OrthographicCamera(-160, 160, 160, -160, 1, 3000)
  const at = (i: number) => new THREE.Vector3().fromArray(positions, i * 3)

  return FIGURES.map(({ done, from, half }) => {
    const progress: number[] = Array.from({ length: paper.steps }, (_, k) => (k < done ? 1 : 0))
    paper.pose(progress)
    // While the two halves stand at an angle, depth can't tell their stacked layers apart (0.1 mm). Take the layer
    // order from the flat state just before, per half (where a face lies by then, not where it started on the sheet).
    const mean = (face: number[], axis: number) => face.reduce((sum, i) => sum + positions[i * 3 + axis], 0) / face.length
    const layer = half === undefined ? null : faces.map((face) => (mean(face, 0) > SHEET_W / 2 ? 1000 : 0) + mean(face, 2))
    if (half !== undefined) {
      progress[done] = half
      paper.pose(progress)
    }
    const centre = new THREE.Box3().setFromArray(positions).getCenter(new THREE.Vector3())
    const eye = new THREE.Vector3(...from).normalize()
    camera.position.copy(centre).addScaledVector(eye, 1000)
    camera.up.set(0, 1, 0)
    camera.lookAt(centre)
    camera.updateMatrixWorld()
    const project = (v: THREE.Vector3) => {
      const p = v.clone().project(camera)
      return [+(((p.x + 1) * size) / 2).toFixed(1), +(((1 - p.y) * size) / 2).toFixed(1)]
    }
    const drawn = faces.map((face, f) => {
      const points = face.map(at)
      // Newell's method: a face's first three corners may lie on one line.
      const normal = points.reduce((n, a, i) => n.add(a.clone().cross(points[(i + 1) % points.length])), new THREE.Vector3()).normalize()
      // larger = nearer. Halves: the right one is nearer to this camera; inside a half, the layer decides.
      const depth = layer ? layer[f] : points.reduce((sum, p) => sum + p.dot(eye), 0) / points.length
      // fold.ts folds towards its front, which on the flyer is the printed back (the game mirrors the sheet).
      const flat = face.map((i) => [uvs[i * 2] * SHEET_W, uvs[i * 2 + 1] * SHEET_H])
      return { points, flat, normal, depth, colour: (normal.dot(eye) > 0 ? 'back' : 'front') as 'back' | 'front' }
    })
    type Drawn = (typeof drawn)[number]
    // Outline: every edge that isn't shared with a face lying flush next to it.
    const outline = (face: Drawn) =>
      face.points.flatMap((p, i) => {
        const q = face.points[(i + 1) % face.points.length]
        const shared = drawn.some(
          (other) =>
            other !== face &&
            Math.abs(face.normal.dot(other.normal)) > 0.999 &&
            other.points.some((r, j) => {
              const s = other.points[(j + 1) % other.points.length]
              return (r.distanceTo(p) < EPS && s.distanceTo(q) < EPS) || (r.distanceTo(q) < EPS && s.distanceTo(p) < EPS)
            }),
        )
        return shared ? [] : [[...project(p), ...project(q)]]
      })
    // The printed lines on a face: clipped to its outline on the flat sheet, then carried along with the face.
    const printed = (face: Drawn) => {
      const flat = face.flat
      const turn = Math.sign(flat.reduce((sum, a, i) => sum + a[0] * flat[(i + 1) % flat.length][1] - flat[(i + 1) % flat.length][0] * a[1], 0))
      // two edges from the first corner that span the face
      const [o, O] = [flat[0], face.points[0]]
      let [j, k, best] = [1, 2, 0]
      for (let a = 1; a < flat.length; a++) {
        for (let b = a + 1; b < flat.length; b++) {
          const area = Math.abs((flat[a][0] - o[0]) * (flat[b][1] - o[1]) - (flat[a][1] - o[1]) * (flat[b][0] - o[0]))
          if (area > best) [j, k, best] = [a, b, area]
        }
      }
      const [u, v] = [[flat[j][0] - o[0], flat[j][1] - o[1]], [flat[k][0] - o[0], flat[k][1] - o[1]]]
      const det = u[0] * v[1] - u[1] * v[0]
      const lift = (x: number, y: number) => {
        const [dx, dy] = [x - o[0], y - o[1]]
        const [a, b] = [(dx * v[1] - dy * v[0]) / det, (u[0] * dy - u[1] * dx) / det]
        return O.clone().addScaledVector(face.points[j].clone().sub(O), a).addScaledVector(face.points[k].clone().sub(O), b)
      }
      return PRINTED.flatMap(([x1, y1, x2, y2]) => {
        let [t0, t1] = [0, 1]
        for (let i = 0; i < flat.length; i++) {
          const [p, q] = [flat[i], flat[(i + 1) % flat.length]]
          const side = (x: number, y: number) => turn * ((q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]))
          const [a, b] = [side(x1, y1), side(x2, y2)]
          if (a < -EPS && b < -EPS) return []
          if (a < -EPS) t0 = Math.max(t0, a / (a - b))
          else if (b < -EPS) t1 = Math.min(t1, a / (a - b))
        }
        if (t1 - t0 < 1e-3) return []
        const at = (t: number) => project(lift(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))
        return [[...at(t0), ...at(t1)]]
      })
    }
    // Painter's order; faces of one layer and side go into one run.
    const figure: Figure = []
    let depth = Infinity
    for (const face of drawn.sort((a, b) => a.depth - b.depth)) {
      const last = figure.at(-1)
      if (!last || last.colour !== face.colour || Math.abs(depth - face.depth) > EPS) figure.push({ colour: face.colour, faces: [], lines: [], creases: [] })
      const run = figure.at(-1)!
      run.faces.push(face.points.map(project))
      run.lines.push(...outline(face))
      // a line along the border of two faces comes up for both: keep one
      for (const c of printed(face)) if (!run.creases.some((d) => d.join() === c.join() || d.join() === [c[2], c[3], c[0], c[1]].join())) run.creases.push(c)
      depth = face.depth
    }
    return figure
  })
}

/** The same as SVG strings, for a look in the browser. */
export function manual(size = 400): string[] {
  return figures(size).map(
    (figure) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
      figure
        .map(
          (run) =>
            run.faces.map((f) => `<path d="M${f.map((p) => p.join(',')).join('L')}Z" fill="${run.colour === 'back' ? '#c9ced6' : '#fff'}"/>`).join('') +
            `<path d="${run.creases.map((l) => `M${l[0]},${l[1]}L${l[2]},${l[3]}`).join('')}" fill="none" stroke="#000" stroke-width="1" stroke-dasharray="1 3"/>` +
            `<path d="${run.lines.map((l) => `M${l[0]},${l[1]}L${l[2]},${l[3]}`).join('')}" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"/>`,
        )
        .join('') +
      '</svg>',
  )
}
