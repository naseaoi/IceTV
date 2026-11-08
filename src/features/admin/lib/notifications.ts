import { type ShowAlertFn } from '@/hooks/useAlertModal';
import { showToast } from '@/lib/toast';

export function showError(message: string, showAlert?: ShowAlertFn) {
  if (showAlert) {
    showAlert({ type: 'error', title: '错误', message, showConfirm: true });
    return;
  }

  console.error(message);
}

export function showSuccess(message: string) {
  showToast(message, 'success');
}
