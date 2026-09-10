// Car tyres piled up: flat stack, sometimes one tyre leaning on top, some still on their wheel. Hitbox: half-width
// TIRE_R from the gap's bottom edge down.
import * as THREE from 'three/webgpu'
import { type Disposable, FAR, instances, merge, type Paint, paint } from './geometry.ts'

const OUTER = 0.55
const HALF = 0.175 // half the tyre width
// Half cross-section (radius, height): bead, bulging sidewall, shoulder, tread, and back. Lathed around y, so it lies flat.
const PROFILE: [number, number][] = [
  [0.36, -0.13], [0.46, -0.175], [0.53, -0.16], [0.55, -0.1], [0.55, 0.1], [0.53, 0.16], [0.46, 0.175], [0.36, 0.13], [0.36, -0.13],
]
const SEGMENTS = 20
const ROWS = PROFILE.length - 1

// LatheGeometry emits two triangles per (segment, profile row), in that order.
const rubber: Paint = (t) => {
  const row = Math.floor(t / 2) % ROWS
  const segment = Math.floor(t / (2 * ROWS))
  if (row === 3) return (segment + (t % 2)) % 2 ? '#161617' : '#3a3a3d' // zig-zag tread blocks
  if (row === 2 || row === 4) return '#303033'
  if (row === 7) return '#1f1f21'
  return segment % 2 ? '#2a2a2c' : '#2e2e31'
}
const lathe = () => new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), SEGMENTS)
const tyreGeometry = merge([[lathe(), rubber]])
const wheelGeometry = merge([
  [lathe(), rubber],
  [new THREE.CylinderGeometry(0.36, 0.36, 0.24, SEGMENTS, 1, true), () => '#c9ccd0'],
  [new THREE.CircleGeometry(0.36, SEGMENTS).rotateX(-Math.PI / 2).translate(0, 0.08, 0), (t) => (t % 4 < 2 ? '#c9ccd0' : '#55595e')],
  [new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8), () => '#8d9197'],
])

export function tireStack(gapBottom: number, random: () => number, disposables: Disposable[]): THREE.Group {
  const group = new THREE.Group()
  const piles = { tyres: [] as THREE.Matrix4[], wheels: [] as THREE.Matrix4[] }
  const euler = new THREE.Euler()
  const add = (wheel: boolean, x: number, y: number, rotation: THREE.Euler) => {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, 0), new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1))
    ;(wheel ? piles.wheels : piles.tyres).push(matrix)
  }

  let top = gapBottom
  if (random() < 0.5) {
    // One tyre standing on top, leaning back a little, its hole facing the camera.
    const lean = 0.25 + random() * 0.15
    const half = OUTER * Math.cos(lean) + HALF * Math.sin(lean)
    add(random() < 0.3, (random() - 0.5) * 0.06, top - half, euler.set(Math.PI / 2 - lean, 0, 0))
    top -= 2 * half - 0.03
  }
  while (top > -FAR) {
    const tilt = (random() - 0.5) * 0.06
    const half = HALF * Math.cos(tilt) + OUTER * Math.abs(Math.sin(tilt))
    add(random() < 0.2, (random() - 0.5) * 0.08, top - half, euler.set(0, random() * Math.PI * 2, tilt))
    top -= 2 * half - 0.02 // squashed slightly into the tyre below
  }

  const tint = new THREE.Color()
  for (const [geometry, matrices] of [[tyreGeometry, piles.tyres], [wheelGeometry, piles.wheels]] as const) {
    if (!matrices.length) continue
    const mesh = instances(geometry, paint, matrices.length, 32, disposables)
    matrices.forEach((matrix, i) => {
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, tint.setRGB(1, 0.97 + random() * 0.03, 0.9 + random() * 0.1).multiplyScalar(0.85 + random() * 0.15)) // worn, dusty
    })
    group.add(mesh)
  }
  return group
}
