// Flappy logic in world units: the visible height is WORLD_H, y points up, 0 is the centre.
// Tuned from aaarafat/JS-Flappy-Bird (400 px playable height at 50 Hz → 1 px = 0.025 units, 1 frame = 20 ms).

export const WORLD_H = 10
// ponytail: fixed step without render interpolation; interpolate if high-refresh screens judder
export const DT = 1 / 120
export const GAP = 2.2
export const OBSTACLE_W = 1.3

const GRAVITY = 7.8 // 0.125 px/frame²
const FLAP_SPEED = 4.5 // 3.6 px/frame
const SPEED = 2.5 // 2 px/frame
const SPACING = 5 // one obstacle every 100 frames
const RADIUS = 0.36 // bird height/4 + width/4
const FIRST_DISTANCE = 6 // ~2.4 s until the first obstacle, even on wide screens

export type Obstacle = { x: number; gapY: number; passed: boolean }

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
  if (!game.alive || game.y > WORLD_H / 2) return false
  game.vy = FLAP_SPEED
  return true
}

/** One fixed step. After a crash the plane keeps falling until it lies on the floor. */
export function step(game: Game): { scored: boolean; hit: boolean } {
  const floor = -WORLD_H / 2 + RADIUS
  game.vy -= GRAVITY * DT * (game.alive ? 1 : 2)
  game.y = Math.max(floor, game.y + game.vy * DT)
  if (game.y === floor) game.vy = 0
  if (!game.alive) return { scored: false, hit: false }

  for (const o of game.obstacles) o.x -= SPEED * DT
  while (game.obstacles.length && game.obstacles[0].x < -game.width / 2 - OBSTACLE_W) game.obstacles.shift()
  spawn(game)

  let scored = false
  for (const o of game.obstacles) {
    if (!o.passed && o.x + OBSTACLE_W / 2 < game.planeX - RADIUS) {
      o.passed = true
      game.score++
      scored = true
    }
  }
  const hit = game.y === floor || game.obstacles.some((o) => collides(game, o))
  if (hit) game.alive = false
  return { scored, hit }
}

/** Nose up while climbing, down while falling (radians). */
export function pitch(game: Game): number {
  const degrees =
    game.vy >= 0 ? 25 * Math.min(game.vy / FLAP_SPEED, 1) : -Math.min(70, (90 * -game.vy) / (2 * FLAP_SPEED))
  return (degrees * Math.PI) / 180
}

function spawn(game: Game): void {
  const edge = game.width / 2 + OBSTACLE_W
  let last = game.obstacles.at(-1)
  if (!last) {
    last = { x: Math.min(edge, game.planeX + FIRST_DISTANCE), gapY: gapY(game), passed: false }
    game.obstacles.push(last)
  }
  while (last.x + SPACING <= edge) {
    last = { x: last.x + SPACING, gapY: gapY(game), passed: false }
    game.obstacles.push(last)
  }
}

function gapY(game: Game): number {
  const range = WORLD_H / 2 - 1 - GAP / 2
  return (game.random() * 2 - 1) * range
}

// Circle vs. the two boxes above and below the gap.
function collides(game: Game, o: Obstacle): boolean {
  const dx = Math.max(Math.abs(game.planeX - o.x) - OBSTACLE_W / 2, 0)
  const dy = Math.max(GAP / 2 - Math.abs(game.y - o.gapY), 0)
  return dx * dx + dy * dy < RADIUS * RADIUS
}
