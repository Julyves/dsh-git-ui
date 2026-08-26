/**
 * 差异视图三态渲染测试（split / before / after）。
 *
 * 静态渲染（react-dom/server）：
 *   - split：双侧内容都在场，携带拖拽分割条与左列占比；
 *   - before：仅变更前内容（上下文 + 删除行），新增行缺席；
 *   - after：仅变更后内容（上下文 + 新增行），删除行缺席。
 * 高亮在静态渲染下不就绪（effect 不跑）→ 纯文本断言稳定。
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DiffSideBySide } from '../../src/client/center/changes/DiffSideBySide.tsx'
import { DEFAULT_DIFF_SETTINGS } from '../../src/contracts/settings.ts'
import { zh } from '../../src/client/locales.ts'

const t = (key: keyof typeof zh): string => zh[key]

const DIFF = [
  '--- a/x.txt',
  '+++ b/x.txt',
  '@@ -1,3 +1,3 @@',
  ' one',
  '-twoOLD',
  '+twoNEW',
  ' three',
].join('\n')

function render(mode?: 'split' | 'before' | 'after', leftRatio?: number): string {
  return renderToStaticMarkup(
    <DiffSideBySide
      text={DIFF}
      path="x.txt"
      diff={DEFAULT_DIFF_SETTINGS}
      t={t}
      {...(mode === undefined ? {} : { mode })}
      {...(leftRatio === undefined ? {} : { leftRatio })}
    />,
  )
}

describe('DiffSideBySide — 视图模式', () => {
  it('split（默认）：前后内容都在场 + 分割条 + data-diff-mode 标识', () => {
    const html = render()
    expect(html).toContain('twoOLD')
    expect(html).toContain('twoNEW')
    expect(html).toContain('data-diff-mode="split"')
    expect(html).toContain('dsh-git-ui__splitter')
  })

  it('split：左列占比经 inline flex-basis 生效（70%）', () => {
    const html = render('split', 0.7)
    expect(html).toContain('70%')
  })

  it('before：仅变更前内容——删除行在场，新增行缺席', () => {
    const html = render('before')
    expect(html).toContain('twoOLD')
    expect(html).not.toContain('twoNEW')
    expect(html).toContain('data-diff-mode="before"')
    // 单栏全宽：无分割条。
    expect(html).not.toContain('dsh-git-ui__splitter')
  })

  it('after：仅变更后内容——新增行在场，删除行缺席', () => {
    const html = render('after')
    expect(html).toContain('twoNEW')
    expect(html).not.toContain('twoOLD')
    expect(html).toContain('data-diff-mode="after"')
    expect(html).not.toContain('dsh-git-ui__splitter')
  })

  it('before/after 的行号取对应侧，删除行带红底、新增行带绿底', () => {
    // before 流：one(1) twoOLD(2) three(3)；after 流：one(1) twoNEW(2) three(3)。
    const before = render('before')
    expect(before).toContain('>2</span>')
    expect(before).toContain('>twoOLD</span>')
    // 删除行红底（error 语义色淡晕）。
    expect(before).toContain('var(--dsw-alias-state-error-primary) 12%')
    const after = render('after')
    expect(after).toContain('>2</span>')
    expect(after).toContain('>twoNEW</span>')
    // 新增行绿底（success 语义色淡晕）。
    expect(after).toContain('var(--dsw-alias-state-success-primary) 12%')
  })
})
