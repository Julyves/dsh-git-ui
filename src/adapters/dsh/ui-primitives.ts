/**
 * dsh UI 基础组件适配：将 `@deepseek-ai/dsh-client-ui-primitives` 的
 * Modal / Button / Toast 包装为我们的 `UIPrimitives` 接口。
 *
 * 本文件是 client 端**唯一** import `@deepseek-ai/dsh-client-ui-primitives`
 * 的地方。dsh 升级导致组件 API 变更时，只需修改此文件。
 */
import { Modal as DshModal, Button as DshButton, Toast as DshToast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UIPrimitives } from '../../contracts/ui-primitives.ts'

/** dsh 宿主提供的 UI 基础组件实现。 */
export const dshUIPrimitives: UIPrimitives = {
  Modal: DshModal,
  Button: DshButton,
  Toast: DshToast,
}
