// Basler Trommeln: drums hanging on carrying straps (top) and piled up (bottom). Hitbox: half-width DRUM_R from the
// gap edge. Every drum in a column is one instance of the same geometry; its finish comes from palettes (see style).
import * as THREE from 'three/webgpu'
import { attribute, clamp, select, uniformArray, varyingProperty } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { DRUM_H, DRUM_R } from './game.ts'
import { type Disposable, FAR, merge, type Paint, paint, triangles, type V3 } from './geometry.ts'

const LIMIT = DRUM_R + 0.085 // max |x| of any drum vertex (the hitbox slack is 0.1)
const R = DRUM_R // hoop radius
const H = DRUM_H
const SHELL_R = R * 0.94
const HOOP_H = H * 0.15
const SEGMENTS = 18
const HOOK = new THREE.Vector3(0, H / 2 - 0.012, R + 0.028) // top of the eyelet on the upper hoop; local +z = lug side
const STRAP_W = 0.09
const STRAP_T = 0.014
const LOOP_R = 0.51 // sling around the shell, over the cords
const STRAND_R = 0.525 // strands running down over the bottom hoop
const METAL = '#b9c0c6'
const UP = new THREE.Vector3(0, 1, 0)

// Palettes. A drum's instance colour holds (shell, hoop, trim) row indices, the geometry says which entry each triangle uses.
const SHELLS = [
  ['#e4e8ec', '#a3abb3', '#c2c9d0'], // chrome, engraved emblem
  ['#ebc76b', '#b88b35', '#8c6523'], // brass
  ['#7a4a2a', '#5a351d', '#9c6b41'], // dark wood
  ['#f2efe7', '#e0dcd1', '#161616'], // white, black Baslerstab
  ['#b8262e', '#9a1e26', '#f3efe6'], // red
  ['#27477f', '#1f3a69', '#f0c53c'], // blue, gold emblem
  ['#2a2a2a', '#1b1b1b', '#e2b84a'], // black, gold emblem
  ['#2f6b45', '#255638', '#f3efe6'], // green
]
const SHELL_WEIGHTS = [3, 1.6, 1.6, 2, 1.2, 1.2, 0.8, 0.8]
const HOOPS = [
  ['#f5f5f2', '#151515'], // teeth pointing up, teeth pointing down
  ['#f5f5f2', '#c0272d'],
  ['#f5f5f2', '#2a4d8f'],
  ['#f2c230', '#151515'],
  ['#c02a30', '#a8232a'],
  ['#1c1c1c', '#121212'],
  ['#2a4d8f', '#223f76'],
  ['#f5f5f2', '#2f6b45'],
]
const HOOP_WEIGHTS = [4, 1.5, 1.5, 0.8, 1, 1, 0.8, 0.8]
const TRIMS = [
  ['#eee6d2', '#5a3b25', '#efe6d0'], // cords, leather tugs, heads
  ['#f7f5ef', '#ece8df', '#f6f3ea'],
  ['#e9e1cc', '#1d1d1d', '#e8dcc0'],
  ['#efe8d6', '#8a2a22', '#f1ead8'],
]
const STRAPS = [
  ['#efe7d2', '#efe7d2', '#efe7d2'], // body, embroidery, alternating embroidery
  ['#f6f4ee', '#f6f4ee', '#f6f4ee'],
  ['#1e1c1a', '#1e1c1a', '#1e1c1a'],
  ['#1e1c1a', '#c0272d', '#e3b33c'],
  ['#efe7d2', '#c0272d', '#2a4d8f'],
  ['#a8232b', '#f0c53c', '#a8232b'],
  ['#27477f', '#f3efe6', '#27477f'],
]
const STICKS = ['#dcc39a', '#cfae78', '#3b2a20']

// Palette slots per triangle.
const FIXED = 0
const SHELL_A = 1
const SHELL_B = 2
const MARK = 3
const HOOP_A = 4
const HOOP_B = 5
const CORD = 6
const TUG = 7
const HEAD = 8

