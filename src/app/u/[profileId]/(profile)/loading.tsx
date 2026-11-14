'use client';

import { useParams } from 'next/navigation';

import { ProfilePageSkeleton } from '@/features/profile/ProfilePageClient';

export default function ProfileLoading() {
  const { profileId } = useParams<{ profileId: string }>();
  return <ProfilePageSkeleton profileId={profileId} />;
}
