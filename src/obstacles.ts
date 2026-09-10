// Stylized low-poly obstacle models, built from the same numbers as the hitboxes in game.ts.
import * as THREE from 'three/webgpu'
import { clamp, color, float, fwidth, min, mix, modelPosition, mx_noise_float, positionLocal, smoothstep, time, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import {
  DRUM_H,
  DRUM_R,
  FLAME_H,
  FLAME_W,
  GAP,
  LOGS_W,
  MOUNTAIN_BASE,
  mountainScale,
  type Obstacle,
  WIND_W,
  WORLD_H,
} from './game.ts'

export type ObstacleView = {
  group: THREE.Group
  /** 0 = out of view (top parts above, bottom parts below the screen), 1 = in place. */
  slide(k: number): void
  update(seconds: number): void
  dispose(): void
}

const STRAP = 0.28 // strap between hanging drums
const FAR = WORLD_H / 2 + 0.6 // columns reach a bit past the screen edge

type V3 = [number, number, number]
type Paint = (triangle: number, centroid: V3) => THREE.ColorRepresentation

// Shared material: flat-shaded vertex colours for everything but fire and leaves.
const paint = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.65, side: THREE.DoubleSide })

export function createObstacleView(o: Obstacle): ObstacleView {
  const random = seeded(o.seed)
  const group = new THREE.Group()
  const top = new THREE.Group()
  const bottom = new THREE.Group()
  const wind = new THREE.Group()
  top.name = 'top'
  bottom.name = 'bottom'
  wind.name = 'wind'
  group.add(top, bottom, wind)
  const disposables: { dispose(): void }[] = []
  const gapTop = o.gapY + GAP / 2
  const gapBottom = o.gapY - GAP / 2

  if (o.top === 'drums') top.add(hangingDrums(gapTop, random, disposables))
  if (o.bottom === 'drums') bottom.add(drumStack(gapBottom, random, disposables))
  if (o.bottom === 'matterhorn') bottom.add(matterhorn(o, gapBottom))
  if (o.bottom === 'fire') bottom.add(fire(gapBottom, random, disposables))

  let leaves: ((seconds: number) => void) | undefined
  if (o.wind) {
    const zone = leafZone(-FAR, o.top ? gapTop : FAR, random) // wind columns never have a bottom part
    wind.add(zone.mesh)
    disposables.push(zone.mesh)
    leaves = zone.update
  }

  return {
    group,
    slide(k) {
      top.position.y = (1 - k) * WORLD_H
      bottom.position.y = -(1 - k) * WORLD_H
      wind.position.y = bottom.position.y // leaves blow in from below
      group.visible = k > 0
    },
    update(seconds) {
      leaves?.(seconds)
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
}

// Basler Trommel: squat chrome shell, black-and-white striped hoops, zig-zag cords with leather tensioners.
const drumGeometry = (() => {
  const r = DRUM_R
  const h = DRUM_H
  const parts: [THREE.BufferGeometry, Paint][] = []
  const shell = new THREE.CylinderGeometry(r * 0.96, r * 0.96, h * 0.74, 18, 1, true)
  parts.push([shell, (t) => (Math.floor(t / 2) % 2 ? '#dfe3e7' : '#b3b9bf')])
  parts.push([new THREE.CircleGeometry(r * 0.96, 18).rotateX(-Math.PI / 2).translate(0, h * 0.36, 0), () => '#efe7d4'])

  const segments = 24
  for (const y of [h * 0.43, -h * 0.43]) {
    const hoop = new THREE.CylinderGeometry(r, r, h * 0.14, segments, 1, true).toNonIndexed()
    const p = hoop.getAttribute('position')
    const a = (Math.PI * 2) / segments // shift the top ring by one segment: diagonal stripes
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) <= 0) continue
      const x = p.getX(i)
      const z = p.getZ(i)
      p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), p.getY(i), x * Math.sin(a) + z * Math.cos(a))
    }
    parts.push([hoop.translate(0, y, 0), (t) => (Math.floor(t / 2) % 2 ? '#151515' : '#f5f5f2')])
  }

  const points = Array.from({ length: 20 }, (_, k) => {
    const angle = (k / 20) * Math.PI * 2
    return new THREE.Vector3(Math.cos(angle) * r * 1.01, k % 2 ? -h * 0.34 : h * 0.34, Math.sin(angle) * r * 1.01)
  })
  const cords = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0), 160, 0.013, 3, true)
  parts.push([cords, () => '#ede6d3'])
  points.forEach((point, k) => {
    const next = points[(k + 1) % points.length]
    const from = point.y > 0 ? point : next
    const to = point.y > 0 ? next : point
    const at = from.clone().lerp(to, 0.3).multiplyScalar(1.02)
    const tensioner = new THREE.BoxGeometry(0.045, 0.08, 0.035).rotateY(-Math.atan2(at.z, at.x)).translate(at.x, at.y, at.z)
    parts.push([tensioner, () => '#2a211b'])
  })
  return merge(parts)
})()

