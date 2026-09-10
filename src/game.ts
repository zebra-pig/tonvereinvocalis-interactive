// Flappy logic in world units: the visible height is WORLD_H, y points up, 0 is the centre.
// Tuned from aaarafat/JS-Flappy-Bird (400 px playable height at 50 Hz → 1 px = 0.025 units, 1 frame = 20 ms).

export const WORLD_H = 10
// ponytail: fixed step without render interpolation; interpolate if high-refresh screens judder
export const DT = 1 / 120
export const GAP = 2.2

// Obstacle shapes. The scene builds its models from the same numbers, so hitboxes match what you see.
export const DRUM_R = 0.5
export const DRUM_H = 0.9
export const FLAME_H = 2.2 // the fire column narrows over this height towards its tip
export const FLAME_W = 1.1 // fire column width below that
export const LIGHTS_R = 0.55 // stage lights on a truss drop
export const CONTROLLERS_R = 0.5 // game controllers dangling from their cables
export const PHONES_R = 0.55 // pile of phones
export const TIRE_R = 0.62 // stacked car tyres, seen from the side
export const WIND_W = 1.8
export const MOUNTAIN_BASE = -WORLD_H / 2 - 0.5 // mountains stand just below the screen edge
export const MOUNTAIN_MAX_SCALE = 2.6
export const MAX_REACH = 2 // widest obstacle half-width (mountain)
/** Matterhorn outline, normalised to height 1: left foot, right foot, (hooked) summit. */
export const MATTERHORN: [number, number][] = [[-0.58, 0], [0.75, 0], [-0.12, 1]]

const GRAVITY = 7.8 // 0.125 px/frame²
const FLAP_SPEED = 4.5 // 3.6 px/frame
const SPEED = 2.5 // 2 px/frame
const SPACING = 5 // one obstacle every 100 frames
export const RADIUS = 0.36 // plane hitbox radius (bird height/4 + width/4)
const FIRST_DISTANCE = 6 // ~2.4 s until the first obstacle, even on wide screens
const LIFT = 16 // updraft acceleration in the middle of a wind column, stronger than gravity
const MAX_RISE = 5.5 // updrafts can't accelerate the plane beyond this

export type Top = 'drums' | 'lights' | 'controllers'
export type Bottom = 'drums' | 'matterhorn' | 'fire' | 'phones' | 'tires'

const TOPS: Top[] = ['drums', 'lights', 'controllers']
const BOTTOMS: Bottom[] = ['drums', 'matterhorn', 'fire', 'phones', 'tires']
const HALF_WIDTH = { drums: DRUM_R, lights: LIGHTS_R, controllers: CONTROLLERS_R, phones: PHONES_R, tires: TIRE_R }

export type Obstacle = {
  x: number
  gapY: number
  top: Top | null
  bottom: Bottom | null
  wind: boolean
  seed: number // for visual variety only
  passed: boolean
}

export type Game = {
  width: number
  planeX: number
  y: number
  vy: number
  score: number
  alive: boolean
  obstacles: Obstacle[]
  random: () => number
}

type V2 = [number, number]

export function createGame(width: number, random: () => number = Math.random): Game {
  const game: Game = { width, planeX: 0, y: 0, vy: 0, score: 0, alive: true, obstacles: [], random }
  resize(game, width)
  return game
}

export function resize(game: Game, width: number): void {
  game.width = width
  game.planeX = -width / 2 + Math.min(width * 0.25, 4)
  spawn(game)
}

export function flap(game: Game): boolean {
  if (!game.alive) return false
  game.vy = FLAP_SPEED
  return true
}

/** One fixed step. After a crash the plane keeps falling until it lies on the floor. */
export function step(game: Game): { scored: boolean; hit: boolean } {
  const floor = -WORLD_H / 2 + RADIUS
  const lift = game.alive ? wind(game) : 0
  game.vy += (lift - GRAVITY * (game.alive ? 1 : 2)) * DT
  if (lift > 0) game.vy = Math.min(game.vy, MAX_RISE)
  game.y = Math.max(floor, game.y + game.vy * DT)
  if (game.y === floor) game.vy = 0
  if (!game.alive) return { scored: false, hit: false }

  for (const o of game.obstacles) o.x -= SPEED * DT
  while (game.obstacles.length && game.obstacles[0].x + MAX_REACH < -game.width / 2) game.obstacles.shift()
  spawn(game)

  let scored = false
  for (const o of game.obstacles) {
    if (!o.passed && o.x + reach(o) < game.planeX - RADIUS) {
      o.passed = true
      game.score++
      scored = true
    }
  }
  const hit =
    game.y === floor ||
    game.y + RADIUS >= WORLD_H / 2 || // updrafts can blow the plane off the top
    game.obstacles.some((o) => parts(o).some((part) => touches(game.planeX, game.y, RADIUS, part)))
  if (hit) game.alive = false
  return { scored, hit }
}

