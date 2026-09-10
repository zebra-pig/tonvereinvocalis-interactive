// Updraft: autumn leaves rising, swaying and tumbling. CPU-animated instances, cheap at these counts.
import * as THREE from 'three/webgpu'
import { WIND_W } from '../game.ts'

const leafGeometry = (() => {
  const g = new THREE.BufferGeometry()
  // Two triangles folded along the midrib.
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.09, 0, -0.055, 0, 0.02, 0, -0.09, 0, 0, 0.09, 0, 0, -0.09, 0, 0.055, 0, 0.02], 3))
  g.computeVertexNormals()
  return g
})()
const leafMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.8, side: THREE.DoubleSide })
const LEAVES = ['#b83a1b', '#e0701f', '#f2a33a', '#e8c547', '#8b5a2b', '#a0522d']

export function leafZone(bottomY: number, topY: number, random: () => number) {
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