const sticksGeometry = merge(
  [0.45, -0.45].map((yaw) => [
    new THREE.CylinderGeometry(0.016, 0.022, 0.72, 6).rotateZ(Math.PI / 2).rotateY(yaw).translate(0, DRUM_H * 0.36 + 0.03, 0),
    () => '#d9c29a',
  ]),
)
const strapGeometry = new THREE.BoxGeometry(0.08, 1, 0.025)
const leather = new THREE.MeshStandardMaterial({ color: '#3a2a1f', roughness: 0.8 })

function hangingDrums(gapTop: number, random: () => number, disposables: { dispose(): void }[]): THREE.Group {
  const group = new THREE.Group()
  const count = Math.max(1, Math.ceil((FAR - gapTop) / (DRUM_H + STRAP)))
  const drums = new THREE.InstancedMesh(drumGeometry, paint, count)
  for (let i = 0; i < count; i++) {
    const y = gapTop + DRUM_H / 2 + i * (DRUM_H + STRAP)
    drums.setMatrixAt(i, pose(0, y, random() * Math.PI * 2, (random() - 0.5) * 0.1))
  }
  // One strap through the whole column: hidden inside the drums, visible between them.
  const strap = new THREE.Mesh(strapGeometry, leather)
  strap.scale.y = FAR + 1 - gapTop
  strap.position.y = gapTop + strap.scale.y / 2
  group.add(drums, strap)
  disposables.push(drums)
  return group
}

function drumStack(gapBottom: number, random: () => number, disposables: { dispose(): void }[]): THREE.Group {
  const group = new THREE.Group()
  const count = Math.max(1, Math.ceil((gapBottom + FAR) / DRUM_H))
  const drums = new THREE.InstancedMesh(drumGeometry, paint, count)
  for (let i = 0; i < count; i++) {
    drums.setMatrixAt(i, pose((random() - 0.5) * 0.04, gapBottom - DRUM_H / 2 - i * DRUM_H, random() * Math.PI * 2, 0))
  }
  const sticks = new THREE.Mesh(sticksGeometry, paint)
  sticks.position.y = gapBottom - DRUM_H / 2
  sticks.rotation.y = random() * Math.PI
  group.add(drums, sticks)
  disposables.push(drums)
  return group
}

// Matterhorn from Zermatt: hooked summit left of centre, steep Furggen ridge on the left, Hörnli ridge towards
// the viewer, shaded north face on the right. Normalised to height 1; stays inside the hitbox triangle.
const mountainGeometry = (() => {
  const A: V3 = [-0.12, 1, 0]
  const N: V3 = [-0.17, 0.93, 0.03]
  const LS: V3 = [-0.32, 0.6, 0.05]
  const LB: V3 = [-0.58, 0, 0.1]
  const HS: V3 = [0.08, 0.72, 0.12]
  const RK: V3 = [0.24, 0.55, 0]
  const RB: V3 = [0.75, 0, 0]
  const FK: V3 = [0, 0.65, 0.22]
  const FB: V3 = [0.05, 0, 0.45]
  const east: V3[][] = [[A, N, LS], [A, LS, FK], [A, FK, HS], [LS, LB, FK], [LB, FB, FK]]
  const north: V3[][] = [[A, HS, RK], [HS, FK, FB], [HS, FB, RB], [HS, RB, RK]]

  const snowy = (shade: 'east' | 'north'): Paint => (_, [x, y]) => {
    const line = (shade === 'north' ? 0.5 : 0.7) + (hash(x, y, 1) - 0.5) * 0.14
    if (y > line) return shade === 'north' ? '#dde4ee' : '#f2f4f7'
    if (y < 0.1) return '#8f8a80'
    return shade === 'north' ? '#5f5b59' : hash(x, y, 2) > 0.5 ? '#7a7066' : '#6b5a4a'
  }
  return merge([
    [triangles(subdivide(east, 2)), snowy('east')],
    [triangles(subdivide(north, 2)), snowy('north')],
  ])
})()