const drumMaterial = (() => {
  const style = varyingProperty('vec3', 'vInstanceColor')
  const slot = attribute<'float'>('slot', 'float')
  const pick = (rows: string[][], channel: Node<'float'>, first: number) => {
    const width = rows[0].length
    const palette = uniformArray(rows.flat().map((c) => new THREE.Color(c)), 'color')
    const entry = clamp(slot.sub(first), 0, width - 1)
    return palette.element(channel.mul(rows.length).floor().mul(width).add(entry).toInt())
  }
  const tinted = select(
    slot.lessThan(HOOP_A - 0.5),
    pick(SHELLS, style.x, SHELL_A),
    select(slot.lessThan(CORD - 0.5), pick(HOOPS, style.y, HOOP_A), pick(TRIMS, style.z, CORD)),
  )
  const material = new THREE.MeshStandardNodeMaterial({ flatShading: true, roughness: 0.6, side: THREE.DoubleSide })
  // The node material multiplies by the instance colour afterwards, which here holds palette indices: undo that.
  material.colorNode = (select(slot.lessThan(0.5), attribute<'vec3'>('color', 'vec3'), tinted) as Node<'vec3'>).div(style)
  return material
})()

const weighted = (weights: number[], random: () => number) => {
  let r = random() * weights.reduce((a, b) => a + b)
  const index = weights.findIndex((w) => (r -= w) < 0)
  return index < 0 ? weights.length - 1 : index
}
function style(random: () => number): THREE.Color {
  const shell = weighted(SHELL_WEIGHTS, random)
  const hoop = weighted(HOOP_WEIGHTS, random)
  const trim = Math.floor(random() * TRIMS.length)
  return new THREE.Color((shell + 0.5) / SHELLS.length, (hoop + 0.5) / HOOPS.length, (trim + 0.5) / TRIMS.length)
}

type Fill = (triangle: number) => number | string | null // palette slot, fixed colour, or dropped

