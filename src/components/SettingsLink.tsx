import { Settings } from 'lucide-react';
import Link from 'next/link';

export function SettingsLink({ className = '' }: { className?: string }) {
  return (
    <Link
      href='/settings'
      aria-label='设置'
      className={`flex h-10 w-10 items-center justify-center rounded-full transition-[background-color,transform] active:scale-90 ${className}`}
    >
      <Settings
        aria-hidden='true'
        className='h-[22px] w-[22px]'
        strokeWidth={1.75}
      />
    </Link>
  );
}
