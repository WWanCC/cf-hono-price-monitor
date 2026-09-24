/** Element Plus 交互辅助函数，统一错误提示和危险操作确认样式。 */
import { ElMessage, ElMessageBox } from 'element-plus'

import { ApiError } from './api'

export function showError(error: unknown) {
  const message =
    error instanceof ApiError || error instanceof Error
      ? error.message
      : '操作失败'

  ElMessage.error(message)
}

/**
 * 删除类操作统一使用 warning 确认框。
 * 用户取消时 Element Plus 会 reject，由调用方识别 'cancel' / 'close' 后静默结束。
 */
export async function confirmDanger(
  message: string,
  title = '确认删除',
) {
  await ElMessageBox.confirm(message, title, {
    type: 'warning',
    confirmButtonText: '确认',
    cancelButtonText: '取消',
  })
}
