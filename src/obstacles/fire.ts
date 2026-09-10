// Fire (photorealistic test): a plain column of flames rising from below the screen, one shader pass in TSL.
// Domain-warped fractal noise scrolls upward, a blackbody-like ramp colours it from deep red to a white-hot core,
// and noise shapes flickering tongues at the tip. "Glow" blending (colour stronger than coverage) keeps it luminous
// on a light page. Embers drift up through it. Hitbox in game.ts: a column narrowing towards the tip.
import * as THREE from 'three/webgpu'
import { abs, clamp, color, float, mix, modelPosition, mx_fractal_noise_float, positionWorld, pow, sin, smoothstep, time, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { FLAME_H, FLAME_W } from '../game.ts'
import { type Disposable, FAR } from '../geometry.ts'

const TIP = 0.35 // flame tongues flicker this far above the hitbox tip
const CARD_W = 1.28 // the flame fades out well inside the card
const soft = (from: number, to: number, x: Node<'float'>) => smoothstep(float(from), float(to), x)

const glow = {
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor, // colour is added as is ...
  blendDst: THREE.OneMinusSrcAlphaFactor, // ... while only the coverage hides the page behind
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
}

const fireMaterial = (() => {
  const rel = positionWorld.sub(modelPosition) // world units, 0 at the card's top edge
  const x = rel.x
  const below = rel.y.negate().sub(TIP) // 0 at the hitbox tip, growing downwards
  const seed = modelPosition.y.mul(0.37) // differs per obstacle, so neighbouring fires don't flicker in sync

  // Turbulence: a slow noise field bends the coordinates of a faster, finer one.
  const warp = mx_fractal_noise_float(vec3(x.mul(1.3), rel.y.mul(0.9).sub(time.mul(1.6)), time.mul(0.35).add(seed)), 3, 2, 0.5)
  const turbulence = mx_fractal_noise_float(
    vec3(x.mul(2.6).add(warp.mul(0.7)), rel.y.mul(1.9).sub(time.mul(3.8)).add(warp.mul(0.9)), time.mul(0.8).add(seed)),
    5,
    2.1,
    0.55,
  )

  // Shape: full width low down, narrowing over FLAME_H to the tip; noise licks tongues above and below it.
  const halfWidth = mix(float(0.16), float(FLAME_W / 2), soft(0, FLAME_H, below))
  // The flame fills almost the whole hitbox width (so what you see is what you hit), hottest in the middle.
  const across = abs(x.add(turbulence.mul(0.1))).div(halfWidth) // 0 in the middle, 1 at the hitbox edge
  const body = float(1).sub(soft(0.6, 1.05, across))
  const tongues = soft(-0.15, 0.45, below.add(TIP).add(turbulence.mul(0.45)))
  const flicker = sin(time.mul(11).add(seed.mul(7))).mul(0.04).add(1)
  const hotCore = float(0.6).add(clamp(float(1).sub(across), 0, 1).mul(0.5))
  const heat = pow(clamp(body.mul(tongues).mul(hotCore).mul(turbulence.mul(0.3).add(0.9)).mul(flicker), 0, 1), float(1.1))

  // Blackbody-like ramp: deep red embers → orange → yellow → white-hot core.
  const ramp = mix(
    mix(mix(color(0x5a0a00), color(0xff4d00), soft(0.05, 0.35, heat)), color(0xffb42e), soft(0.35, 0.65, heat)),
    color(0xfff3d6),
    soft(0.65, 0.95, heat),
  )
  const coverage = soft(0.02, 0.3, heat)

  const material = new THREE.MeshBasicNodeMaterial(glow)
  material.colorNode = ramp.mul(heat.mul(1.6).add(coverage.mul(0.4)))
  material.opacityNode = coverage.mul(0.85)
  return material
})()
const cardGeometry = new THREE.PlaneGeometry(CARD_W, 1).translate(0, -0.5, 0) // top edge at 0, scaled down to below the screen

// Embers: tiny glowing sparks rising through the flames, fading out just above the tip. Decorative, not hitbox.
const EMBERS = 18
const emberGeometry = new THREE.PlaneGeometry(0.04, 0.04)
const emberMaterial = new THREE.MeshBasicMaterial({ color: '#ffa53a', opacity: 0.9, ...glow })

export function fire(gapBottom: number, random: () => number, disposables: Disposable[]) {
  const group = new THREE.Group()
  const card = new THREE.Mesh(cardGeometry, fireMaterial)
  card.position.y = gapBottom + TIP
  card.scale.y = gapBottom + TIP + FAR
  card.renderOrder = 5

  const embers = new THREE.InstancedMesh(emberGeometry, emberMaterial, EMBERS)
  embers.frustumCulled = false
  embers.renderOrder = 6
  embers.userData.decorative = true
  const sparks = Array.from({ length: EMBERS }, () => ({
    phase: random(),
    x: (random() * 2 - 1) * 0.3,
    z: (random() * 2 - 1) * 0.3,
    start: gapBottom - 2 + random() * 0.6,
    speed: 0.7 + random() * 0.6,
    sway: 0.05 + random() * 0.1,
    size: 0.6 + random() * 0.8,
  }))
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  const identity = new THREE.Quaternion()

  function update(seconds: number): void {
    sparks.forEach((spark, i) => {
      const u = (((seconds * spark.speed) / 1.8 + spark.phase) % 1 + 1) % 1
      position.set(spark.x + Math.sin(seconds * 3 + spark.phase * 20) * spark.sway, spark.start + u * 1.8, spark.z)
      scale.setScalar(spark.size * Math.min(1, u * 8, (1 - u) * 3))
      embers.setMatrixAt(i, matrix.compose(position, identity, scale))
    })
    embers.instanceMatrix.needsUpdate = true
  }
  update(0)

  group.add(card, embers)
  disposables.push(embers)
  return { group, update }
}
