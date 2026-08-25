import { describe, expect, it } from 'vitest'
import { computeWindow } from '../../src/client/use-window-slice.ts'

describe('computeWindow', () => {
  // 行高 18、视口 360px = 20 行；与 diff 视图实际尺度同量级，便于推理。
  const ROW = 18
  const VIEW = 360
  const OVERSCAN = 5

  it('returns an empty slice when total is 0 or inputs are non-positive', () => {
    expect(computeWindow(0, VIEW, 0, ROW, OVERSCAN)).toEqual({ start: 0, end: 0 })
    expect(computeWindow(0, VIEW, 100, 0, OVERSCAN)).toEqual({ start: 0, end: 0 })
    expect(computeWindow(0, 0, 100, ROW, OVERSCAN)).toEqual({ start: 0, end: 0 })
  })

  it('renders from the top with overscan tail at scrollTop 0', () => {
    // scrollTop 0 → start 0；end = ceil(360/18)+5 = 25。
    expect(computeWindow(0, VIEW, 100, ROW, OVERSCAN)).toEqual({ start: 0, end: 25 })
  })

  it('slides the window with scrollTop, keeping overscan margins', () => {
    // scrollTop 900 = 50 行 → start 45；end = ceil(1260/18)+5 = 75。
    expect(computeWindow(900, VIEW, 100, ROW, OVERSCAN)).toEqual({ start: 45, end: 75 })
  })

  it('clamps end at total when scrolled near the bottom', () => {
    // scrollTop 1620 = 90 行 → start 85；end 越过 total → 钳到 100。
    expect(computeWindow(1620, VIEW, 100, ROW, OVERSCAN)).toEqual({ start: 85, end: 100 })
  })

  it('pins to the tail window when scrollTop overshoots max scroll', () => {
    // scrollTop 2000 越过 maxScroll（total 100 × 18 − 360 = 1440）：
    // start 被钉到 total-1，避免空切片。
    expect(computeWindow(2000, VIEW, 100, ROW, OVERSCAN)).toEqual({ start: 99, end: 100 })
  })

  it('covers the whole short list when total is smaller than one viewport', () => {
    expect(computeWindow(0, VIEW, 5, ROW, OVERSCAN)).toEqual({ start: 0, end: 5 })
  })

  it('never lets start exceed end', () => {
    const { start, end } = computeWindow(10_000, VIEW, 10, ROW, OVERSCAN)
    expect(start).toBeLessThanOrEqual(end)
    expect(end).toBeLessThanOrEqual(10)
  })
})