function matterhorn(o: Obstacle, gapBottom: number): THREE.Mesh {
  const mesh = new THREE.Mesh(mountainGeometry, paint)
  const s = mountainScale(o)
  mesh.scale.set(s, gapBottom - MOUNTAIN_BASE, s * 0.8)
  mesh.position.y = MOUNTAIN_BASE
  return mesh
}

// Fire: a crossed log pile up to the flames, then a flame card cut out of animated noise (TSL). Opaque cut-out
// instead of blending, so it reads on a light page and needs no sorting.
const TIP = 0.35 // flame tongues flicker this far above/below the hitbox tip
const aaStep = (edge: number, v: Node<'float'>) => smoothstep(float(edge).sub(fwidth(v)), float(edge).add(fwidth(v)), v)

const flameMaterial = (() => {
  const x = positionLocal.x
  const h = positionLocal.y // 0 on the logs, FLAME_H at the hitbox tip
  const halfWidth = mix(float(FLAME_W / 2), float(0.18), clamp(h.div(FLAME_H), 0, 1))
  const seed = modelPosition.y.mul(0.37) // differs per obstacle, so neighbouring fires don't flicker in sync
  const n = mx_noise_float(vec3(x.div(halfWidth).mul(1.6), h.mul(1.1).sub(time.mul(2.4)), time.mul(0.7).add(seed)))
  const tongues = n.abs().oneMinus().mul(TIP * 2).sub(TIP) // ridged noise: pointy tips
  const top = float(FLAME_H).sub(h).add(tongues)
  const sides = halfWidth.sub(x.abs()).sub(n.mul(0.5).add(0.5).mul(0.12)) // wobbles inward only, never past the hitbox
  const inside = min(top, sides) // roughly the distance to the flame outline, > 0 inside
  const core = inside.add(n.mul(0.1))

  const material = new THREE.MeshBasicNodeMaterial({ alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide })
  material.colorNode = mix(mix(color(0xd7301f), color(0xf7862a), aaStep(0.1, core)), color(0xffd447), aaStep(0.28, core))
  material.opacityNode = aaStep(0, inside)
  return material
})()
const flameGeometry = new THREE.PlaneGeometry(FLAME_W, FLAME_H + TIP + 0.2).translate(0, (FLAME_H + TIP + 0.2) / 2 - 0.2, 0)
const logGeometry = new THREE.CylinderGeometry(0.11, 0.11, LOGS_W, 7).rotateZ(Math.PI / 2)
const wood = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.9 })
const WOOD = ['#6b4226', '#7a4a2a', '#8b5a2b', '#5a3a22']

function fire(gapBottom: number, random: () => number, disposables: { dispose(): void }[]): THREE.Group {
  const group = new THREE.Group()
  const flameBase = gapBottom - FLAME_H
  const layers = Math.max(1, Math.ceil((flameBase + FAR) / 0.2))
  const logs = new THREE.InstancedMesh(logGeometry, wood, layers * 2)
  const tint = new THREE.Color()
  for (let layer = 0; layer < layers; layer++) {
    const y = flameBase - 0.11 - layer * 0.2
    const across = layer % 2 === 1 // alternate directions, like a stacked woodpile
    for (const side of [-1, 1]) {
      const i = layer * 2 + (side + 1) / 2
      const offset = side * (across ? 0.35 : 0.3)
      logs.setMatrixAt(i, pose(across ? offset : 0, y, across ? Math.PI / 2 : 0, 0, across ? 0 : offset))
      logs.setColorAt(i, tint.set(WOOD[Math.floor(random() * WOOD.length)]))
    }
  }
  const flame = new THREE.Mesh(flameGeometry, flameMaterial)
  flame.position.set(0, flameBase, 0.05)
  group.add(logs, flame)
  disposables.push(logs)
  return group
}

