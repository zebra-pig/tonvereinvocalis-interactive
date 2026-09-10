import * as THREE from 'three/webgpu'
import { expect, it } from 'vitest'
import { drumStack, hangingDrums } from './drums.ts'
import { DRUM_R } from '../game.ts'
import { type Disposable, FAR, seeded } from './geometry.ts'

const SLACK = 0.1
const vertex = new THREE.Vector3()
const matrix = new THREE.Matrix4()
function measure(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  root.updateWorldMatrix(true, true)
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
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

// Heterogeneous drums (tilts, lying drums, straps, sticks) could poke out for some seeds: try many.
it('drum columns fill their hitboxes exactly for many seeds', () => {
  const failures: string[] = []
  const check = (name: string, ok: boolean) => ok || failures.push(name)
  for (let s = 0; s < 400; s++) {
    const gapTop = -1.8 + ((s * 0.37) % 5.8)
    const gapBottom = gapTop - 2.2
    const random = seeded((s * 0.618034) % 1)
    const disposables: Disposable[] = []
    const top = measure(hangingDrums(gapTop, random, disposables))
    const bottom = measure(drumStack(gapBottom, random, disposables))
    const at = `seed ${s}`
    check(`${at}: top poke below the gap (${top.min.y} < ${gapTop})`, top.min.y > gapTop - SLACK)
    check(`${at}: top drum floats above the gap (${top.min.y} > ${gapTop})`, top.min.y < gapTop + SLACK)
    check(`${at}: top ends on screen`, top.max.y >= FAR)
    check(`${at}: bottom pokes above the gap (${bottom.max.y} > ${gapBottom})`, bottom.max.y < gapBottom + SLACK)
    check(`${at}: bottom falls short of the gap (${bottom.max.y} < ${gapBottom})`, bottom.max.y > gapBottom - SLACK)
    check(`${at}: bottom ends on screen`, bottom.min.y <= -FAR)
    for (const [part, box] of [['top', top], ['bottom', bottom]] as const) {
      check(`${at}: ${part} too wide (${box.min.x}, ${box.max.x})`, box.min.x > -DRUM_R - SLACK && box.max.x < DRUM_R + SLACK)
      check(`${at}: ${part} too deep (${box.min.z}, ${box.max.z})`, box.min.z > -0.75 && box.max.z < 0.75)
    }
    for (const item of disposables) item.dispose()
  }
  expect(failures).toEqual([])
})
