// Stage lights: a truss drop from above the screen with PAR cans clamped on, and a moving head at its lower end.
// Hitbox: half-width LIGHTS_R from the gap's top edge up. The soft beams are decorative (userData.decorative).
import * as THREE from 'three/webgpu'
import { color, float, materialColor, mix, normalView, positionViewDirection, smoothstep, uv } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { type Disposable, FAR, instances, merge, type Paint, paint } from './geometry.ts'

const SECTION = 0.3 // truss section length
const HALF = 0.13 // half the truss cross-section
const HEAD_H = 0.53 // moving head hanging below the truss end, lens included
const SPACING = 0.62 // between PAR cans
const BEAM = 2.6
const COLORS = ['#ffb43a', '#ff3fa4', '#3fd0ff', '#4a6bff']

// Box truss section: 4 chords, one diagonal per face, a square ring at its base.
function trussGeometry(metal: string, lacing: string): THREE.BufferGeometry {
  const parts: [THREE.BufferGeometry, Paint][] = []
  const diagonal = Math.hypot(HALF * 2, SECTION)
  const lean = Math.atan2(HALF * 2, SECTION)
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push([new THREE.CylinderGeometry(0.022, 0.022, SECTION, 4, 1, true).translate(x * HALF, SECTION / 2, z * HALF), () => metal])
  }
  for (const side of [-1, 1]) {
    const brace = () => new THREE.CylinderGeometry(0.011, 0.011, diagonal, 4, 1, true)
    parts.push([brace().rotateZ(-lean * side).translate(0, SECTION / 2, side * HALF), () => lacing])
    parts.push([brace().rotateX(lean * side).translate(side * HALF, SECTION / 2, 0), () => lacing])
    parts.push([new THREE.BoxGeometry(HALF * 2, 0.015, 0.015).translate(0, 0, side * HALF), () => lacing])
    parts.push([new THREE.BoxGeometry(0.015, 0.015, HALF * 2).translate(side * HALF, 0, 0), () => lacing])
  }
  return merge(parts)
}
const TRUSSES = [trussGeometry('#c9ced3', '#9aa1a8'), trussGeometry('#2b2b2e', '#3d3d42')]

// PAR can, pivot at its centre: body pointing down, U-bracket and clamp above.
const METAL = '#bfc4c9'
const parGeometry = merge([
  [new THREE.CylinderGeometry(0.13, 0.13, 0.34, 10, 1, true), () => '#1c1c1f'],
  [new THREE.ConeGeometry(0.13, 0.08, 10, 1, true).translate(0, 0.21, 0), () => '#242427'],
  [new THREE.CylinderGeometry(0.145, 0.145, 0.03, 10, 1, true).translate(0, -0.17, 0), () => '#2a2a2e'],
  [new THREE.BoxGeometry(0.02, 0.32, 0.04).translate(-0.15, 0.06, 0), () => METAL],
  [new THREE.BoxGeometry(0.02, 0.32, 0.04).translate(0.15, 0.06, 0), () => METAL],
  [new THREE.BoxGeometry(0.32, 0.03, 0.04).translate(0, 0.22, 0), () => METAL],
  [new THREE.BoxGeometry(0.06, 0.08, 0.06).translate(0, 0.27, 0), () => METAL],
])

// Moving head hanging upside down: base and arms from the truss end, head (pivot at its centre) between the arms.
const HEAD_PIVOT = -0.3
const yokeGeometry = merge([
  [new THREE.BoxGeometry(0.36, 0.1, 0.26).translate(0, -0.05, 0), () => '#1c1c1f'],
  [new THREE.BoxGeometry(0.05, 0.24, 0.12).translate(-0.155, -0.2, 0), () => '#26262a'],
  [new THREE.BoxGeometry(0.05, 0.24, 0.12).translate(0.155, -0.2, 0), () => '#26262a'],
  [new THREE.BoxGeometry(0.16, 0.05, 0.012).translate(0, -0.05, 0.132), () => '#3fa7ff'], // display
])
const headGeometry = merge([
  [new THREE.CylinderGeometry(0.12, 0.12, 0.35, 10), () => '#1c1c1f'],
  [new THREE.CylinderGeometry(0.035, 0.035, 0.29, 6).rotateZ(Math.PI / 2), () => '#26262a'], // tilt axle
])

// Lens discs sit at the same offset for cans and heads, so a lens instance uses its fixture's matrix as is.
const lensGeometry = new THREE.CircleGeometry(0.115, 10).rotateX(Math.PI / 2).translate(0, -0.186, 0)
const lensMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })
const beamGeometry = new THREE.CylinderGeometry(0.1, 0.6, BEAM, 20, 1, true).translate(0, -BEAM / 2 - 0.19, 0)

