import { getConfigForRead } from '@/lib/config';
import { probeSourceSearch } from '@/lib/downstream';
import { runWithConcurrency } from '@/lib/downstream-sources/shared';
import { flushSourceHealthSearch } from '@/lib/source-health.server';
import {
  SOURCE_HEALTH_PROBE_CONCURRENCY,
  SOURCE_HEALTH_PROBE_KEYWORDS,
  SOURCE_HEALTH_PROBE_KEYWORDS_PER_RUN,
} from '@/lib/source-quality-policy';

export function getSourceHealthProbeKeywords(now: Date): string[] {
  const utcDay = Math.floor(now.getTime() / 86_400_000);
  const count = SOURCE_HEALTH_PROBE_KEYWORDS.length;
  const start =
    (((utcDay * SOURCE_HEALTH_PROBE_KEYWORDS_PER_RUN) % count) + count) % count;
  return Array.from(
    { length: SOURCE_HEALTH_PROBE_KEYWORDS_PER_RUN },
    (_, index) => SOURCE_HEALTH_PROBE_KEYWORDS[(start + index) % count],
  );
}

export async function probeConfiguredSources(now = new Date()): Promise<void> {
  try {
    const config = await getConfigForRead();
    const keywords = getSourceHealthProbeKeywords(now);
    await runWithConcurrency(
      config.SourceConfig.filter((source) => !source.disabled).map(
        (source) => async () => {
          for (const query of keywords) {
            try {
              await probeSourceSearch(source, query);
            } catch (error) {
              console.warn(`Source health probe failed [${source.key}]`, error);
            }
          }
        },
      ),
      SOURCE_HEALTH_PROBE_CONCURRENCY,
    );
  } catch (error) {
    console.warn('Source health cron failed', error);
  } finally {
    try {
      await flushSourceHealthSearch();
      // The first call may only join an automatic flush; drain samples collected during it.
      await flushSourceHealthSearch();
    } catch (error) {
      console.warn('Source health cron flush failed', error);
    }
  }
}
