'use client';

import { Download, FileUp, Upload } from 'lucide-react';
import { type FormEvent, type ReactNode, useRef, useState } from 'react';

import AlertModal from '@/components/modals/AlertModal';
import ConfirmModal from '@/components/modals/ConfirmModal';
import { PasswordInput } from '@/components/PasswordInput';
import Spinner from '@/components/Spinner';
import {
  AdminSettingRow,
  AdminSettingsGroup,
} from '@/features/admin/components/AdminSettings';
import { buttonStyles, inputStyles } from '@/features/admin/lib/buttonStyles';

interface DataMigrationProps {
  onRefreshConfig?: () => Promise<void>;
}

const EXPORT_PASSWORD_ID = 'data-export-password';
const IMPORT_FILE_ID = 'data-import-file';
const IMPORT_PASSWORD_ID = 'data-import-password';

const BACKUP_INCLUDED = [
  '管理配置',
  '用户与密码',
  '播放记录',
  '收藏夹',
  '搜索历史',
  '跳过片头片尾',
  '观看统计',
  '邀请码与用量',
  '源站路由统计',
  '站点图标',
];

const BACKUP_EXCLUDED = [
  '站长账号密码（由环境变量决定）',
  '环境变量与部署配置',
  '服务端缓存与封面缓存',
];

const TRUNCATION_LABELS: Record<string, string> = {
  searchHistory: '搜索历史',
  playbackSessions: '观看统计',
};

type TruncationReport = {
  username: string;
  kind: string;
  dropped: number;
};

function summarizeTruncation(reports: TruncationReport[]): string[] {
  const byKind = new Map<string, { users: number; dropped: number }>();
  for (const report of reports) {
    const entry = byKind.get(report.kind) ?? { users: 0, dropped: 0 };
    entry.users += 1;
    entry.dropped += report.dropped;
    byKind.set(report.kind, entry);
  }

  return [...byKind.entries()].map(
    ([kind, { users, dropped }]) =>
      `${TRUNCATION_LABELS[kind] ?? kind}：${users} 个用户共 ${dropped} 条超出上限被丢弃`,
  );
}

