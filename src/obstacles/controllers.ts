// Game controllers of different eras (generic, no brands) dangling from their cables. Hitbox: half-width
// CONTROLLERS_R from the gap's top edge up. The column sways very slightly, staying inside the hitbox.
import * as THREE from 'three/webgpu'
import { type Disposable, FAR, merge, type Paint, paint } from '../geometry.ts'

type Palette = { body: string; detail: string; accent: string }
/** Geometry hangs below its cable attachment at the origin; `depth` is how far down it reaches. */
type Model = { geometry: THREE.BufferGeometry; depth: number }

const PIVOT = FAR + 0.8 // the cables are fixed above the screen; the column sways around this point

function extrude(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  const options = { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 4 }
  return new THREE.ExtrudeGeometry(shape, options).translate(0, 0, -depth / 2)
}
const button = (radius: number, x: number, y: number, z: number) =>
  new THREE.CylinderGeometry(radius, radius, 0.03, 6).rotateX(Math.PI / 2).translate(x, y, z)
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const relief = () => new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6).translate(0, 0.02, 0) // strain relief at the cable

// Modern dual-stick pad: handlebar outline with grips pointing down.
function modern(p: Palette): Model {
  const outline: [number, number][] = [
    [-0.3, -0.02], [0.3, -0.02], [0.38, -0.08], [0.4, -0.2], [0.36, -0.42], [0.28, -0.52], [0.18, -0.5], [0.14, -0.34],
    [0.08, -0.28], [-0.08, -0.28], [-0.14, -0.34], [-0.18, -0.5], [-0.28, -0.52], [-0.36, -0.42], [-0.4, -0.2], [-0.38, -0.08],
  ]
  const z = 0.085
  const parts: [THREE.BufferGeometry, Paint][] = [
    [extrude(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))), 0.1), () => p.body],
    [box(0.13, 0.04, 0.03, -0.2, -0.18, z), () => p.detail],
    [box(0.04, 0.13, 0.03, -0.2, -0.18, z), () => p.detail],
    [button(0.05, -0.1, -0.3, z), () => p.detail],
    [button(0.05, 0.1, -0.3, z), () => p.detail],
    [box(0.18, 0.04, 0.07, -0.24, -0.01, 0), () => p.detail],
    [box(0.18, 0.04, 0.07, 0.24, -0.01, 0), () => p.detail],
    [relief(), () => p.detail],
  ]
  for (const [dx, dy] of [[0, 0.05], [0.05, 0], [0, -0.05], [-0.05, 0]]) parts.push([button(0.026, 0.2 + dx, -0.18 + dy, z), () => p.accent])
  return { geometry: merge(parts), depth: 0.54 }
}

// Retro pad: flat stadium shape, D-pad, two buttons, select/start pills.
function retro(p: Palette): Model {
  const shape = new THREE.Shape()
  shape.moveTo(-0.22, -0.02)
  shape.lineTo(0.22, -0.02)
  shape.absarc(0.22, -0.19, 0.17, Math.PI / 2, -Math.PI / 2, true)
  shape.lineTo(-0.22, -0.36)
  shape.absarc(-0.22, -0.19, 0.17, -Math.PI / 2, Math.PI / 2, true)
  const z = 0.065
  const parts: [THREE.BufferGeometry, Paint][] = [
    [extrude(shape, 0.08), () => p.body],
    [box(0.12, 0.04, 0.03, -0.22, -0.19, z), () => p.detail],
    [box(0.04, 0.12, 0.03, -0.22, -0.19, z), () => p.detail],
    [button(0.035, 0.17, -0.23, z), () => p.accent],
    [button(0.035, 0.27, -0.16, z), () => p.accent],
    [new THREE.BoxGeometry(0.07, 0.022, 0.02).rotateZ(0.5).translate(-0.05, -0.23, z), () => p.detail],
    [new THREE.BoxGeometry(0.07, 0.022, 0.02).rotateZ(0.5).translate(0.05, -0.23, z), () => p.detail],
    [relief(), () => p.detail],
  ]
  return { geometry: merge(parts), depth: 0.38 }
}

