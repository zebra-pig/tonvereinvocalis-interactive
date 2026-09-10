// Fire: a crossed log pile up to the flames, then a flame card cut out of animated noise (TSL). Opaque cut-out instead
// of blending, so it reads on a light page and needs no sorting. Hitbox in game.ts: logs box plus tapered flame.
import * as THREE from 'three/webgpu'
import { clamp, color, float, fwidth, min, mix, modelPosition, mx_noise_float, positionLocal, smoothstep, time, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { FLAME_H, FLAME_W, LOGS_W } from '../game.ts'
import { type Disposable, FAR, pose } from '../geometry.ts'

const TIP = 0.35 // flame tongues flicker this far above/below the hitbox tip
const aaStep = (edge: number, v: Node<'float'>) => smoothstep(float(edge).sub(fwidth(v)), float(edge).add(fwidth(v)), v)

const flameMaterial = (() => {
  const x = positionLocal.x
  const h = positionLocal.y // 0 on the logs, FLAME_H at the hitbox tip
  const halfWidth = mix(float(FLAME_W / 2), float(0.18), clamp(h.div(FLAME_H), 0, 1))
  const seed = modelPosition.y.mul(0.37) // differs per obstacle, so neighbouring fires don't flicker in sync
  const n = mx_noise_float(vec3(x.div(halfWidth).mul(1.6), h.mul(1.1).sub(time.mul(2.4)), time.mul(0.7).add(seed)))
  const tongues = n.abs().oneMinus().mul(TIP * 2).sub(TIP) // ridged noise: pointy tips
  const top = float(FLAME_H).sub(h).add(tongues)
  const sides = halfWidth.sub(x.abs()).sub(n.mul(0.5).add(0.5).mul(0.12)) // wobbles inward only, never past the hitbox
  const inside = min(top, sides) // roughly the distance to the flame outline, > 0 inside
  const core = inside.add(n.mul(0.1))

  const material = new THREE.MeshBasicNodeMaterial({ alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide })
  material.colorNode = mix(mix(color(0xd7301f), color(0xf7862a), aaStep(0.1, core)), color(0xffd447), aaStep(0.28, core))
  material.opacityNode = aaStep(0, inside)
  return material
})()
const flameGeometry = new THREE.PlaneGeometry(FLAME_W, FLAME_H + TIP + 0.2).translate(0, (FLAME_H + TIP + 0.2) / 2 - 0.2, 0)
const logGeometry = new THREE.CylinderGeometry(0.11, 0.11, LOGS_W, 7).rotateZ(Math.PI / 2)
const wood = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.9 })
const WOOD = ['#6b4226', '#7a4a2a', '#8b5a2b', '#5a3a22']

export function fire(gapBottom: number, random: () => number, disposables: Disposable[]): THREE.Group {
  const group = new THREE.Group()
  const flameBase = gapBottom - FLAME_H
  const layers = Math.max(1, Math.ceil((flameBase + FAR) / 0.2))
  const logs = new THREE.InstancedMesh(logGeometry, wood, layers * 2)
  const tint = new THREE.Color()
  for (let layer = 0; layer < layers; layer++) {
    const y = flameBase - 0.11 - layer * 0.2
    const across = layer % 2 === 1 // alternate directions, like a stacked woodpile
    for (const side of [-1, 1]) {
      const i = layer * 2 + (side + 1) / 2
      const offset = side * (across ? 0.35 : 0.3)
      logs.setMatrixAt(i, pose(across ? offset : 0, y, across ? Math.PI / 2 : 0, 0, across ? 0 : offset))
      logs.setColorAt(i, tint.set(WOOD[Math.floor(random() * WOOD.length)]))
    }
  }
  const flame = new THREE.Mesh(flameGeometry, flameMaterial)
  flame.position.set(0, flameBase, 0.05)
  group.add(logs, flame)
  disposables.push(logs)
  return group
}