const DataMigration = ({ onRefreshConfig }: DataMigrationProps) => {
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message?: string;
    content?: ReactNode;
    confirmText?: string;
    onConfirm?: () => void;
    showConfirm?: boolean;
    timer?: number;
  }>({
    isOpen: false,
    type: 'success',
    title: '',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showAlert = (config: Omit<typeof alertModal, 'isOpen'>) => {
    setAlertModal({ ...config, isOpen: true });
  };

  const hideAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  const handleExport = async () => {
    if (!exportPassword.trim()) {
      showAlert({
        type: 'error',
        title: '错误',
        message: '请输入加密密码',
      });
      return;
    }

    try {
      setIsExporting(true);

      const response = await fetch('/api/admin/data_migration/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: exportPassword,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `导出失败: ${response.status}`);
      }

      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || 'icetv-backup.dat';

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      a.style.position = 'fixed';
      a.style.top = '0';
      a.style.left = '0';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      showAlert({
        type: 'success',
        title: '导出成功',
        message: '数据已成功导出，请妥善保管备份文件和密码',
        timer: 3000,
      });

      setExportPassword('');
    } catch (error) {
      showAlert({
        type: 'error',
        title: '导出失败',
        message: error instanceof Error ? error.message : '导出过程中发生错误',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleImportRequest = () => {
    if (!selectedFile) {
      showAlert({
        type: 'error',
        title: '错误',
        message: '请选择备份文件',
      });
      return;
    }

    if (!importPassword.trim()) {
      showAlert({
        type: 'error',
        title: '错误',
        message: '请输入解密密码',
      });
      return;
    }

    setShowImportConfirm(true);
  };

  const handleImport = async () => {
    if (!selectedFile || !importPassword.trim()) return;
    setShowImportConfirm(false);

    try {
      setIsImporting(true);

      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('password', importPassword);

      const response = await fetch('/api/admin/data_migration/import', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `导入失败: ${response.status}`);
      }

      showAlert({
        type: 'success',
        title: '导入成功',
        content: (
          <div className='text-left'>
            <p>
              <strong>导入完成！</strong>
            </p>
            <p className='mt-2'>导入的用户数量: {result.importedUsers}</p>
            <p>
              备份时间:{' '}
              {result.timestamp
                ? new Date(result.timestamp).toLocaleString('zh-CN')
                : '未知时间'}
            </p>
            <p>服务器版本: {result.serverVersion || '未知版本'}</p>
            {result.ownerRemappedFrom && (
              <p className='mt-2 text-brand-600'>
                原站站长 {result.ownerRemappedFrom}{' '}
                的数据已归到本机站长账号下，登录仍使用本机的站长密码。
              </p>
            )}
            {result.siteIconWarning && (
              <p className='mt-2 text-orange-600'>{result.siteIconWarning}</p>
            )}
            {Array.isArray(result.truncated) && result.truncated.length > 0 && (
              <div className='mt-2 text-orange-600'>
                <p>部分数据超出上限被截断：</p>
                <ul className='mt-1 list-inside list-disc'>
                  {summarizeTruncation(result.truncated).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className='mt-3 text-orange-600'>请刷新页面以查看最新数据。</p>
          </div>
        ),
        confirmText: '刷新页面',
        showConfirm: true,
        onConfirm: async () => {
          setSelectedFile(null);
          setImportPassword('');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }

          if (onRefreshConfig) {
            await onRefreshConfig();
          }

          window.location.reload();
        },
      });
    } catch (error) {
      showAlert({
        type: 'error',
        title: '导入失败',
        message: error instanceof Error ? error.message : '导入过程中发生错误',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleExport();
  };

  const handleImportSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleImportRequest();
  };

  const canExport = !isExporting && exportPassword.trim().length > 0;
  const canImport =
    !isImporting && selectedFile !== null && importPassword.trim().length > 0;

  return (
    <>
      <div className='space-y-8'>
        <form onSubmit={handleExportSubmit}>
          <AdminSettingsGroup title='导出备份'>
            <AdminSettingRow
              label='加密密码'
              htmlFor={EXPORT_PASSWORD_ID}
              description='导入时需输入相同密码'
            >
              <div className='flex w-full gap-2 sm:w-96'>
                <PasswordInput
                  id={EXPORT_PASSWORD_ID}
                  name='exportPassword'
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  autoComplete='new-password'
                  wrapperClassName='min-w-0 flex-1'
                  className={`h-9 w-full pr-10 ${inputStyles.withFocus}`}
                  disabled={isExporting}
                />
                <button
                  type='submit'
                  disabled={!canExport}
                  className={`inline-flex h-9 shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles.primary}`}
                >
                  {isExporting ? (
                    <Spinner className='h-3.5 w-3.5' />
                  ) : (
                    <Upload aria-hidden='true' className='h-3.5 w-3.5' />
                  )}
                  {isExporting ? '导出中' : '导出数据'}
                </button>
              </div>
            </AdminSettingRow>
            <AdminSettingRow label='备份内容' layout='stacked'>
              <ul className='flex flex-wrap gap-1.5'>
                {BACKUP_INCLUDED.map((item) => (
                  <li
                    key={item}
                    className='rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'
                  >
                    {item}
                  </li>
                ))}
              </ul>
              <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                不含：{BACKUP_EXCLUDED.join('、')}
              </p>
            </AdminSettingRow>
          </AdminSettingsGroup>
        </form>

        <form onSubmit={handleImportSubmit}>
          <AdminSettingsGroup title='导入备份'>
            <AdminSettingRow label='备份文件' htmlFor={IMPORT_FILE_ID}>
              <div className='flex w-full min-w-0 items-center gap-3 sm:w-96'>
                <input
                  ref={fileInputRef}
                  id={IMPORT_FILE_ID}
                  name='backupFile'
                  type='file'
                  accept='.dat'
                  onChange={handleFileSelect}
                  className='hidden'
                  disabled={isImporting}
                />
                <button
                  type='button'
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  className={`inline-flex h-9 shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles.outline}`}
                >
                  <FileUp aria-hidden='true' className='h-3.5 w-3.5' />
                  选择文件
                </button>
                <span
                  className={`min-w-0 truncate text-sm ${
                    selectedFile
                      ? 'text-gray-900 dark:text-gray-100'
                      : 'text-gray-400'
                  }`}
                  title={selectedFile?.name}
                >
                  {selectedFile
                    ? `${selectedFile.name} · ${(selectedFile.size / 1024).toFixed(1)} KB`
                    : '未选择'}
                </span>
              </div>
            </AdminSettingRow>
            <AdminSettingRow label='解密密码' htmlFor={IMPORT_PASSWORD_ID}>
              <div className='flex w-full gap-2 sm:w-96'>
                <PasswordInput
                  id={IMPORT_PASSWORD_ID}
                  name='importPassword'
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  autoComplete='off'
                  wrapperClassName='min-w-0 flex-1'
                  className={`h-9 w-full pr-10 ${inputStyles.withFocus}`}
                  disabled={isImporting}
                />
                <button
                  type='submit'
                  disabled={!canImport}
                  className={`inline-flex h-9 shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles.danger}`}
                >
                  {isImporting ? (
                    <Spinner className='h-3.5 w-3.5' />
                  ) : (
                    <Download aria-hidden='true' className='h-3.5 w-3.5' />
                  )}
                  {isImporting ? '导入中' : '导入数据'}
                </button>
              </div>
            </AdminSettingRow>
          </AdminSettingsGroup>
        </form>
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        confirmText={alertModal.confirmText}
        onConfirm={alertModal.onConfirm}
        showConfirm={alertModal.showConfirm ?? true}
        timer={alertModal.timer}
      >
        {alertModal.content}
      </AlertModal>

      <ConfirmModal
        isOpen={showImportConfirm}
        title='确认导入数据'
        message='导入将清空并覆盖现有管理配置、用户数据、播放记录和收藏夹，此操作无法撤销。'
        onClose={() => setShowImportConfirm(false)}
        onConfirm={() => void handleImport()}
        confirmText='确认导入'
        confirmDisabled={isImporting}
        danger
      />
    </>
  );
};

export default DataMigration;
