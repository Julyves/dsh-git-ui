/**
 * UI 基础组件契约：业务层只依赖此接口，不直接 import 任何宿主 UI 库。
 *
 * 属性集取「实际使用的最小并集」——GitPill / GitCenter 用到的全部 props
 * 均已覆盖；宿主适配层可提供更丰富的实现，但业务代码保证只消费此处的
 * 声明。未来 dsh 升级导致 Modal/Button/Toast 变更时，只需更新适配层，
 * 业务组件零改动。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** 受控全屏对话框：遮罩 + Escape 关闭。 */
export interface ModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly closeLabel?: string
  readonly description?: string
  readonly children?: ReactNode
  readonly footer?: ReactNode
  readonly className?: string
  readonly contentClassName?: string
  /** 隐藏默认标题栏（自定义头部时使用）。 */
  readonly headless?: boolean
}

/** 令牌化按钮原子。原生 button 属性透传。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
  readonly size?: 'md' | 'sm'
  readonly icon?: ReactNode
  readonly className?: string | undefined
  readonly children?: ReactNode
}

/** 瞬时顶部提示条：自动消失后调用 onDone 通知父级卸载。 */
export interface ToastProps {
  readonly text: string
  readonly icon?: ReactNode
  readonly anchor?: HTMLElement | null
  readonly onDone: () => void
}

/** 三个基础组件的聚合：适配层一次性提供整套实现。 */
export interface UIPrimitives {
  readonly Modal: (props: ModalProps) => ReactNode
  readonly Button: (props: ButtonProps) => ReactNode
  readonly Toast: (props: ToastProps) => ReactNode
}
