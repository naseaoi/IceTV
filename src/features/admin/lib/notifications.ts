import { type ShowAlertFn } from '@/features/admin/hooks/useAlertModal';

export function showError(message: string, showAlert?: ShowAlertFn) {
  if (showAlert) {
    showAlert({ type: 'error', title: '错误', message, showConfirm: true });
    return;
  }

  console.error(message);
}

export function showSuccess(message: string, showAlert?: ShowAlertFn) {
  if (showAlert) {
    showAlert({ type: 'success', title: '成功', message, timer: 2000 });
    return;
  }

  console.log(message);
}
