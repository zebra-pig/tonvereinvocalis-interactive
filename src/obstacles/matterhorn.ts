// Matterhorn from Zermatt: hooked summit left of centre, steep Furggen ridge on the left, Hörnli ridge towards the
// viewer, shaded north face on the right. Normalised to height 1; stays inside the hitbox triangle in game.ts.
import * as THREE from 'three/webgpu'
import { MOUNTAIN_BASE, mountainScale, type Obstacle } from '../game.ts'
import { hash, merge, type Paint, paint, subdivide, triangles, type V3 } from '../geometry.ts'

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

export function matterhorn(o: Obstacle, gapBottom: number): THREE.Mesh {
  const mesh = new THREE.Mesh(mountainGeometry, paint)
  const s = mountainScale(o)
  mesh.scale.set(s, gapBottom - MOUNTAIN_BASE, s * 0.8)
  mesh.position.y = MOUNTAIN_BASE
  return mesh
}
