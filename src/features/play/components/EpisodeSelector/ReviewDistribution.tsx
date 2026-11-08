'use client';

function bucketLabel(index: number): string {
  return index === 9 ? '10 分' : `${index + 1}–${index + 1}.9 分`;
}

export default function ReviewDistribution({
  distribution,
}: {
  distribution: number[];
}) {
  const counts = Array.from(
    { length: 10 },
    (_, index) => distribution?.[index] ?? 0,
  );
  const max = Math.max(1, ...counts);
  return (
    <section aria-label='评分分布' className='min-w-0 flex-1'>
      <ul className='flex items-end gap-1'>
        {counts.map((count, index) => (
          <li
            key={index}
            title={`${bucketLabel(index)}：${count} 人`}
            className='flex flex-1 flex-col items-center gap-1'
          >
            <span className='sr-only'>
              {bucketLabel(index)}，{count} 人
            </span>
            <span
              aria-hidden='true'
              className='flex h-14 w-full items-end overflow-hidden rounded-sm bg-gray-900/[0.04] dark:bg-white/[0.04]'
            >
              <span
                style={{ height: `${(count / max) * 100}%` }}
                className={`block w-full rounded-sm forced-colors:bg-[Highlight] ${
                  count === max && count > 0
                    ? 'bg-amber-500'
                    : 'bg-amber-500/45 dark:bg-amber-500/40'
                }`}
              />
            </span>
            <span
              aria-hidden='true'
              className='text-[10px] tabular-nums text-gray-400 dark:text-gray-500'
            >
              {index + 1}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