function build(parts: [THREE.BufferGeometry, Fill][]): THREE.BufferGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const slots: number[] = []
  const tint = new THREE.Color()
  for (const [geometry, fill] of parts) {
    const p = (geometry.index ? geometry.toNonIndexed() : geometry).getAttribute('position')
    for (let t = 0; t < p.count / 3; t++) {
      const f = fill(t)
      if (f === null) continue
      tint.set(typeof f === 'number' ? '#000000' : f)
      for (let c = t * 3; c < t * 3 + 3; c++) {
        positions.push(p.getX(c), p.getY(c), p.getZ(c))
        colors.push(tint.r, tint.g, tint.b)
        slots.push(typeof f === 'number' ? f : FIXED)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.setAttribute('slot', new THREE.Float32BufferAttribute(slots, 1))
  g.computeVertexNormals()
  return g
}

type UV = [number, number]
const quad2 = (a: UV, b: UV, c: UV, d: UV): UV[][] => [[a, b, c], [a, c, d]]
const rect = (u0: number, v0: number, u1: number, v1: number) => quad2([u0, v0], [u1, v0], [u1, v1], [u0, v1])

// A Baslerstab-like crozier: staff, knob, crook curling to the left, three prongs at the foot. (u right, v up)
const crozier = (() => {
  const tris = [...rect(-0.017, -0.16, 0.017, 0.07), ...rect(-0.04, 0.03, 0.04, 0.055), ...rect(-0.045, -0.17, 0.045, -0.145)]
  for (const u of [-0.03, 0, 0.03]) tris.push([[u - 0.014, -0.17], [u + 0.014, -0.17], [u, u === 0 ? -0.24 : -0.215]])
  const at = (r: number, a: number): UV => [-0.045 + Math.cos(a) * r, 0.07 + Math.sin(a) * r]
  for (let i = 0; i < 7; i++) {
    const [a0, a1] = [i, i + 1].map((k) => (k / 7) * Math.PI * 1.15)
    tris.push(...quad2(at(0.028, a0), at(0.062, a0), at(0.062, a1), at(0.028, a1)))
  }
  return tris.map((tri) => tri.map(([u, v]): UV => [(u + 0.03) * 1.25, (v + 0.054) * 1.25]))
})()

function onShell(shape: UV[][], angle: number, radius: number): THREE.BufferGeometry {
  return triangles(shape.map((tri) => tri.map(([u, v]): V3 => [Math.sin(angle + u / radius) * radius, v, Math.cos(angle + u / radius) * radius])))
}

// Shell with an emblem, sawtooth-painted hoops, calfskin heads, zig-zag cords with leather tugs, a strap eyelet at +z.
const drumGeometry = (() => {
  const parts: [THREE.BufferGeometry, Fill][] = []
  parts.push([new THREE.CylinderGeometry(SHELL_R, SHELL_R, H - 2 * HOOP_H + 0.02, SEGMENTS, 1, true), (t) => (Math.floor(t / 2) % 2 ? SHELL_B : SHELL_A)])
  for (const angle of [Math.PI / 2, -Math.PI / 2]) parts.push([onShell(crozier, angle, SHELL_R + 0.003), () => MARK])
  for (const s of [1, -1]) {
    parts.push([new THREE.CircleGeometry(R - 0.03, SEGMENTS).rotateX(-s * Math.PI / 2).translate(0, s * (H / 2 - 0.015), 0), () => HEAD])
    parts.push([new THREE.CylinderGeometry(R, R, HOOP_H, SEGMENTS, 1, true).translate(0, s * (H / 2 - HOOP_H / 2), 0), (t) => (t % 2 ? HOOP_A : HOOP_B)])
    parts.push([new THREE.CylinderGeometry(R, R - 0.04, 0, SEGMENTS, 1, true).translate(0, s * H / 2, 0), () => HOOP_B]) // rim
  }

  const count = 20
  const cordY = H / 2 - HOOP_H + 0.01
  const points = Array.from({ length: count }, (_, k) => {
    const a = ((k + 0.5) / count) * Math.PI * 2
    return new THREE.Vector3(Math.sin(a) * (R - 0.008), k % 2 ? -cordY : cordY, Math.cos(a) * (R - 0.008))
  })
  const cords: V3[][] = []
  const v3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z]
  points.forEach((p, k) => {
    const q = points[(k + 1) % count]
    const out = new THREE.Vector3(p.x + q.x, 0, p.z + q.z).normalize()
    const side = q.clone().sub(p).cross(out).normalize().multiplyScalar(0.012)
    const ridge = out.clone().multiplyScalar(0.008)
    const [lp, lq, rp, rq] = [p.clone().sub(side), q.clone().sub(side), p.clone().add(side), q.clone().add(side)]
    const [mp, mq] = [p.clone().add(ridge), q.clone().add(ridge)]
    cords.push([v3(lp), v3(lq), v3(mq)], [v3(lp), v3(mq), v3(mp)], [v3(mp), v3(mq), v3(rq)], [v3(mp), v3(rq), v3(rp)])
    if (k % 2) return
    // Leather tug gathering the two cords below this top point.
    const prev = points[(k + count - 1) % count]
    const [a, b] = [prev, q].map((end) => p.clone().lerp(end, 0.3))
    const centre = a.clone().add(b).multiplyScalar(0.5)
    const radial = new THREE.Vector3(centre.x, 0, centre.z).normalize()
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(UP, radial), UP, radial)
    basis.setPosition(radial.clone().multiplyScalar(Math.hypot(centre.x, centre.z) + 0.006).setY(centre.y))
    const tug = new THREE.BoxGeometry(a.distanceTo(b) + 0.035, 0.075, 0.018).applyMatrix4(basis)
    parts.push([tug, (t) => (t >= 4 && t <= 7) || t >= 10 ? null : TUG])
  })
  parts.push([triangles(cords), () => CORD])

  parts.push([new THREE.BoxGeometry(0.05, 0.08, 0.012).translate(0, H / 2 - 0.05, R + 0.006), () => METAL])
  parts.push([new THREE.TorusGeometry(0.02, 0.006, 3, 6).rotateY(Math.PI / 2).translate(0, HOOK.y - 0.02, HOOK.z), () => METAL])
  return build(parts)
})()