// Arcade stick: a box with a ball-top lever and two rows of buttons on top.
function arcade(p: Palette): Model {
  const parts: [THREE.BufferGeometry, Paint][] = [
    [box(0.7, 0.2, 0.34, 0, -0.14, 0), () => p.body],
    [box(0.66, 0.012, 0.3, 0, -0.035, 0), () => p.detail],
    [new THREE.CylinderGeometry(0.018, 0.018, 0.1, 6).translate(-0.18, 0.01, 0.02), () => '#b9bcc0'],
    [new THREE.SphereGeometry(0.05, 8, 6).translate(-0.18, 0.08, 0.02), () => p.accent],
    [relief(), () => p.detail],
  ]
  for (const x of [0.02, 0.12, 0.22]) {
    for (const z of [-0.06, 0.06]) {
      parts.push([new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8).translate(x, -0.025, z), () => (z > 0 ? p.accent : p.detail)])
    }
  }
  return { geometry: merge(parts), depth: 0.24 }
}

const MODELS: Model[] = [
  modern({ body: '#26272b', detail: '#3b3d42', accent: '#8a8f96' }),
  modern({ body: '#eceef0', detail: '#8a8f96', accent: '#26272b' }),
  modern({ body: '#d8433a', detail: '#1d1d1f', accent: '#f2f2f2' }),
  retro({ body: '#c9c9cf', detail: '#3b3b40', accent: '#6b5bb5' }),
  retro({ body: '#2d2d33', detail: '#111114', accent: '#d8433a' }),
  arcade({ body: '#1d1d1f', detail: '#d8433a', accent: '#3fa7ff' }),
  arcade({ body: '#eceef0', detail: '#26272b', accent: '#f2a33a' }),
]
const cableMaterial = new THREE.MeshStandardMaterial({ color: '#1e1e20', roughness: 0.6 })

export function controllers(gapTop: number, random: () => number, disposables: Disposable[]) {
  const group = new THREE.Group()
  const swing = new THREE.Group()
  swing.position.y = PIVOT
  group.add(swing)

  let previous = gapTop
  for (let i = 0; i < 3; i++) {
    const model = MODELS[Math.floor(random() * MODELS.length)]
    const lowest = i === 0
    const scale = lowest ? 1 : 0.8 + random() * 0.15
    const y = lowest ? gapTop + model.depth : previous + 0.6 + random() * 0.7 + model.depth * scale // attachment point
    if (!lowest && y > FAR - 0.2) break
    previous = y
    const x = (random() - 0.5) * (lowest ? 0.1 : 0.2)
    const z = i * 0.3 // higher controllers hang further forward, so the cables below them can pass behind

    const mesh = new THREE.Mesh(model.geometry, paint)
    mesh.position.set(x, y - PIVOT, z)
    mesh.rotation.set(0, (random() - 0.5) * 0.7, (random() - 0.5) * 0.1)
    mesh.scale.setScalar(scale)

    // Cable: bends back right above the controller, then runs up behind everything hanging higher in a gentle S.
    const lane = z - 0.35
    const start = new THREE.Vector3(x, y + 0.06 * scale - PIVOT, z)
    const end = new THREE.Vector3(x * 0.5, 0.2, lane)
    const bend = (random() - 0.5) * 0.16
    const cableGeometry = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        start,
        new THREE.Vector3(x, start.y + 0.14, z - 0.2),
        new THREE.Vector3(x + bend, THREE.MathUtils.lerp(start.y, end.y, 0.3), lane),
        new THREE.Vector3(x - bend * 0.6, THREE.MathUtils.lerp(start.y, end.y, 0.65), lane),
        end,
      ]),
      32,
      0.016,
      4,
    )
    swing.add(mesh, new THREE.Mesh(cableGeometry, cableMaterial))
    disposables.push(cableGeometry)
  }

  const phase = random() * Math.PI * 2
  return {
    group,
    update(seconds: number) {
      swing.rotation.z = Math.sin(seconds * 0.9 + phase) * 0.005
    },
  }
}