// Updraft: autumn leaves rising, swaying and tumbling. CPU-animated instances, cheap at these counts.
const leafGeometry = (() => {
  const g = new THREE.BufferGeometry()
  // Two triangles folded along the midrib.
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.09, 0, -0.055, 0, 0.02, 0, -0.09, 0, 0, 0.09, 0, 0, -0.09, 0, 0.055, 0, 0.02], 3))
  g.computeVertexNormals()
  return g
})()
const leafMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.8, side: THREE.DoubleSide })
const LEAVES = ['#b83a1b', '#e0701f', '#f2a33a', '#e8c547', '#8b5a2b', '#a0522d']

function leafZone(bottomY: number, topY: number, random: () => number) {
  const height = topY - bottomY
  const count = Math.round(Math.min(Math.max(height * 5, 12), 50))
  const mesh = new THREE.InstancedMesh(leafGeometry, leafMaterial, count)
  mesh.frustumCulled = false
  const tint = new THREE.Color()
  const leaves = Array.from({ length: count }, (_, i) => {
    mesh.setColorAt(i, tint.set(LEAVES[Math.floor(random() * LEAVES.length)]))
    return {
      phase: random(),
      x: (random() * 2 - 1) * WIND_W * 0.3, // plus sway, stays inside the wind column
      z: (random() * 2 - 1) * 0.7,
      speed: 1.8 + random() * 1.4,
      sway: 0.1 + random() * 0.2,
      swaySpeed: 2 + random() * 3,
      spin: 2 + random() * 4,
      axis: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
      size: 0.8 + random() * 0.6,
    }
  })
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const matrix = new THREE.Matrix4()

  function update(seconds: number): void {
    leaves.forEach((leaf, i) => {
      const u = (((seconds * leaf.speed) / height + leaf.phase) % 1 + 1) % 1
      const turn = leaf.phase * Math.PI * 2
      position.set(leaf.x + Math.sin(seconds * leaf.swaySpeed + turn) * leaf.sway, bottomY + u * height, leaf.z)
      rotation.setFromAxisAngle(leaf.axis, seconds * leaf.spin + turn)
      scale.setScalar(leaf.size * Math.min(1, u * 6, (1 - u) * 6)) // shrink in and out at the zone's ends
      mesh.setMatrixAt(i, matrix.compose(position, rotation, scale))
    })
    mesh.instanceMatrix.needsUpdate = true
  }
  update(0)
  return { mesh, update }
}

// Helpers

const euler = new THREE.Euler()
const quaternion = new THREE.Quaternion()
const one = new THREE.Vector3(1, 1, 1)
function pose(x: number, y: number, yaw: number, tilt: number, z = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quaternion.setFromEuler(euler.set(0, yaw, tilt)), one)
}

/** Merges geometries into one non-indexed geometry with per-triangle vertex colours. */
function merge(parts: [THREE.BufferGeometry, Paint][]): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const tint = new THREE.Color()
  for (const [geometry, paintTriangle] of parts) {
    const p = (geometry.index ? geometry.toNonIndexed() : geometry).getAttribute('position')
    for (let t = 0; t < p.count / 3; t++) {
      const corners = [0, 1, 2].map((c) => [p.getX(t * 3 + c), p.getY(t * 3 + c), p.getZ(t * 3 + c)])
      const centroid = [0, 1, 2].map((axis) => (corners[0][axis] + corners[1][axis] + corners[2][axis]) / 3) as V3
      tint.set(paintTriangle(t, centroid))
      for (const corner of corners) {
        positions.push(...corner)
        colors.push(tint.r, tint.g, tint.b)
      }
    }
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  merged.computeVertexNormals()
  return merged
}

function triangles(list: V3[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(2), 3))
  return g
}

// Splits every triangle into four; new vertices get a little depth jitter for rocky facets. The jitter depends
// only on the position, so neighbouring triangles stay connected.
function subdivide(list: V3[][], levels: number): V3[][] {
  if (levels === 0) return list
  const mid = (a: V3, b: V3): V3 => {
    const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    return [m[0] + (hash(...m) - 0.5) * 0.012, m[1], m[2] + (hash(m[1], m[0], m[2]) - 0.5) * 0.06]
  }
  const next = list.flatMap(([a, b, c]) => {
    const ab = mid(a, b)
    const bc = mid(b, c)
    const ca = mid(c, a)
    return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
  })
  return subdivide(next, levels - 1)
}

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}

function seeded(seed: number): () => number {
  let state = Math.floor(seed * 2147483646) + 1
  return () => (state = (state * 16807) % 2147483647) / 2147483647
}