const ring = (radius: number, y: number) =>
  Array.from({ length: 32 }, (_, k) => [Math.sin((k / 32) * Math.PI * 2) * radius, y, Math.cos((k / 32) * Math.PI * 2) * radius]).flat()
const DRUM_HULL = Array.from(drumGeometry.getAttribute('position').array)
// Hanging drums also carry the sling of the drum below.
const HANG_HULL = [...DRUM_HULL, ...ring(STRAND_R + 0.015, -H / 2 - 0.03), ...ring(STRAND_R + 0.015, -H / 2 + HOOP_H + STRAP_W)]

const box = new THREE.Box3()
const point = new THREE.Vector3()
function extent(matrix: THREE.Matrix4, hull: number[]): THREE.Box3 {
  box.makeEmpty()
  for (let i = 0; i < hull.length; i += 3) box.expandByPoint(point.set(hull[i], hull[i + 1], hull[i + 2]).applyMatrix4(matrix))
  return box
}

/** Spun by `yaw`, then tipped by `tilt` so that the side at azimuth `toward` (0 = +z) rises. */
function upright(yaw: number, toward: number, tilt: number, radius: number, height: number): THREE.Matrix4 {
  const axis = new THREE.Vector3(Math.cos(toward), 0, -Math.sin(toward))
  return new THREE.Matrix4()
    .makeRotationAxis(axis, -tilt)
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .scale(new THREE.Vector3(radius, height, radius))
}

/** Lying on its side, a head facing the camera, turned by `turn`. */
function sideways(turn: number, roll: number, radius: number, height: number): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeRotationY(turn)
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeRotationY(roll))
    .scale(new THREE.Vector3(radius, height, radius))
}

/** Rotates, shrinking the tilt until the drum fits between ±LIMIT; returns the placed matrix's rotation and bounds. */
function fit(rotate: (spread: number) => THREE.Matrix4, hull: number[]): { rotation: THREE.Matrix4; bounds: THREE.Box3 } {
  let spread = 1
  for (let k = 0; ; k++) {
    const rotation = rotate(spread)
    const bounds = extent(rotation, hull)
    if (bounds.max.x - bounds.min.x <= 2 * LIMIT || k > 10) return { rotation, bounds: bounds.clone() }
    spread *= 0.7
  }
}

const within = (bounds: THREE.Box3, random: () => number, amount: number) => {
  const lo = -LIMIT - bounds.min.x
  const hi = LIMIT - bounds.max.x
  return (lo + hi) / 2 + ((hi - lo) / 2) * (random() * 2 - 1) * amount
}

function resample(points: THREE.Vector3[], step: number): THREE.Vector3[] {
  const out = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const n = Math.max(1, Math.ceil(points[i].distanceTo(points[i - 1]) / step))
    for (let k = 1; k <= n; k++) out.push(points[i - 1].clone().lerp(points[i], k / n))
  }
  return out
}

