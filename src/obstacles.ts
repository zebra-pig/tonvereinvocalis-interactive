// Stylized low-poly obstacle models, built from the same numbers as the hitboxes in game.ts.
import * as THREE from 'three/webgpu'
import { clamp, color, float, fwidth, min, mix, modelPosition, mx_noise_float, positionLocal, smoothstep, time, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { controllers } from './controllers.ts'
import { drumStack, hangingDrums } from './drums.ts'
import { stageLights } from './lights.ts'
import { phonePile } from './phones.ts'
import { tireStack } from './tires.ts'
import { FLAME_H, FLAME_W, GAP, LOGS_W, MOUNTAIN_BASE, mountainScale, type Obstacle, WIND_W, WORLD_H } from './game.ts'
import { type Disposable, FAR, hash, merge, type Paint, paint, pose, seeded, subdivide, triangles, type V3 } from './geometry.ts'

export type ObstacleView = {
  group: THREE.Group
  /** 0 = out of view (top parts above, bottom parts below the screen), 1 = in place. */
  slide(k: number): void
  update(seconds: number): void
  dispose(): void
}

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
  const disposables: Disposable[] = []
  const gapTop = o.gapY + GAP / 2
  const gapBottom = o.gapY - GAP / 2

  const updates: ((seconds: number) => void)[] = []
  if (o.top === 'drums') top.add(hangingDrums(gapTop, random, disposables))
  if (o.top === 'lights') top.add(stageLights(gapTop, random, disposables))
  if (o.top === 'controllers') {
    const dangling = controllers(gapTop, random, disposables)
    top.add(dangling.group)
    updates.push(dangling.update)
  }
  if (o.bottom === 'drums') bottom.add(drumStack(gapBottom, random, disposables))
  if (o.bottom === 'matterhorn') bottom.add(matterhorn(o, gapBottom))
  if (o.bottom === 'fire') bottom.add(fire(gapBottom, random, disposables))
  if (o.bottom === 'phones') bottom.add(phonePile(gapBottom, random, disposables))
  if (o.bottom === 'tires') bottom.add(tireStack(gapBottom, random, disposables))

  if (o.wind) {
    const zone = leafZone(-FAR, o.top ? gapTop : FAR, random) // wind columns never have a bottom part
    wind.add(zone.mesh)
    disposables.push(zone.mesh)
    updates.push(zone.update)
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
      for (const update of updates) update(seconds)
    },
    dispose() {
      for (const item of disposables) item.dispose()
    },
  }
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

function fire(gapBottom: number, random: () => number, disposables: Disposable[]): THREE.Group {
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
