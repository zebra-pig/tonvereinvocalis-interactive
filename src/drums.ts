// Basler Trommeln: hanging (top) and stacked (bottom). Hitbox: half-width DRUM_R, starting at the gap edge.
import * as THREE from 'three/webgpu'
import { DRUM_H, DRUM_R } from './game.ts'
import { type Disposable, FAR, merge, type Paint, paint, pose } from './geometry.ts'

const STRAP = 0.28 // strap between hanging drums

// Squat chrome shell, black-and-white striped hoops, zig-zag cords with leather tensioners.
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

/** Drums hanging from above the screen down to the gap's top edge. */
export function hangingDrums(gapTop: number, random: () => number, disposables: Disposable[]): THREE.Group {
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

/** Drums stacked from below the screen up to the gap's bottom edge. */
export function drumStack(gapBottom: number, random: () => number, disposables: Disposable[]): THREE.Group {
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