// Soft beam: open cone, normal alpha blending (additive would vanish on a light page), fading towards its far end
// and its silhouette edges.
const soft = (from: number, to: number, x: Node<'float'>) => smoothstep(float(from), float(to), x)
// One node graph for every beam; the tint comes from each material's colour, so all tints share one shader and pipeline.
const along = uv().y // 1 at the lens, 0 at the far end
const facing = normalView.dot(positionViewDirection).abs() // 1 across the middle, 0 at the silhouette
const beamColor = mix(materialColor, color(0xffffff), soft(0.8, 1, along).mul(0.6))
const beamOpacity = soft(0.05, 0.7, facing).mul(along).mul(0.35)
const beamMaterials = new Map<string, THREE.MeshBasicNodeMaterial>()
function beamMaterial(tint: string): THREE.MeshBasicNodeMaterial {
  const cached = beamMaterials.get(tint)
  if (cached) return cached
  // Single pass: a faint cone looks the same, and compileAsync can warm it up (see the glow material in fire.ts).
  const material = new THREE.MeshBasicNodeMaterial({ color: tint, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true })
  material.colorNode = beamColor
  material.opacityNode = beamOpacity
  beamMaterials.set(tint, material)
  return material
}

export function stageLights(gapTop: number, random: () => number, disposables: Disposable[]) {
  const group = new THREE.Group()
  const trussBottom = gapTop + HEAD_H
  const pick = <T>(options: T[]) => options[Math.floor(random() * options.length)]

  const sections = Math.max(1, Math.ceil((FAR + 0.3 - trussBottom) / SECTION))
  const truss = instances(random() < 0.6 ? TRUSSES[0] : TRUSSES[1], paint, sections, 32, disposables)
  for (let i = 0; i < sections; i++) truss.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, trussBottom + i * SECTION, 0))

  // PAR cans alternate sides and aim down and outwards, tipped towards the camera so the lenses show.
  const fixtures: THREE.Matrix4[] = []
  let side = random() < 0.5 ? -1 : 1
  for (let y = trussBottom + 0.45; y < FAR; y += SPACING, side = -side) {
    fixtures.push(place(side * 0.2, y, 0.05, 0.45 + random() * 0.3, side * (0.2 + random() * 0.25)))
  }
  const cans = instances(parGeometry, paint, fixtures.length, 16, disposables)
  fixtures.forEach((matrix, i) => cans.setMatrixAt(i, matrix))

  const lenses = instances(lensGeometry, lensMaterial, fixtures.length, 16, disposables)
  const tint = new THREE.Color()
  const tints = fixtures.map((matrix, i) => {
    const name = pick(COLORS)
    lenses.setMatrixAt(i, matrix)
    lenses.setColorAt(i, tint.set(name))
    return name
  })
  group.add(truss, cans, lenses)

  // Moving head: the yoke pans around the vertical axis, the head tilts on its axle, lens and beam move with it.
  // Every part stays within HEAD_H of the truss end, so it never reaches into the gap.
  const headTint = pick(COLORS)
  const yoke = new THREE.Group()
  yoke.position.y = trussBottom
  const head = new THREE.Group()
  head.position.y = HEAD_PIVOT
  head.add(new THREE.Mesh(headGeometry, paint), new THREE.Mesh(lensGeometry, lensFor(headTint)), beam(headTint))
  yoke.add(new THREE.Mesh(yokeGeometry, paint), head)
  group.add(yoke)

  // Plus a beam from the lowest can: enough mood, little overdraw.
  if (fixtures[0]) {
    const canBeam = beam(tints[0])
    canBeam.applyMatrix4(fixtures[0])
    group.add(canBeam)
  }

  const pan = random() * Math.PI * 2
  const tilt = random() * Math.PI * 2
  const speed = 0.8 + random() * 0.5
  function update(seconds: number): void {
    yoke.rotation.y = Math.sin(seconds * 0.6 * speed + pan) * 1.2
    head.rotation.x = 0.55 + Math.sin(seconds * 0.9 * speed + tilt) * 0.5
  }
  update(0)
  return { group, update }
}

function beam(tint: string): THREE.Mesh {
  const mesh = new THREE.Mesh(beamGeometry, beamMaterial(tint))
  mesh.renderOrder = 10
  mesh.userData.decorative = true
  return mesh
}

const lensMaterials = new Map<string, THREE.MeshBasicMaterial>()
function lensFor(tint: string): THREE.MeshBasicMaterial {
  const material = lensMaterials.get(tint) ?? new THREE.MeshBasicMaterial({ color: tint, side: THREE.DoubleSide })
  lensMaterials.set(tint, material)
  return material
}

const euler = new THREE.Euler()
function place(x: number, y: number, z: number, towardsCamera: number, sideways: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(euler.set(towardsCamera, 0, sideways)),
    new THREE.Vector3(1, 1, 1),
  )
}
