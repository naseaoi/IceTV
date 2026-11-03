const AVATAR_GRADIENTS = [
  'from-sky-400 to-blue-600',
  'from-violet-400 to-purple-600',
  'from-rose-400 to-pink-600',
  'from-amber-400 to-orange-600',
  'from-teal-400 to-cyan-600',
  'from-lime-400 to-green-600',
];

export function avatarGradient(profileId: string): string {
  let hash = 0;
  for (const char of profileId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

export default function ProfileAvatar({
  profileId,
  nickname,
  className = 'h-8 w-8 text-sm',
}: {
  profileId: string;
  nickname: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden='true'
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ${avatarGradient(profileId)} ${className}`}
    >
      {Array.from(nickname ?? '未')[0]?.toUpperCase()}
    </span>
  );
}
