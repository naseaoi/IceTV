'use client';

import { Home as HomeIcon, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';

import CapsuleSwitch from '@/components/CapsuleSwitch';

export function HomeMineSwitch({ active }: { active: 'home' | 'mine' }) {
  const router = useRouter();

  const handleChange = (value: string) => {
    router.push(value === 'mine' ? '/me' : '/');
  };

  return (
    <CapsuleSwitch
      options={[
        { label: '首页', value: 'home', icon: HomeIcon },
        { label: '我的', value: 'mine', icon: UserRound },
      ]}
      active={active}
      onChange={handleChange}
    />
  );
}
