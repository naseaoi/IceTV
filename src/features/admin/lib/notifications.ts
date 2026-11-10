import { showToast } from '@/lib/toast';
import { getErrorMessage, isAbortError } from '@/lib/user-facing-error';

export function showError(error: unknown, fallback = '操作失败') {
  if (!isAbortError(error))
    showToast(getErrorMessage(error, fallback), 'error');
}

export function showSuccess(message: string) {
  showToast(message, 'success');
}
