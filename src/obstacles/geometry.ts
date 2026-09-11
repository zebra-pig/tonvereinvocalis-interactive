// Shared helpers for the procedural low-poly models.
import * as THREE from 'three/webgpu'
import { WORLD_H } from '../game.ts'

export type V3 = [number, number, number]
export type Paint = (triangle: number, centroid: V3) => THREE.ColorRepresentation
export type Disposable = { dispose(): void }

export const FAR = WORLD_H / 2 + 0.6 // columns reach a bit past the screen edge

/** Flat-shaded vertex colours, shared by most models. */
export const paint = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.65, side: THREE.DoubleSide })

const euler = new THREE.Euler()
const quaternion = new THREE.Quaternion()
const one = new THREE.Vector3(1, 1, 1)
export function pose(x: number, y: number, yaw: number, tilt: number, z = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quaternion.setFromEuler(euler.set(0, yaw, tilt)), one)
}

/** Merges geometries into one non-indexed geometry with per-triangle vertex colours. */
// Runs on every spawn (straps, clips, sticks), so no per-triangle allocations, and colour strings are parsed once.
const parsed = new Map<string | number, THREE.Color>()
export function merge(parts: [THREE.BufferGeometry, Paint][]): THREE.BufferGeometry {
  const sources = parts.map(([geometry, paintTriangle]) => {
    const p = (geometry.index ? geometry.toNonIndexed() : geometry).getAttribute('position')
    return { p, paintTriangle }
  })
  const vertices = sources.reduce((n, { p }) => n + p.count, 0)
  const positions = new Float32Array(vertices * 3)
  const colors = new Float32Array(vertices * 3)
  const centroid: V3 = [0, 0, 0] // reused: paints read it right away
  let v = 0
  for (const { p, paintTriangle } of sources) {
    for (let t = 0; t < p.count / 3; t++) {
      const a = t * 3
      centroid[0] = (p.getX(a) + p.getX(a + 1) + p.getX(a + 2)) / 3
      centroid[1] = (p.getY(a) + p.getY(a + 1) + p.getY(a + 2)) / 3
      centroid[2] = (p.getZ(a) + p.getZ(a + 1) + p.getZ(a + 2)) / 3
      const value = paintTriangle(t, centroid)
      let tint = value instanceof THREE.Color ? value : parsed.get(value)
      if (!tint) parsed.set(value as string | number, (tint = new THREE.Color(value)))
      for (let c = a; c < a + 3; c++, v += 3) {
        positions[v] = p.getX(c)
        positions[v + 1] = p.getY(c)
        positions[v + 2] = p.getZ(c)
        colors[v] = tint.r
        colors[v + 1] = tint.g
        colors[v + 2] = tint.b
      }
    }
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  merged.computeVertexNormals()
  return merged
}

export function triangles(list: V3[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(2), 3))
  return g
}

// Splits every triangle into four; new vertices get a little depth jitter for rocky facets. The jitter depends
// only on the position, so neighbouring triangles stay connected.
export function subdivide(list: V3[][], levels: number): V3[][] {
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

export function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}

/** Deterministic random numbers in [0, 1) from a seed in [0, 1). */
export function seeded(seed: number): () => number {
  let state = Math.floor(seed * 2147483646) + 1
  return () => (state = (state * 16807) % 2147483647) / 2147483647
}

// Reusable InstancedMeshes. three r185 keys an InstancedMesh's render object by its uuid, so every new InstancedMesh
// costs a shader build (on WebGL often a program link too) the first time it renders: one per spawned obstacle. Views
// borrow meshes here and hand them back when disposed, so builds only happen while a pool grows.
type Slot = { mesh: THREE.InstancedMesh; free: boolean }
const pools = new Map<string, Slot[]>()

/** Borrows an InstancedMesh with room for `count` instances; it goes back to the pool with the view's disposables. */
export function instances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  capacity: number,
  disposables: Disposable[],
): THREE.InstancedMesh {
  const key = `${geometry.uuid}:${material.uuid}`
  const pool = pools.get(key) ?? []
  pools.set(key, pool)
  let slot = pool.find((s) => s.free && s.mesh.instanceMatrix.count >= count)
  if (!slot) {
    slot = { mesh: new THREE.InstancedMesh(geometry, material, Math.max(capacity, count)), free: false }
    slot.mesh.frustumCulled = false // its bounds change with every reuse
    pool.push(slot)
  }
  const taken = slot
  taken.free = false
  const mesh = taken.mesh
  mesh.count = count
  mesh.position.set(0, 0, 0)
  mesh.quaternion.identity()
  mesh.scale.set(1, 1, 1)
  mesh.renderOrder = 0
  mesh.userData = {}
  mesh.instanceMatrix.needsUpdate = true // the borrower writes new matrices (and colours) before the next render
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  disposables.push({
    dispose() {
      mesh.removeFromParent()
      taken.free = true
    },
  })
  return mesh
}
