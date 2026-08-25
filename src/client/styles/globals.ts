/** 全局伪类交互样式（:hover / :focus-visible，注入一次）。 */


/**
 * Global styles for pseudo-class interactions (inline styles can't express
 * :hover/:focus-visible). Injected once per document under a plugin-scoped id.
 */
const GLOBAL_CSS_ID = 'dsh-git-ui/styles'

const globalCss = [
  // ── 分支图调色板（24 色 HSL 均匀色相分布，亮暗两套） ──────────────────────
  // 色相 15° 步进覆盖全环；亮态 S55/L50（浅底鲜明），暗态 S45/L62（暗底提亮不刺眼）。
  // SVG stroke attribute 直接 var()，主题切换零 JS 重渲染。
  '.dsh-git-ui__graph { '
    + Array.from({ length: 24 }, (_, i) => `--dsg-graph-${i}: hsl(${i * 15}, 55%, 50%)`).join('; ')
    + ' }',
  '@media (prefers-color-scheme: dark) { .dsh-git-ui__graph { '
    + Array.from({ length: 24 }, (_, i) => `--dsg-graph-${i}: hsl(${i * 15}, 45%, 62%)`).join('; ')
    + ' } }',

  // Elevated 面滚动条重绑（宿主 scrollbar.css 契约：浮起表面须用 l2 滑块对，
  // 否则滑块底色与 layer-3 面同色而隐形）——popup / Git 中心 Modal / 自绘下拉。
  '.dsh-git-ui__pop, .dsh-git-ui__center, .dsh-git-ui__select-menu { --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }',

  // 浮层入场（emil「勿从 scale(0) 入场」「浮层 origin-aware」）：
  // popup 默认下展 → top center；SelectMenu 始终按钮左下展 → top left。
  // @starting-style 无 JS 入场；不支持的引擎降级为瞬现（无功能回归）。
  '.dsh-git-ui__pop, .dsh-git-ui__select-menu { transition: opacity 150ms ease-out, transform 150ms ease-out; }',
  '.dsh-git-ui__pop { transform-origin: top center; }',
  '.dsh-git-ui__select-menu { transform-origin: top left; }',
  '.dsh-git-ui__pop, .dsh-git-ui__select-menu { opacity: 1; transform: scale(1); @starting-style { opacity: 0; transform: scale(0.97); } }',

  // ── 基础几何 + 过渡（含按压 transform，GPU 友好；禁用 transition: all）──────
  // 按钮基础重置：平台/UA 按钮的默认底色与文字统一到主题令牌。
  // 此前依赖内联 background: transparent——它能压住 UA 底，但也会把全局
  // :hover/:active 反馈一并压掉（交互态从不渲染）。现改由全局 CSS 提供基础值，
  // 基础规则在前、伪类规则在后（.tab:hover / .icon-btn:active 等），可正常覆盖。
  '.dsh-git-ui__tab, .dsh-git-ui__icon-btn { background: transparent; }',
  '.dsh-git-ui__tab { color: var(--dsw-alias-label-tertiary); }',
  '.dsh-git-ui__icon-btn { color: var(--dsw-alias-label-secondary); }',
  '.dsh-git-ui__row { border-radius: 6px; }',
  // 按压即时缩放：所有可按压元素 :active 时 scale(0.97)，松手回弹（emil「按钮必须可按压」）。
  '.dsh-git-ui__pill { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__row { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // 提交行：基础 transition（transform/background）+ 选中强调条过渡（box-shadow 220ms 淡入）。
  '.dsh-git-ui__commit-row { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), box-shadow 220ms var(--ds-ease-in-out); }',
  '.dsh-git-ui__refresh { transition: transform var(--ds-transition-duration-fast) ease-out, color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // 提交行入场：仅首次挂载（增量追加/过滤切换）淡入微上移一次，fill-mode both
  // 保持最终态；reduced-motion 下禁用（见下）。虚拟化后只触发窗口行（~60），安全。
  '@keyframes dsh-git-row-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }',
  '.dsh-git-ui__commit-row { animation: dsh-git-row-in 160ms ease-out both; }',
  // 输入框 hover 反馈：边框由 l2 加深至 l1（聚焦环由 focus-visible 承担）。
  '.dsh-git-ui__branch-input, .dsh-git-ui__commit-input { transition: border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // System tab underline: 2px bar below the active tab.
  '.dsh-git-ui__tab { transition: transform var(--ds-transition-duration-fast) ease-out, color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__tab::after { content: ""; position: absolute; right: 0; bottom: 1px; left: 0; height: 2px; border-radius: 2px; background: transparent; transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__tab--active::after { background: var(--dsw-alias-state-business-primary); }',
  // 工具栏下拉按钮：hover 淡底 + 缓动（与图标按钮同一交互语言）。
  '.dsh-git-ui__toolbar-select { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // IDEA 式悬停操作：行尾图标默认隐藏，悬停/键盘聚焦显现（元素常驻，无布局跳动）。
  '.dsh-git-ui__row-actions { opacity: 0; transition: opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__row:focus-within .dsh-git-ui__row-actions { opacity: 1; }',
  // 行操作图标按钮的过渡。
  '.dsh-git-ui__icon-btn { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__icon-btn:disabled { opacity: 0.45; cursor: default; }',
  '.dsh-git-ui__refresh:disabled { opacity: 0.45; cursor: default; }',
  // popup 变更文件名按钮（打开 Git 中心 diff）：基础主文本色 + hover 主色 + 按压缩放反馈。
  // 基础色也走样式表（内联 color 会压掉 :hover 规则）。
  '.dsh-git-ui__change-link { color: var(--dsw-alias-label-primary); transition: transform var(--ds-transition-duration-fast) ease-out, color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__change-link:hover { color: var(--dsw-alias-state-business-primary); }',
  '.dsh-git-ui__change-link:active { transform: scale(0.97); }',
  '.dsh-git-ui__diff-fold { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // 底栏主操作过渡（按压缩放 + hover 淡底）。
  '.dsh-git-ui__footer-primary { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // ── 设置区控件过渡（Mac 风：轨道淡变 + 滑钮弹性位移 + 徽章淡变）──
  '.dsh-git-ui__switch { transition: background var(--ds-transition-duration) var(--ds-ease-in-out); }',
  '.dsh-git-ui__switch-knob { transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1); }',
  '.dsh-git-ui__segment { transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__counts-badge { transition: background var(--ds-transition-duration-fast) var(--ds-ease-in-out), border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out), opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  // 开关状态：滑钮位移经 data-on 切换（inline 不含 transform，CSS 正常接管）。
  // 激活背景 NOT 在此——inline style 优先级高于 class 选择器，CSS 层的背景
  // 覆盖会被压住；激活色由组件条件合并 settingsSwitchOn（见 controls.tsx）。
  '.dsh-git-ui__switch[data-on="true"] .dsh-git-ui__switch-knob { transform: translateX(16px); }',
  // 工具栏自绘按钮（发丝边胶囊族）：hover 提边 + 可按压。
  '.dsh-git-ui__tool-button { transition: transform var(--ds-transition-duration-fast) ease-out, background var(--ds-transition-duration-fast) var(--ds-ease-in-out), border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out), color var(--ds-transition-duration-fast) var(--ds-ease-in-out); }',
  '.dsh-git-ui__tool-button:disabled { opacity: 0.45; cursor: default; }',
  // 复选框键盘聚焦（原生 focus ring 不可控，统一为主题业务色）。
  '.dsh-git-ui__checkbox:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }',

  // ── 按压态（:active，触屏与指针均触发，不闸控）────────────────────────
  // 仅叶子按钮缩放；.dsh-git-ui__row 是含 checkbox/按钮的容器行，:active 会向
  // 祖先传播——按压其子按钮会令整行缩放（非预期），故行级仅用底色反馈（见下条）。
  '.dsh-git-ui__pill:active, .dsh-git-ui__icon-btn:active, .dsh-git-ui__tab:active, .dsh-git-ui__refresh:active, .dsh-git-ui__toolbar-select:active, .dsh-git-ui__diff-fold:active, .dsh-git-ui__commit-row:active, .dsh-git-ui__footer-primary:active, .dsh-git-ui__segment:active, .dsh-git-ui__counts-badge:active, .dsh-git-ui__tool-button:active { transform: scale(0.97); }',
  '.dsh-git-ui__commit-row:active, .dsh-git-ui__row:active { background: var(--dsw-alias-interactive-bg-active); }',
  '.dsh-git-ui__icon-btn:active { background: var(--dsw-alias-interactive-bg-active); }',

  // ── 键盘焦点（始终可见，不闸控）──────────────────────────────────────
  '.dsh-git-ui__pill:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__commit-row:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__refresh:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
  '.dsh-git-ui__commit-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__branch-input:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; border-radius: 4px; }',
  '.dsh-git-ui__toolbar-select:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__diff-fold:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__footer-primary:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__switch:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }',
  '.dsh-git-ui__segment:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__counts-badge:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  '.dsh-git-ui__tool-button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',

  // Git center dialog: widen the platform Modal card (headless mode).
  '.dsh-git-ui__center { width: min(1200px, 100vw); height: min(760px, calc(100vh - 48px)); }',

  // 记录中心 turn 卡片头：基础底色走全局类（内联会压掉 :hover 淡底）。
  '.dsh-git-ui__work-turn { background: var(--dsw-alias-bg-layer-2); }',
  '.dsh-git-ui__work-turn:active { background: var(--dsw-alias-interactive-bg-active); }',
  '.dsh-git-ui__work-turn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }',
  // 展开态:当前展开的 turn 卡片头轻微语义高亮(与 hover 区分)。
  '.dsh-git-ui__work-turn[aria-expanded="true"] { background: color-mix(in srgb, var(--dsw-alias-brand-blue-strong, var(--dsw-alias-state-info-primary)) 8%, var(--dsw-alias-bg-layer-2)); }',

  // ── 悬停态（仅指针设备，触屏 tap 不误激活——emil/apple 闸控规则）──────
  '@media (hover: hover) and (pointer: fine) {',
  '  .dsh-git-ui__pill:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__work-turn:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__commit-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__splitter:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__refresh:hover { color: var(--dsw-alias-state-business-primary); }',
  '  .dsh-git-ui__branch-input:hover, .dsh-git-ui__commit-input:hover { border-color: var(--dsw-alias-border-l1); }',
  '  .dsh-git-ui__tab:hover { color: var(--dsw-alias-label-primary); }',
  '  .dsh-git-ui__toolbar-select:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l1); }',
  '  .dsh-git-ui__icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }',
  '  .dsh-git-ui__diff-fold:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }',
  '  .dsh-git-ui__footer-primary:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__segment:hover { background: var(--dsw-alias-interactive-bg-hover); }',
  '  .dsh-git-ui__counts-badge:hover { border-color: var(--dsw-alias-border-l1); }',
  '  .dsh-git-ui__tool-button:hover { border-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }',
  '  .dsh-git-ui__row:hover .dsh-git-ui__row-actions { opacity: 1; }',
  '}',

  // 触屏（无 hover）回退：行尾操作常驻显现，弥补 hover 闸控后触屏不可见的缺口。
  '@media (hover: none) { .dsh-git-ui__row-actions { opacity: 1; } }',

  // ── 减弱动效（保留辅助理解的透明度/颜色过渡，移除位移与缩放——apple 规则）──
  '@media (prefers-reduced-motion: reduce) {',
  '  .dsh-git-ui__pill, .dsh-git-ui__pop, .dsh-git-ui__select-menu, .dsh-git-ui__icon-btn, .dsh-git-ui__tab, .dsh-git-ui__commit-row, .dsh-git-ui__row, .dsh-git-ui__work-turn, .dsh-git-ui__branch-input, .dsh-git-ui__commit-input, .dsh-git-ui__toolbar-select, .dsh-git-ui__diff-fold, .dsh-git-ui__refresh, .dsh-git-ui__footer-primary, .dsh-git-ui__change-link, .dsh-git-ui__switch, .dsh-git-ui__switch-knob, .dsh-git-ui__segment, .dsh-git-ui__counts-badge, .dsh-git-ui__tool-button { transition: opacity 200ms ease, background 200ms ease, color 200ms ease, border-color 200ms ease !important; transform: none !important; animation: none !important; }',
  '}',
].join('\n')

/** Ensure the global interaction styles exist (idempotent; browser only). */
export function ensureGlobalCss(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(GLOBAL_CSS_ID) !== null) return
  const tag = document.createElement('style')
  tag.id = GLOBAL_CSS_ID
  tag.dataset.plugin = 'dsh-git-ui'
  tag.textContent = globalCss
  document.head.appendChild(tag)
}

