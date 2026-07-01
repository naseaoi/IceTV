'use client';

import { AlertTriangle, Download, FileCheck, Lock, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import AlertModal from '@/features/admin/components/AlertModal';

interface DataMigrationProps {
  onRefreshConfig?: () => Promise<void>;
}

const DataMigration = ({ onRefreshConfig }: DataMigrationProps) => {
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message?: string;
    html?: string;
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

  // 导出数据
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

      // 获取文件名
      const contentDisposition = response.headers.get('content-disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch?.[1] || 'icetv-backup.dat';

      // 下载文件
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

  // 文件选择处理
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // 导入数据
  const handleImport = async () => {
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
        html: `
          <div class="text-left">
            <p><strong>导入完成！</strong></p>
            <p class="mt-2">导入的用户数量: ${result.importedUsers}</p>
            <p>备份时间: ${new Date(result.timestamp).toLocaleString('zh-CN')}</p>
            <p>服务器版本: ${result.serverVersion || '未知版本'}</p>
            <p class="mt-3 text-orange-600">请刷新页面以查看最新数据。</p>
          </div>
        `,
        confirmText: '刷新页面',
        showConfirm: true,
        onConfirm: async () => {
          // 清理状态
          setSelectedFile(null);
          setImportPassword('');
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }

          // 刷新配置
          if (onRefreshConfig) {
            await onRefreshConfig();
          }

          // 刷新页面
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

  return (
    <>
      <div className='mx-auto max-w-6xl space-y-6'>
        {/* 简洁警告提示 */}
        <div className='flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/30 p-4 dark:border-amber-700 dark:bg-amber-900/5'>
          <AlertTriangle className='h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400' />
          <p className='text-sm text-amber-800 dark:text-amber-200'>
            数据迁移操作请谨慎，确保已备份重要数据
          </p>
        </div>

        {/* 主要操作区域 - 响应式布局 */}
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
          {/* 数据导出 */}
          <div className='flex flex-col rounded-lg border border-gray-200 bg-white p-6 transition-shadow hover:shadow-sm dark:border-gray-700 dark:bg-gray-800'>
            <div className='mb-6 flex items-center gap-3'>
              <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-900/20'>
                <Upload className='h-4 w-4 text-blue-600 dark:text-blue-400' />
              </div>
              <div>
                <h3 className='font-semibold text-gray-900 dark:text-gray-100'>
                  数据导出
                </h3>
                <p className='text-sm text-gray-600 dark:text-gray-400'>
                  创建加密备份文件
                </p>
              </div>
            </div>

            <div className='flex flex-1 flex-col'>
              <div className='space-y-4'>
                {/* 密码输入 */}
                <div>
                  <label className='mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300'>
                    <Lock className='h-4 w-4' />
                    加密密码
                  </label>
                  <input
                    type='password'
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    placeholder='设置强密码保护备份文件'
                    className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
                    disabled={isExporting}
                  />
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    导入时需要使用相同密码
                  </p>
                </div>

                {/* 备份内容列表 */}
                <div className='space-y-1 text-xs text-gray-600 dark:text-gray-400'>
                  <p className='mb-2 font-medium text-gray-700 dark:text-gray-300'>
                    备份内容：
                  </p>
                  <div className='grid grid-cols-2 gap-1'>
                    <div>• 管理配置</div>
                    <div>• 用户数据</div>
                    <div>• 播放记录</div>
                    <div>• 收藏夹</div>
                  </div>
                </div>
              </div>

              {/* 导出按钮 */}
              <button
                onClick={handleExport}
                disabled={isExporting || !exportPassword.trim()}
                className={`mt-10 w-full rounded-lg px-4 py-2.5 font-medium transition-colors ${
                  isExporting || !exportPassword.trim()
                    ? 'cursor-not-allowed bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {isExporting ? (
                  <div className='flex items-center justify-center gap-2'>
                    <div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent'></div>
                    导出中...
                  </div>
                ) : (
                  <div className='flex items-center justify-center gap-2'>
                    <Upload className='h-4 w-4' />
                    导出数据
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* 数据导入 */}
          <div className='flex flex-col rounded-lg border border-gray-200 bg-white p-6 transition-shadow hover:shadow-sm dark:border-gray-700 dark:bg-gray-800'>
            <div className='mb-6 flex items-center gap-3'>
              <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 dark:bg-red-900/20'>
                <Download className='h-4 w-4 text-red-600 dark:text-red-400' />
              </div>
              <div>
                <h3 className='font-semibold text-gray-900 dark:text-gray-100'>
                  数据导入
                </h3>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  将清空现有数据
                </p>
              </div>
            </div>

            <div className='flex flex-1 flex-col'>
              <div className='space-y-4'>
                {/* 文件选择 */}
                <div>
                  <label className='mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300'>
                    <FileCheck className='h-4 w-4' />
                    备份文件
                    {selectedFile && (
                      <span className='ml-auto text-xs font-normal text-green-600 dark:text-green-400'>
                        {selectedFile.name} (
                        {(selectedFile.size / 1024).toFixed(1)} KB)
                      </span>
                    )}
                  </label>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='.dat'
                    onChange={handleFileSelect}
                    className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 transition-colors file:mr-3 file:rounded file:border-0 file:bg-gray-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-100 focus:border-red-500 focus:ring-2 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:file:bg-gray-600 dark:file:text-gray-300 dark:hover:file:bg-gray-500'
                    disabled={isImporting}
                  />
                </div>

                {/* 密码输入 */}
                <div>
                  <label className='mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300'>
                    <Lock className='h-4 w-4' />
                    解密密码
                  </label>
                  <input
                    type='password'
                    value={importPassword}
                    onChange={(e) => setImportPassword(e.target.value)}
                    placeholder='输入导出时的加密密码'
                    className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 transition-colors focus:border-red-500 focus:ring-2 focus:ring-red-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
                    disabled={isImporting}
                  />
                </div>
              </div>

              {/* 导入按钮 */}
              <button
                onClick={handleImport}
                disabled={
                  isImporting || !selectedFile || !importPassword.trim()
                }
                className={`mt-10 w-full rounded-lg px-4 py-2.5 font-medium transition-colors ${
                  isImporting || !selectedFile || !importPassword.trim()
                    ? 'cursor-not-allowed bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                {isImporting ? (
                  <div className='flex items-center justify-center gap-2'>
                    <div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent'></div>
                    导入中...
                  </div>
                ) : (
                  <div className='flex items-center justify-center gap-2'>
                    <Download className='h-4 w-4' />
                    导入数据
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        html={alertModal.html}
        confirmText={alertModal.confirmText}
        onConfirm={alertModal.onConfirm}
        showConfirm={alertModal.showConfirm ?? true}
        timer={alertModal.timer}
      />
    </>
  );
};

export default DataMigration;
