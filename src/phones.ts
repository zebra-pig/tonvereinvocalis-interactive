// A pile of phones through the eras (generic, no brands): brick phone, candybar, flip phone, smartphone. They lie
// landscape with the front towards the camera, so they read from the side. Hitbox: half-width PHONES_R from the gap's
// bottom edge down; each phone's tilt is accounted for so the pile's top sits exactly at the gap.
import * as THREE from 'three/webgpu'
import { PHONES_R } from './game.ts'
import { type Disposable, FAR, merge, type Paint, paint } from './geometry.ts'

/** Portrait geometry centred on its bounds, front facing +z. */
type Model = { geometry: THREE.BufferGeometry; length: number; width: number }

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)

function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}
const slab = (w: number, h: number, r: number, depth: number, bevel: number) =>
  new THREE.ExtrudeGeometry(roundedRect(w, h, r), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 })
    .translate(0, 0, -depth / 2)

// 80s brick phone: beige body, black front panel, red display strip, keypad, rubber antenna.
function brick(): Model {
  const parts: [THREE.BufferGeometry, Paint][] = [
    [box(0.28, 0.8, 0.18, 0, 0, 0), () => '#e8e1cf'],
    [box(0.23, 0.52, 0.01, 0, -0.08, 0.095), () => '#1b1b1b'],
    [box(0.15, 0.05, 0.012, 0, 0.12, 0.1), () => '#d8232a'],
    [box(0.2, 0.12, 0.05, 0, 0.33, 0.08), () => '#d9d2bf'],
    [new THREE.CylinderGeometry(0.02, 0.028, 0.24, 5).translate(0.08, 0.52, -0.04), () => '#111111'],
  ]
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      parts.push([box(0.05, 0.035, 0.012, (col - 1) * 0.06, 0.02 - row * 0.07, 0.102), () => (row === 0 && col === 2 ? '#d8232a' : '#e9dfb8')])
    }
  }
  return { geometry: merge(parts).translate(0, -0.12, 0), length: 1.04, width: 0.28 }
}

// Candybar: rounded body, light surround framing a green LCD, navigation key, 4×3 keypad.
function candybar(body: string): Model {
  const parts: [THREE.BufferGeometry, Paint][] = [
    [slab(0.3, 0.7, 0.1, 0.08, 0.015), () => body],
    [new THREE.ShapeGeometry(roundedRect(0.24, 0.3, 0.06), 3).translate(0, 0.13, 0.058), () => '#d9d6cf'],
    [box(0.17, 0.13, 0.006, 0, 0.14, 0.062), () => '#b5c49a'],
    [box(0.1, 0.035, 0.01, 0, -0.04, 0.06), () => '#c5c8cc'],
  ]
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) parts.push([box(0.06, 0.03, 0.01, (col - 1) * 0.075, -0.1 - row * 0.055, 0.06), () => '#c5c8cc'])
  }
  return { geometry: merge(parts), length: 0.73, width: 0.33 }
}

// Closed flip phone: two halves joined by a hinge, small outer display.
function flip(body: string): Model {
  const parts: [THREE.BufferGeometry, Paint][] = [
    [box(0.28, 0.6, 0.12, 0, 0, 0), () => body],
    [new THREE.CylinderGeometry(0.04, 0.04, 0.27, 8).rotateZ(Math.PI / 2).translate(0, 0.02, 0), () => '#8e9297'],
    [box(0.285, 0.008, 0.122, 0, 0.02, 0), () => '#55575b'],
    [box(0.14, 0.1, 0.01, 0, 0.17, 0.062), () => '#1a1f26'],
    [box(0.1, 0.04, 0.012, 0, 0.17, 0.064), () => '#6fa3d8'],
    [new THREE.CylinderGeometry(0.02, 0.02, 0.012, 8).rotateX(Math.PI / 2).translate(0, 0.26, 0.062), () => '#1a1f26'],
  ]
  return { geometry: merge(parts), length: 0.6, width: 0.28 }
}

// Smartphone: slim slab, bright gradient screen, camera bump on the back.
function smartphone(body: string, top: string, bottom: string): Model {
  const from = new THREE.Color(bottom)
  const to = new THREE.Color(top)
  const parts: [THREE.BufferGeometry, Paint][] = [
    [slab(0.42, 0.86, 0.06, 0.03, 0.008), () => body],
    [new THREE.ShapeGeometry(roundedRect(0.38, 0.8, 0.045), 3).translate(0, 0, 0.025), (_, [, y]) => from.clone().lerp(to, (y + 0.4) / 0.8)],
    [box(0.12, 0.12, 0.012, -0.1, 0.3, -0.028), () => '#2c2c2e'],
  ]
  return { geometry: merge(parts), length: 0.876, width: 0.436 }
}

const MODELS: Model[] = [
  brick(),
  candybar('#25355e'),
  candybar('#8a1f2b'),
  candybar('#3a3a3a'),
  flip('#b9bcc0'),
  flip('#6d4b8c'),
  smartphone('#1c1c1e', '#ff8a3d', '#e8452c'),
  smartphone('#e6e6ea', '#6fc3ff', '#3a7bd5'),
  smartphone('#1c1c1e', '#7fe0a8', '#1f7a4d'),
]

export function phonePile(gapBottom: number, random: () => number, disposables: Disposable[]): THREE.Group {
  const group = new THREE.Group()
  const placements = new Map<Model, THREE.Matrix4[]>()
  const euler = new THREE.Euler()
  for (let top = gapBottom; top > -FAR; ) {
    const model = MODELS[Math.floor(random() * MODELS.length)]
    const tilt = (random() - 0.5) * 0.5
    // Extents of the landscape phone after tilting in the screen plane.
    const halfHeight = (model.length / 2) * Math.abs(Math.sin(tilt)) + (model.width / 2) * Math.cos(tilt)
    const halfWidth = (model.length / 2) * Math.cos(tilt) + (model.width / 2) * Math.abs(Math.sin(tilt))
    const room = Math.max(0, PHONES_R + 0.02 - halfWidth)
    const x = (random() * 2 - 1) * Math.min(room, 0.08)
    const y = top - halfHeight
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, (random() - 0.5) * 0.16),
      new THREE.Quaternion().setFromEuler(euler.set(0, (random() - 0.5) * 0.7, Math.PI / 2 + tilt)),
      new THREE.Vector3(1, 1, 1),
    )
    placements.set(model, [...(placements.get(model) ?? []), matrix])
    top = y - halfHeight + 0.02 // rest slightly into the phone below
  }
  for (const [model, matrices] of placements) {
    const mesh = new THREE.InstancedMesh(model.geometry, paint, matrices.length)
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
    group.add(mesh)
    disposables.push(mesh)
  }
  return group
}
