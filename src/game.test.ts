import { describe, expect, it } from 'vitest'
import { createGame, DRUM_R, flap, GAP, type Obstacle, step, WORLD_H } from './game.ts'

function column(o: Partial<Obstacle> & { x: number }): Obstacle {
  return { gapY: 0, top: 'drums', bottom: 'drums', wind: false, seed: 0, passed: false, ...o }
}

describe('flight', () => {
  it('pulls the plane down and lifts it when flapping', () => {
    const game = createGame(10, () => 0.5)
    step(game)
    expect(game.vy).toBeLessThan(0)
    flap(game)
    step(game)
    expect(game.vy).toBeGreaterThan(0)
  })

  it('ends when the plane falls onto the floor', () => {
    const game = createGame(10, () => 0.5)
    let hit = false
    for (let i = 0; i < 1000 && !hit; i++) hit = step(game).hit
    expect(hit).toBe(true)
    expect(game.alive).toBe(false)
    expect(game.y).toBeLessThan(-WORLD_H / 2 + 1)
  })
})

describe('obstacles', () => {
  it('ends the flight when flying into a drum stack', () => {
    const game = createGame(10)
    game.obstacles = [column({ x: game.planeX, gapY: 3 })]
    expect(step(game).hit).toBe(true)
  })

  it('lets the plane through the gap', () => {
    const game = createGame(10)
    game.obstacles = [column({ x: game.planeX })]
    expect(step(game).hit).toBe(false)
  })

  it('scores each passed obstacle once', () => {
    const game = createGame(10)
    game.obstacles = [column({ x: game.planeX - DRUM_R - 0.37 })]
    expect(step(game).scored).toBe(true)
    expect(step(game).scored).toBe(false)
    expect(game.score).toBe(1)
  })

  it('follows the Matterhorn slope instead of a box', () => {
    // Summit at y = 0, plane 1.2 to its right: air above the slope, rock further down.
    const flyAt = (y: number) => {
      const game = createGame(10)
      game.obstacles = [column({ x: game.planeX - 1.2, gapY: GAP / 2, bottom: 'matterhorn' })]
      game.y = y
      return step(game).hit
    }
    expect(flyAt(-2)).toBe(false)
    expect(flyAt(-4.2)).toBe(true)
  })

  it('ends the flight when flying into the fire', () => {
    const game = createGame(10)
    game.obstacles = [column({ x: game.planeX, gapY: -1, bottom: 'fire' })]
    game.y = -1 - GAP / 2 - 0.5
    expect(step(game).hit).toBe(true)
  })

  for (const top of ['drums', 'lights', 'controllers'] as const) {
    it(`blocks above the gap with hanging ${top}`, () => {
      const game = createGame(10)
      game.obstacles = [column({ x: game.planeX, top, bottom: null, gapY: -1 })]
      expect(step(game).hit).toBe(true)
    })
  }

  for (const bottom of ['drums', 'phones', 'tires'] as const) {
    it(`blocks below the gap with piled ${bottom}`, () => {
      const game = createGame(10)
      game.obstacles = [column({ x: game.planeX, top: null, bottom, gapY: 1.5 })]
      expect(step(game).hit).toBe(true)
    })
  }
})

describe('wind', () => {
  it('never blows above something rising from below', () => {
    const game = createGame(10)
    for (let i = 0; i < 2000; i++) step(game) // spawns plenty of obstacles; the plane crashes early, spawning goes on
    const spawned = createGame(4000).obstacles // a very wide world spawns hundreds at once
    for (const o of [...game.obstacles, ...spawned]) if (o.wind) expect(o.bottom).toBeNull()
    expect(spawned.some((o) => o.wind)).toBe(true)
  })

  it('lifts the plane in an updraft', () => {
    const game = createGame(10)
    game.obstacles = [column({ x: game.planeX, top: null, bottom: null, wind: true })]
    for (let i = 0; i < 30; i++) step(game)
    expect(game.vy).toBeGreaterThan(0)
    expect(game.y).toBeGreaterThan(0)
  })

  it('ends the flight when the plane is blown off the top', () => {
    const game = createGame(10)
    game.obstacles = [column({ x: game.planeX, top: null, bottom: null, wind: true })]
    game.y = WORLD_H / 2 - 0.3
    expect(step(game).hit).toBe(true)
  })
})
