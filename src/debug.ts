// Debug pane for the dev server (lil-gui). scene.ts only imports this when import.meta.env.DEV, so builds never ship it.
import GUI from 'lil-gui'
import * as THREE from 'three/webgpu'
import { type Game, parts, RADIUS, WIND_W, WORLD_H } from './game.ts'

export type DebugPane = ReturnType<typeof debugPane>

const CAPACITY = 4096 // line segments
const SOLID = new THREE.Color('#ff00aa')
const WIND = new THREE.Color('#00b3ff')

export function debugPane(scene: THREE.Scene) {
  const settings = { hitboxes: false }
  const gui = new GUI({ title: 'Debug' })
  gui.add(settings, 'hitboxes').name('Show hitboxes')

  // Hitboxes as lines on top of everything, straight from game.ts: obstacle polygons, wind columns, the plane circle.
  const positions = new THREE.BufferAttribute(new Float32Array(CAPACITY * 6), 3)
  const colors = new THREE.BufferAttribute(new Float32Array(CAPACITY * 6), 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', positions)
  geometry.setAttribute('color', colors)
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }))
  lines.renderOrder = 1000
  lines.frustumCulled = false
  scene.add(lines)

  let count = 0
  const edge = (ax: number, ay: number, bx: number, by: number, color: THREE.Color) => {
    if (count >= CAPACITY * 2) return
    for (const [x, y] of [[ax, ay], [bx, by]]) {
      positions.setXYZ(count, x, THREE.MathUtils.clamp(y, -WORLD_H, WORLD_H), 0)
      colors.setXYZ(count++, color.r, color.g, color.b)
    }
  }

  return {
    /** Call once per frame; `inPlace` is false while obstacles are still sliding in or out. */
    draw(game: Game, inPlace: boolean): void {
      lines.visible = settings.hitboxes && inPlace
      if (!lines.visible) return
      count = 0
      for (const o of game.obstacles) {
        for (const polygon of parts(o)) {
          polygon.forEach(([x, y], i) => edge(x, y, ...polygon[(i + 1) % polygon.length], SOLID))
        }
        if (o.wind) {
          const [left, right] = [o.x - WIND_W / 2, o.x + WIND_W / 2]
          edge(left, -WORLD_H, left, WORLD_H, WIND)
          edge(right, -WORLD_H, right, WORLD_H, WIND)
        }
      }
      for (let i = 0; i < 32; i++) {
        const [a, b] = [i, i + 1].map((k) => (k / 32) * Math.PI * 2)
        edge(
          game.planeX + Math.cos(a) * RADIUS,
          game.y + Math.sin(a) * RADIUS,
          game.planeX + Math.cos(b) * RADIUS,
          game.y + Math.sin(b) * RADIUS,
          SOLID,
        )
      }
      geometry.setDrawRange(0, count)
      positions.needsUpdate = true
      colors.needsUpdate = true
    },
    dispose(): void {
      gui.destroy()
      scene.remove(lines)
      geometry.dispose()
    },
  }
}