/** Flat strap with thickness along a path; `normals` point away from the face it lies on. */
function band(points: THREE.Vector3[], normals: THREE.Vector3[], colors: string[], closed = false): [THREE.BufferGeometry, Paint] {
  const n = points.length
  const frames = points.map((p, i) => {
    const prev = points[closed ? (i + n - 1) % n : Math.max(i - 1, 0)]
    const next = points[closed ? (i + 1) % n : Math.min(i + 1, n - 1)]
    const tangent = next.clone().sub(prev).normalize()
    const normal = normals[i].clone().addScaledVector(tangent, -normals[i].dot(tangent)).normalize()
    return { p, normal, side: new THREE.Vector3().crossVectors(tangent, normal) }
  })
  const corner = (f: (typeof frames)[number], across: number, depth: number): V3 => {
    const v = f.p.clone().addScaledVector(f.side, (across * STRAP_W) / 2).addScaledVector(f.normal, (depth * STRAP_T) / 2)
    return [v.x, v.y, v.z]
  }
  const tris: V3[][] = []
  const tints: THREE.ColorRepresentation[] = []
  const dark = new THREE.Color(colors[0]).multiplyScalar(0.72)
  const face = (f0: (typeof frames)[number], f1: (typeof frames)[number], a: number, da: number, b: number, db: number, tint: THREE.ColorRepresentation) => {
    const [p, q, r, s] = [corner(f0, a, da), corner(f1, a, da), corner(f1, b, db), corner(f0, b, db)]
    tris.push([p, q, r], [p, r, s])
    tints.push(tint, tint)
  }
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [f0, f1] = [frames[i], frames[(i + 1) % n]]
    const edges = [-1, -0.5, 0.5, 1]
    for (let e = 0; e < 3; e++) face(f0, f1, edges[e], 1, edges[e + 1], 1, e === 1 ? colors[1 + (i % 2)] : colors[0])
    face(f0, f1, -1, -1, 1, -1, dark)
    face(f0, f1, -1, 1, -1, -1, dark)
    face(f0, f1, 1, 1, 1, -1, dark)
  }
  return [triangles(tris), (t) => tints[t]]
}

/** Snap hook in a drum's eyelet; strands end at `top`, `radial` points away from the drum. */
function clip(drum: THREE.Matrix4, hanging: boolean) {
  const hook = HOOK.clone().applyMatrix4(drum)
  const radial = new THREE.Vector3(0, 0, 1).transformDirection(drum).setY(0).normalize()
  const tangent = new THREE.Vector3().crossVectors(UP, radial)
  const s = hanging ? 1 : -1
  const at = (y: number) => new THREE.Matrix4().makeBasis(tangent, UP, radial).setPosition(hook.clone().addScaledVector(UP, s * y))
  const parts: [THREE.BufferGeometry, Paint][] = [
    [new THREE.TorusGeometry(0.024, 0.007, 3, 6).applyMatrix4(at(0.012)), () => METAL],
    [new THREE.BoxGeometry(STRAP_W + 0.03, 0.03, 0.022).applyMatrix4(at(0.05)), () => METAL],
  ]
  return { parts, top: hook.clone().addScaledVector(UP, s * 0.06), radial, tangent }
}

/** A strap looped around `drum`'s shell, both strands converging on the clip in the eyelet of the drum below. */
function sling(drum: THREE.Matrix4, below: THREE.Matrix4, colors: string[], random: () => number): [THREE.BufferGeometry, Paint][] {
  const end = clip(below, true)
  const local = end.top.clone().applyMatrix4(drum.clone().invert())
  const exit = Math.atan2(local.x, local.z)
  const low = -H / 2 + HOOP_H + STRAP_W / 2 + 0.012
  const rise = 0.06 + random() * 0.2 // tilted like a girth hitch: lowest where the strands leave
  const loop: THREE.Vector3[] = []
  const loopNormals: THREE.Vector3[] = []
  for (let j = 0; j < 20; j++) {
    const a = exit + (j / 20) * Math.PI * 2
    const radial = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
    loop.push(radial.clone().multiplyScalar(LOOP_R).setY(low + (rise * (1 - Math.cos(a - exit))) / 2).applyMatrix4(drum))
    loopNormals.push(radial.transformDirection(drum))
  }
  const parts = [...end.parts, band(loop, loopNormals, colors, true)]
  for (const side of [-1, 1]) {
    const a = exit + (side * STRAP_W * 0.52) / LOOP_R
    const radial = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
    const at = (r: number, y: number) => radial.clone().multiplyScalar(r).setY(y).applyMatrix4(drum)
    const path = resample([at(STRAND_R, low + STRAP_W * 0.3), at(STRAND_R, -H / 2 + 0.02), at(STRAND_R - 0.015, -H / 2 - 0.03), end.top], 0.14)
    const normal = radial.transformDirection(drum)
    parts.push(band(path, path.map(() => normal), colors))
  }
  return parts
}

