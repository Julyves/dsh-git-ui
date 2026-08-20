// @vitest-environment jsdom
/**
 * popup 外部点击关闭判定测试。
 * 回归：popup 头部 SelectMenu 下拉 portaled 到 body（class `dsh-git-ui__select-menu`），
 * 点击其选项时 mousedown target 不在 popup 卡片内——旧实现误判为「点击外部」，
 * popup 在分支切换未及完成时关闭（分支看起来「没切换 + pill 自动关闭」）。
 */
import { describe, expect, it } from 'vitest'
import { shouldClosePopup } from '../../src/client/popup-close.ts'

function node(tag: string, className?: string): HTMLElement {
  const el = document.createElement(tag)
  if (className !== undefined) el.className = className
  document.body.appendChild(el)
  return el
}

describe('shouldClosePopup', () => {
  it('closes on clicks outside wrapper, popup, and internal portals', () => {
    const wrap = node('span', 'wrap')
    const pop = node('div', 'dsh-git-ui__pop')
    const outside = node('button', 'outside')
    expect(shouldClosePopup(outside, wrap, pop)).toBe(true)
  })

  it('keeps open on clicks inside the wrapper', () => {
    const wrap = node('span', 'wrap')
    const pop = node('div')
    const pill = node('button', 'dsh-git-ui__pill')
    wrap.appendChild(pill)
    expect(shouldClosePopup(pill, wrap, pop)).toBe(false)
  })

  it('keeps open on clicks inside the popup card', () => {
    const wrap = node('span')
    const pop = node('div', 'dsh-git-ui__pop')
    const header = node('header')
    pop.appendChild(header)
    expect(shouldClosePopup(header, wrap, pop)).toBe(false)
  })

  it('keeps open on clicks inside a portaled select-menu (regression: branch switch)', () => {
    const wrap = node('span')
    const pop = node('div', 'dsh-git-ui__pop')
    const menu = node('div', 'dsh-git-ui__select-menu')
    const option = node('button', 'dsh-git-ui__row')
    menu.appendChild(option)
    // 下拉被 portal 到 body：与 wrap/pop 均无包含关系。
    expect(shouldClosePopup(option, wrap, pop)).toBe(false)
  })

  it('closes for a null event target', () => {
    expect(shouldClosePopup(null, node('span'), node('div'))).toBe(true)
  })
})