import * as THREE from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { GAP, type Obstacle, reach } from './game.ts'
import { createObstacleView } from './obstacles.ts'

const kinds: Pick<Obstacle, 'top' | 'bottom' | 'wind'>[] = [
  { top: 'drums', bottom: 'drums', wind: false },
  { top: 'drums', bottom: 'matterhorn', wind: false },
  { top: 'lights', bottom: 'fire', wind: false },
  { top: 'controllers', bottom: 'phones', wind: false },
  { top: 'lights', bottom: 'tires', wind: false },
  { top: 'drums', bottom: null, wind: true },
  { top: 'lights', bottom: null, wind: true },
  { top: 'controllers', bottom: null, wind: true },
  { top: null, bottom: null, wind: true },
]
const TIP = 0.36 // flame tongues may flicker slightly above the hitbox tip
const SLACK = 0.1

// Box3.setFromObject rotates per-instance bounding boxes (spun drums look √2 too wide), so measure real vertices.
// Decorative meshes (light beams) are not part of the obstacle.
const vertex = new THREE.Vector3()
const matrix = new THREE.Matrix4()
function measure(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.decorative) return
    const position = object.geometry.getAttribute('position')
    const instanced = object instanceof THREE.InstancedMesh
    for (let i = 0; i < (instanced ? object.count : 1); i++) {
      if (instanced) object.getMatrixAt(i, matrix)
      else matrix.identity()
      matrix.premultiply(object.matrixWorld)
      for (let j = 0; j < position.count; j++) box.expandByPoint(vertex.fromBufferAttribute(position, j).applyMatrix4(matrix))
    }
  })
  return box
}

describe('obstacle models match their hitboxes', () => {
  for (const kind of kinds) {
    for (const gapY of [-2.9, 0, 2.9]) {
      for (const seed of [0.1, 0.37, 0.64, 0.93]) {
        const name = `${kind.top ?? '–'} / ${kind.bottom ?? '–'}${kind.wind ? ' + wind' : ''} at gap ${gapY}, seed ${seed}`
        it(name, () => {
          const o: Obstacle = { x: 0, gapY, seed, passed: false, ...kind }
          const view = createObstacleView(o)
          view.slide(1)
          view.update(1.234)
          const bounds = (part: string) => measure(view.group.getObjectByName(part)!)

          const all = measure(view.group)
          expect(all.min.x).toBeGreaterThan(-reach(o) - SLACK)
          expect(all.max.x).toBeLessThan(reach(o) + SLACK)

          const top = bounds('top')
          if (!top.isEmpty()) expect(top.min.y).toBeGreaterThan(gapY + GAP / 2 - SLACK)
          const bottom = bounds('bottom')
          if (!bottom.isEmpty()) expect(bottom.max.y).toBeLessThan(gapY - GAP / 2 + (o.bottom === 'fire' ? TIP : SLACK))
          view.dispose()
        })
      }
    }
  }
})