/** Nose up while climbing, down while falling (radians). */
export function pitch(game: Game): number {
  const degrees =
    game.vy >= 0 ? 25 * Math.min(game.vy / FLAP_SPEED, 1) : -Math.min(70, (90 * -game.vy) / (2 * FLAP_SPEED))
  return (degrees * Math.PI) / 180
}

/** Solid outlines of an obstacle as convex, counter-clockwise polygons in world units. */
export function parts(o: Obstacle): V2[][] {
  const top = o.gapY + GAP / 2
  const bottom = o.gapY - GAP / 2
  const far = WORLD_H * 2
  const shapes: V2[][] = []
  if (o.top) shapes.push(box(o.x, HALF_WIDTH[o.top], top, far))
  if (o.bottom === 'drums' || o.bottom === 'phones' || o.bottom === 'tires') {
    shapes.push(box(o.x, HALF_WIDTH[o.bottom], -far, bottom))
  }
  if (o.bottom === 'fire') {
    const shoulder = bottom - FLAME_H
    const w = FLAME_W / 2
    shapes.push([[o.x - w, -far], [o.x + w, -far], [o.x + w, shoulder], [o.x + 0.16, bottom], [o.x - 0.16, bottom], [o.x - w, shoulder]])
  }
  if (o.bottom === 'matterhorn') {
    const s = mountainScale(o)
    const height = bottom - MOUNTAIN_BASE
    shapes.push(MATTERHORN.map(([x, y]) => [o.x + x * s, MOUNTAIN_BASE + y * height]))
  }
  return shapes
}

/** Horizontal scale of a mountain: its height reaches the gap, its width is capped so columns stay passable. */
export function mountainScale(o: Obstacle): number {
  return Math.min(o.gapY - GAP / 2 - MOUNTAIN_BASE, MOUNTAIN_MAX_SCALE)
}

/** How far an obstacle extends to either side of its x. */
export function reach(o: Obstacle): number {
  return Math.max(o.wind ? WIND_W / 2 : 0, ...parts(o).flat().map(([x]) => Math.abs(x - o.x)))
}

// Upward acceleration at the plane, strongest in the middle of a wind column.
function wind(game: Game): number {
  let lift = 0
  for (const o of game.obstacles) {
    const d = Math.abs(game.planeX - o.x) / (WIND_W / 2)
    if (o.wind && d < 1) lift = Math.max(lift, LIFT * (1 - d * d))
  }
  return lift
}

function spawn(game: Game): void {
  const edge = game.width / 2 + MAX_REACH
  let last = game.obstacles.at(-1)
  if (!last) {
    last = createObstacle(game, Math.min(edge, game.planeX + FIRST_DISTANCE))
    game.obstacles.push(last)
  }
  while (last.x + SPACING <= edge) {
    last = createObstacle(game, last.x + SPACING)
    game.obstacles.push(last)
  }
}

function createObstacle(game: Game, x: number): Obstacle {
  const kind = game.random()
  const seed = game.random()
  if (kind < 0.12) return { x, gapY: 0, top: null, bottom: null, wind: true, seed, passed: false } // free updraft
  const top = pick(game, TOPS)
  if (kind < 0.26) {
    // updraft under a hanging part: it hangs high, the wind pushes the plane towards it
    return { x, gapY: 0.3 + game.random() * 2.7 - GAP / 2, top, bottom: null, wind: true, seed, passed: false }
  }
  const bottom = pick(game, BOTTOMS)
  const range = WORLD_H / 2 - 1 - GAP / 2
  const gapY = (game.random() * 2 - 1) * range
  return { x, gapY, top, bottom, wind: false, seed, passed: false } // no wind above something rising from below
}

function pick<T>(game: Game, options: T[]): T {
  return options[Math.floor(game.random() * options.length)]
}

function box(x: number, halfWidth: number, y0: number, y1: number): V2[] {
  return [[x - halfWidth, y0], [x + halfWidth, y0], [x + halfWidth, y1], [x - halfWidth, y1]]
}

// Circle vs. convex counter-clockwise polygon.
function touches(cx: number, cy: number, r: number, polygon: V2[]): boolean {
  let inside = true
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i]
    const [bx, by] = polygon[(i + 1) % polygon.length]
    const ex = bx - ax
    const ey = by - ay
    if (ex * (cy - ay) - ey * (cx - ax) < 0) inside = false
    const t = Math.min(Math.max(((cx - ax) * ex + (cy - ay) * ey) / (ex * ex + ey * ey), 0), 1)
    const dx = ax + ex * t - cx
    const dy = ay + ey * t - cy
    if (dx * dx + dy * dy < r * r) return true
  }
  return inside
}
