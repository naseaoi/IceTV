import ProfilePageClient from '@/features/profile/ProfilePageClient';

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  return <ProfilePageClient key={profileId} profileId={profileId} />;
}