/** Drums hanging from above the screen down to the gap's top edge, each on a sling around the drum above. */
export function hangingDrums(gapTop: number, random: () => number, disposables: Disposable[]): THREE.Group {
  const group = new THREE.Group()
  const matrices: THREE.Matrix4[] = []
  const styles: THREE.Color[] = []
  const parts: [THREE.BufferGeometry, Paint][] = []
  const straps = STRAPS[Math.floor(random() * STRAPS.length)] // a Clique's straps usually match
  let top = gapTop
  for (;;) {
    const radius = 0.9 + random() * 0.1
    const height = 0.9 + random() * 0.14
    const toward = (random() * 2 - 1) * 1.05 + (random() < 0.2 ? Math.PI : 0) // eyelet mostly towards the camera
    const tilt = 0.12 + random() * 0.22 // hangs from one point, so it tips a little
    const { rotation, bounds } = fit((spread) => upright(toward, toward, tilt * spread, radius, height), HANG_HULL)
    const below = matrices.at(-1)
    let y = (below ? top + 0.12 + random() * 0.4 : gapTop) - bounds.min.y
    const drum = new THREE.Matrix4().makeTranslation(within(bounds, random, 0.4), 0, 0).multiply(rotation)
    const place = () => drum.setPosition(drum.elements[12], y, 0)
    place()
    if (below) {
      const hook = clip(below, true).top
      for (let k = 0; k < 3; k++) {
        const lack = hook.clone().applyMatrix4(drum.clone().invert()).y + H / 2 + 0.14 // hook must hang clearly below
        if (lack <= 0) break
        y += lack * height * 1.1
        place()
      }
      parts.push(...sling(drum, below, random() < 0.75 ? straps : STRAPS[Math.floor(random() * STRAPS.length)], random))
    }
    matrices.push(drum)
    styles.push(style(random))
    top = y + bounds.max.y
    if (top > FAR - 0.4) break
  }
  // The topmost strap runs up out of the screen.
  const end = clip(matrices.at(-1)!, true)
  parts.push(...end.parts)
  for (const side of [-1, 1]) {
    const path = resample([end.top, end.top.clone().addScaledVector(end.tangent, side * 0.03).setY(FAR + 1)], 0.3)
    parts.push(band(path, path.map(() => end.radial), straps))
  }
  group.add(drums(matrices, styles, disposables), extras(parts, disposables))
  return group
}

function stick(from: THREE.Vector3, to: THREE.Vector3, color: string): [THREE.BufferGeometry, Paint] {
  const length = from.distanceTo(to)
  const geometry = new THREE.CylinderGeometry(0.013, 0.023, length, 6).translate(0, length / 2, 0) // thick end at `from`
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, to.clone().sub(from).normalize())).translate(from.x, from.y, from.z)
  return [geometry, () => color]
}

