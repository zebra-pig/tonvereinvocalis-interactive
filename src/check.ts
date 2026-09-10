// node src/check.ts
import { createPaper, SHEET_H, SHEET_W } from './fold.ts'
import { createGame, flap, OBSTACLE_W, step, WORLD_H } from './game.ts'

function assert(ok: boolean, message: string): void {
  if (!ok) throw new Error(`check failed: ${message}`)
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.5

// Game
{
  const game = createGame(10, () => 0.5)
  step(game)
  assert(game.vy < 0, 'gravity pulls the plane down')
  flap(game)
  step(game)
  assert(game.vy > 0, 'flapping lifts the plane')
}
{
  const game = createGame(10, () => 0.5)
  let hit = false
  for (let i = 0; i < 1000 && !hit; i++) hit = step(game).hit
  assert(hit && !game.alive && game.y < -WORLD_H / 2 + 1, 'falling onto the floor ends the flight')
}
{
  const game = createGame(10)
  game.obstacles = [{ x: game.planeX, gapY: 3, passed: false }]
  assert(step(game).hit, 'flying into an obstacle ends the flight')
}
{
  const game = createGame(10)
  game.obstacles = [{ x: game.planeX, gapY: 0, passed: false }]
  assert(!step(game).hit, 'flying through the gap is safe')
}
{
  const game = createGame(10)
  game.obstacles = [{ x: game.planeX - OBSTACLE_W / 2 - 0.37, gapY: 0, passed: false }]
  assert(step(game).scored && game.score === 1, 'passing an obstacle scores once')
  assert(!step(game).scored && game.score === 1, 'no double score')
}

// Fold
{
  const paper = createPaper()
  const bounds = (u: number) => {
    paper.foldAt(u)
    const axis = (offset: number) => {
      const values = paper.positions.filter((_, i) => i % 3 === offset)
      return [Math.min(...values), Math.max(...values)]
    }
    return { x: axis(0), y: axis(1), z: axis(2) }
  }

  let area = 0
  for (let i = 0; i < paper.uvs.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = paper.uvs.slice(i, i + 6)
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
  }
  assert(Math.abs(area - 1) < 1e-4, 'splitting keeps the whole sheet')
  assert([...paper.positions].every(Number.isFinite), 'positions are finite')

  const sheet = bounds(0)
  assert(near(sheet.x[0], 0) && near(sheet.x[1], SHEET_W) && near(sheet.y[1], SHEET_H) && sheet.z[1] === 0, 'starts flat')

  const folded = bounds(5)
  assert(near(folded.x[0], 0) && near(folded.x[1], SHEET_W) && near(folded.y[0], 0), 'flat folds keep the base')
  assert(near(folded.y[1], 192), 'nose ends at the diagonal crossing (y = 192)')

  const plane = bounds(paper.steps)
  assert(near(plane.x[0] + plane.x[1], SHEET_W), 'plane is symmetric')
  assert(plane.x[1] - plane.x[0] > 100 && plane.z[1] - plane.z[0] < 60, 'wings are spread out')
  assert([...paper.positions].every(Number.isFinite), 'plane positions are finite')
}

console.log('checks passed')
