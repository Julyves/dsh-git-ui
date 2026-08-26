/**
 * Markdown 渲染器测试：块级结构、行内标记、安全（HTML 转义/链接 scheme
 * 白名单）、renderedSourceOf 重建（diff → 变更后完整文本）。
 * 静态渲染（react-dom/server）+ HTML 字符串断言；高亮在静态渲染下不
 * 就绪（effect 不跑）→ 围栏代码按纯文本断言稳定。
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownView, renderedSourceOf } from '../../src/client/markdown.tsx'
import { zh } from '../../src/client/locales.ts'

const t = (key: keyof typeof zh): string => zh[key]

function render(source: string): string {
  return renderToStaticMarkup(
    <MarkdownView source={source} fontSize={12} highlight t={t} />,
  )
}

describe('MarkdownView — 块级结构', () => {
  it('标题六级各自渲染为对应层级样式', () => {
    const html = render('# H1\n## H2\n### H3')
    expect(html).toContain('H1</div>')
    expect(html).toContain('H2</div>')
    expect(html).toContain('H3</div>')
    // 三级字号不同（1.7em / 1.45em / 1.22em）
    expect(html).toContain('font-size:1.7em')
    expect(html).toContain('font-size:1.45em')
    expect(html).toContain('font-size:1.22em')
  })

  it('围栏代码块渲染为 pre（语言名仅作高亮线索，纯文本回落不报错）', () => {
    const html = render('```\nconst a = 1\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('const a = 1')
  })

  it('引用块：连续 > 行合并，内部结构递归解析', () => {
    const html = render('> 引用**粗体**\n> 第二行')
    expect(html).toContain('<blockquote')
    expect(html).toContain('引用')
    expect(html).toContain('<strong')
  })

  it('无序列表（含一层嵌套，兄弟子列表各自归属）', () => {
    const html = render('- a\n  - x\n- b\n  - y')
    expect(html).toContain('>a<')
    expect(html).toContain('>x<')
    expect(html).toContain('>b<')
    expect(html).toContain('>y<')
  })

  it('有序列表渲染序号标记', () => {
    const html = render('1. one\n2. two')
    expect(html).toContain('>1.</span>')
    expect(html).toContain('>2.</span>')
    expect(html).toContain('one')
    expect(html).toContain('two')
  })

  it('GFM 表格：表头 + 数据行', () => {
    const html = render('| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |')
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('名称')
    expect(html).toContain('>a<')
    expect(html).toContain('>2<')
  })

  it('hr / 段落 / 多段合并', () => {
    const html = render('第一段\n延续行\n\n第二段\n\n---')
    expect(html).toContain('<hr')
    expect(html).toContain('第一段 延续行')
    expect(html).toContain('第二段')
  })

  it('空源 → 空态文案；截断兜底（超 2000 行提示）', () => {
    expect(render('')).toContain(zh['diff.renderedEmpty'])
    const huge = `${'a\n'.repeat(2500)}`
    expect(render(huge)).toContain(zh['diff.truncated'].replace('{count}', '2000'))
  })
})

describe('MarkdownView — 行内标记', () => {
  it('粗体 / 斜体 / 删除线 / 行内码', () => {
    const html = render('**b** *i* ~~s~~ `c`')
    expect(html).toContain('<strong')
    expect(html).toContain('<em')
    expect(html).toContain('<s')
    expect(html).toContain('<code')
  })

  it('链接渲染为 a（白名单 scheme），文字可含强调', () => {
    const html = render('[**文档**](https://example.com/a?b=1) 与 [相对](/docs/x)')
    expect(html).toContain('href="https://example.com/a?b=1"')
    expect(html).toContain('href="/docs/x"')
    expect(html).toContain('target="_blank"')
  })

  it('图片渲染为 img（alt 保留）', () => {
    const html = render('![截图](https://example.com/i.png)')
    expect(html).toContain('<img')
    expect(html).toContain('alt="截图"')
  })
})

describe('MarkdownView — 安全', () => {
  it('原始 HTML 不穿透（无 dangerouslySetInnerHTML，标签按文本呈现）', () => {
    const html = render('<script>alert(1)</script> 与 <img src=x onerror=1>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('onerror=1') // 作为文本
  })

  it('危险 scheme 链接降级为纯文本（不可点）', () => {
    const html = render('[点我](javascript:alert(1))')
    expect(html).not.toContain('href="javascript')
    expect(html).not.toContain('<a ')
    expect(html).toContain('点我')
  })

  it('行内码内的 HTML 同样转义', () => {
    const html = render('`<b>x</b>`')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;')
  })
})

describe('renderedSourceOf — diff → 变更后完整文本', () => {
  it('修改：右侧流拼接 = 变更后全文（含上下文）', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' one',
      '-two',
      '+TWO',
      ' three',
    ].join('\n')
    expect(renderedSourceOf(diff)).toBe('one\nTWO\nthree')
  })

  it('纯新增：右侧全增行 = 新文件全文', () => {
    const diff = [
      '--- /dev/null',
      '+++ b/new.md',
      '@@ -0,0 +1,2 @@',
      '+hello',
      '+world',
    ].join('\n')
    expect(renderedSourceOf(diff)).toBe('hello\nworld')
  })

  it('空 diff → 空文本', () => {
    expect(renderedSourceOf('')).toBe('')
  })
})

describe('MarkdownView — 原始 HTML img（白名单标签）', () => {
  it('README 形态的 <img src alt width> 渲染为真实图片元素', () => {
    const html = render('<img src="docs/screenshots/01-面板内容展示.png" alt="会话头部分支 Pill 与展开的详情面板" width="720">')
    expect(html).toContain('<img')
    expect(html).toContain('src="docs/screenshots/01-面板内容展示.png"')
    expect(html).toContain('alt="会话头部分支 Pill 与展开的详情面板"')
    expect(html).toContain('width:720')
    expect(html).toContain('loading="lazy"')
  })

  it('图片标记不再按原文转义呈现', () => {
    const html = render('<img src="a.png" alt="x">')
    expect(html).not.toContain('&lt;img')
  })

  it('危险 scheme 的 img src 拒绝（不产 img 元素）', () => {
    const html = render('<img src="javascript:alert(1)" alt="x">')
    expect(html).not.toContain('<img')
  })

  it('无 src 的 img 标签按原文呈现（不猜测）', () => {
    const html = render('<img alt="x">')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})

describe('MarkdownView — mermaid 围栏块', () => {
  const FLOW = '```mermaid\ngraph TD\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]\n```'

  it('flowchart 默认渲染态：输出 SVG（节点/边标签在场）', () => {
    const html = render(FLOW)
    expect(html).toContain('<svg')
    expect(html).toContain('开始')
    expect(html).toContain('判断')
    expect(html).toContain('是')
  })

  it('左上角渲染/源码切换开关在场', () => {
    const html = render(FLOW)
    expect(html).toContain(zh['diff.view.rendered'])
    expect(html).toContain(zh['diff.mermaid.source'])
    expect(html).toContain('aria-pressed="true"')
  })

  it('sequenceDiagram 渲染：参与者与消息在场', () => {
    const html = render('```mermaid\nsequenceDiagram\n  participant U as 用户\n  participant P as Pill\n  U->>P: 点击\n  P-->>U: 弹窗\n```')
    expect(html).toContain('<svg')
    expect(html).toContain('用户')
    expect(html).toContain('点击')
  })

  it('解析失败：块中心提示 + 原因，开关仍可切源码', () => {
    const html = render('```mermaid\ngraph TD\n  A ==>?? B\n```')
    expect(html).toContain(zh['diff.mermaid.error'])
    expect(html).toContain(zh['diff.mermaid.source'])
  })

  it('不支持的图形类型：中心提示（诚实降级）', () => {
    const html = render('```mermaid\npie title 占比\n  "A": 60\n```')
    expect(html).toContain(zh['diff.mermaid.error'])
  })

  it('非 mermaid 代码块无切换开关（保持既有形态）', () => {
    const html = render('```ts\nconst a = 1\n```')
    expect(html).toContain('<pre')
    expect(html).not.toContain(zh['diff.mermaid.source'])
  })
})