/** Drums piled from below the screen up to the gap's bottom edge. */
export function drumStack(gapBottom: number, random: () => number, disposables: Disposable[]): THREE.Group {
  const group = new THREE.Group()
  const matrices: THREE.Matrix4[] = []
  const styles: THREE.Color[] = []
  const parts: [THREE.BufferGeometry, Paint][] = []
  const sticksOnTop = random() < 0.5
  const tuckedAt = random() < 0.45 ? Math.floor(random() * 3) : -1 // crossed sticks under the cords
  const strapAt = random() < 0.4 ? Math.floor(random() * 3) : -1 // dangling strap
  let top = gapBottom
  let lyingBelow = false
  for (let i = 0; top > -FAR; i++) {
    const radius = 0.9 + random() * 0.1
    const height = 0.88 + random() * 0.14
    const busy = i === tuckedAt || i === strapAt || (i === 0 && sticksOnTop)
    const lying: boolean = !busy && !lyingBelow && random() < (i === 0 ? 0.3 : 0.16)
    lyingBelow = lying
    const yaw = i === strapAt ? (random() * 2 - 1) * 0.9 : random() * Math.PI * 2
    const toward = random() * Math.PI * 2
    const tilt = busy ? 0 : random() * 0.07
    const turn = (random() * 2 - 1) * 0.6
    const roll = random() * Math.PI * 2
    const { rotation, bounds } = fit(
      (spread) => (lying ? sideways(turn * spread, roll, radius, height) : upright(yaw, toward, tilt * spread, radius, height)),
      DRUM_HULL,
    )
    const x = within(bounds, random, 0.7)
    const y = top - bounds.max.y + (i ? 0.012 : 0)
    const drum = new THREE.Matrix4().makeTranslation(x, y, 0).multiply(rotation)
    matrices.push(drum)
    styles.push(style(random))
    top = y + bounds.min.y

    const color = STICKS[Math.floor(random() * STICKS.length)]
    if (i === 0 && sticksOnTop) {
      // Resting on the rim, one end sticking out towards the camera.
      const heading = (random() * 2 - 1) * 0.6
      for (const side of [-1, 1]) {
        const a = heading + side * (0.1 + random() * 0.08)
        const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
        const centre = new THREE.Vector3(x, gapBottom + 0.024, 0).addScaledVector(new THREE.Vector3(dir.z, 0, -dir.x), side * 0.1)
        const [back, front] = [centre.clone().addScaledVector(dir, -0.3), centre.clone().addScaledVector(dir, 0.52)]
        parts.push(random() < 0.5 ? stick(back, front, color) : stick(front, back, color))
      }
    }
    if (i === tuckedAt) {
      const centre = new THREE.Vector3(x, y, SHELL_R * radius + 0.04)
      for (const side of [-1, 1]) {
        const a = side * (0.45 + random() * 0.25)
        const dir = new THREE.Vector3(Math.sin(a), Math.cos(a), 0)
        const c = centre.clone().setZ(centre.z + (side + 1) * 0.02)
        parts.push(stick(c.clone().addScaledVector(dir, 0.44), c.clone().addScaledVector(dir, -0.42), color))
      }
    }
    if (i === strapAt) {
      const end = clip(drum, false)
      const radialLocal = new THREE.Vector3(0, 0, 1)
      const at = (r: number, h: number) => radialLocal.clone().multiplyScalar(r).setY(h).applyMatrix4(drum)
      const bottom = at(STRAND_R + 0.01, -H / 2 - 0.01)
      const hang = bottom.clone().addScaledVector(end.radial, 0.05).setY(bottom.y - 0.3 - random() * 0.6)
      const path = resample([end.top, at(R + 0.035, H / 2 - HOOP_H - 0.02), at(STRAND_R, -H / 2 + HOOP_H), bottom, hang], 0.14)
      const colors = STRAPS[Math.floor(random() * STRAPS.length)]
      parts.push(...end.parts, band(path, path.map(() => end.radial), colors))
      const tip = new THREE.Matrix4().makeBasis(end.tangent, UP, end.radial).setPosition(hang.clone().addScaledVector(UP, -0.03))
      parts.push([new THREE.TorusGeometry(0.03, 0.008, 3, 6).applyMatrix4(tip), () => METAL])
    }
  }
  group.add(drums(matrices, styles, disposables), extras(parts, disposables))
  return group
}

function drums(matrices: THREE.Matrix4[], styles: THREE.Color[], disposables: Disposable[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(drumGeometry, drumMaterial, matrices.length)
  matrices.forEach((matrix, i) => {
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, styles[i])
  })
  disposables.push(mesh)
  return mesh
}

function extras(parts: [THREE.BufferGeometry, Paint][], disposables: Disposable[]): THREE.Object3D {
  if (parts.length === 0) return new THREE.Group()
  const mesh = new THREE.Mesh(merge(parts), paint)
  disposables.push(mesh.geometry)
  return mesh
}
