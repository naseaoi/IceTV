import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '安全警告 - IceTV',
  description: '站点安全配置警告',
};

export default function WarningPage() {
  return (
    <div className='flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-4'>
      <div className='w-full max-w-2xl rounded-2xl border border-red-200 bg-white p-4 shadow-2xl sm:p-8'>
        <div className='mb-4 flex justify-center sm:mb-6'>
          <div className='flex h-16 w-16 items-center justify-center rounded-full bg-red-100 sm:h-20 sm:w-20'>
            <svg
              className='h-10 w-10 text-red-600 sm:h-12 sm:w-12'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
              />
            </svg>
          </div>
        </div>

        <div className='mb-6 text-center sm:mb-8'>
          <h1 className='mb-2 text-2xl font-bold text-gray-900 sm:text-3xl'>
            安全合规配置警告
          </h1>
          <div className='mx-auto h-1 w-12 rounded-full bg-red-500 sm:w-16'></div>
        </div>

        <div className='space-y-4 text-gray-700 sm:space-y-6'>
          <div className='rounded-r-lg border-l-4 border-red-500 bg-red-50 p-3 sm:p-4'>
            <p className='mb-2 text-base font-semibold text-red-800 sm:text-lg'>
              ⚠️ 安全风险提示
            </p>
            <p className='text-sm text-red-700 sm:text-base'>
              检测到您的站点未配置访问控制，存在潜在的安全风险和法律合规问题。
            </p>
          </div>

          <div className='space-y-3 sm:space-y-4'>
            <h2 className='text-lg font-semibold text-gray-900 sm:text-xl'>
              主要风险
            </h2>
            <ul className='space-y-2 text-sm text-gray-600 sm:space-y-3 sm:text-base'>
              <li className='flex items-start'>
                <span className='mr-2 mt-0.5 text-red-500'>•</span>
                <span>未经授权的访问可能导致内容被恶意传播</span>
              </li>
              <li className='flex items-start'>
                <span className='mr-2 mt-0.5 text-red-500'>•</span>
                <span>服务器资源可能被滥用，影响正常服务</span>
              </li>
              <li className='flex items-start'>
                <span className='mr-2 mt-0.5 text-red-500'>•</span>
                <span>可能收到相关权利方的法律通知</span>
              </li>
              <li className='flex items-start'>
                <span className='mr-2 mt-0.5 text-red-500'>•</span>
                <span>服务提供商可能因合规问题终止服务</span>
              </li>
            </ul>
          </div>

          <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-3 sm:p-4'>
            <h3 className='mb-2 text-base font-semibold text-yellow-800 sm:text-lg'>
              🔒 安全配置建议
            </h3>
            <p className='text-sm text-yellow-700 sm:text-base'>
              请立即配置{' '}
              <code className='rounded bg-yellow-100 px-1.5 py-0.5 font-mono text-xs sm:text-sm'>
                PASSWORD
              </code>{' '}
              环境变量以启用访问控制。
            </p>
          </div>
        </div>

        <div className='mt-6 flex justify-center sm:mt-8'>
          <Link
            href='/'
            className='inline-flex h-10 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700'
          >
            返回首页
          </Link>
        </div>

        <div className='mt-6 border-t border-gray-200 pt-4 sm:mt-8 sm:pt-6'>
          <div className='text-center text-xs text-gray-500 sm:text-sm'>
            <p>为确保系统安全性和合规性，请及时完成安全配置</p>
          </div>
        </div>
      </div>
    </div>
  );
}
