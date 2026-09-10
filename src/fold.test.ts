import { describe, expect, it } from 'vitest'
import { createPaper, SHEET_H, SHEET_W } from './fold.ts'

const paper = createPaper()

function bounds(u: number | number[]) {
  if (typeof u === 'number') paper.foldAt(u)
  else paper.pose(u)
  const axis = (offset: number) => {
    const values = paper.positions.filter((_, i) => i % 3 === offset)
    return [Math.min(...values), Math.max(...values)]
  }
  return { x: axis(0), y: axis(1), z: axis(2) }
}

describe('fold', () => {
  it('keeps the whole sheet when splitting along creases', () => {
    let area = 0
    for (let i = 0; i < paper.uvs.length; i += 6) {
      const [ax, ay, bx, by, cx, cy] = paper.uvs.slice(i, i + 6)
      area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
    }
    expect(area).toBeCloseTo(1, 4)
  })

  it('starts as a flat A4 sheet', () => {
    const sheet = bounds(0)
    expect(sheet.x[0]).toBeCloseTo(0)
    expect(sheet.x[1]).toBeCloseTo(SHEET_W)
    expect(sheet.y[1]).toBeCloseTo(SHEET_H)
    expect(sheet.z[1]).toBe(0)
  })

  it('ends the flat folds with the nose at the diagonal crossing, layers tightly stacked', () => {
    const folded = bounds(Array.from({ length: paper.steps }, (_, j) => (j < 5 ? 1 : 0)))
    expect(folded.x[0]).toBeCloseTo(0)
    expect(folded.x[1]).toBeCloseTo(SHEET_W)
    expect(folded.y[0]).toBeCloseTo(0)
    expect(folded.y[1]).toBeCloseTo(192)
    expect(folded.z[1] - folded.z[0]).toBeLessThan(1.5) // pieces look joined
  })

  it('stays finite mid-fold', () => {
    bounds(0.5)
    expect([...paper.positions].every(Number.isFinite)).toBe(true)
  })

  it('finishes as a symmetric plane with spread wings', () => {
    const plane = bounds(1)
    expect(plane.x[0] + plane.x[1]).toBeCloseTo(SHEET_W, 0)
    expect(plane.x[1] - plane.x[0]).toBeGreaterThan(100)
    expect(plane.z[1] - plane.z[0]).toBeLessThan(60)
    expect([...paper.positions].every(Number.isFinite)).toBe(true)
  })
})
