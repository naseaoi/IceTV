import { notFound } from 'next/navigation';

import PlayPage from '@/app/play/page';
import { parsePlayPagePath } from '@/features/play/lib/playPageUrl';

// 动态段参数是未解码的原始路径片段；源与 ID 由客户端从地址解析，这里只拦截无法解码的地址
export default async function PlayTargetPage({
  params,
}: {
  params: Promise<{ source: string; id: string }>;
}) {
  const { source, id } = await params;
  const target = parsePlayPagePath(`/play/${source}/${id}`);
  if (!target) notFound();
  return PlayPage({ searchParams: Promise.resolve({ source: target.source }) });
}
