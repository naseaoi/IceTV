import { getConfig, invalidateConfigCache, saveConfig } from '@/lib/config';
import {
  type RuntimeParamSettings,
  normalizeRuntimeParams,
  RUNTIME_PARAM_RANGES,
} from '@/lib/runtime-params';

export class InvalidRuntimeParamsError extends Error {}

function parseRuntimeParamsUpdate(
  value: unknown,
): Partial<RuntimeParamSettings> {
  const invalid = () =>
    new InvalidRuntimeParamsError('运行参数格式或数值无效，请检查取值范围');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid();
  }

  const entries = Object.entries(value);
  if (entries.length === 0) throw invalid();
  const update: Partial<RuntimeParamSettings> = {};
  for (const [key, parameter] of entries) {
    if (!Object.hasOwn(RUNTIME_PARAM_RANGES, key)) throw invalid();
    const parameterKey = key as keyof RuntimeParamSettings;
    const range = RUNTIME_PARAM_RANGES[parameterKey];
    if (
      typeof parameter !== 'number' ||
      !Number.isSafeInteger(parameter) ||
      parameter < range.min ||
      parameter > range.max
    ) {
      throw invalid();
    }
    update[parameterKey] = parameter;
  }
  return update;
}

export async function saveRuntimeParams(value: unknown): Promise<void> {
  const update = parseRuntimeParamsUpdate(value);
  invalidateConfigCache();
  const config = await getConfig();
  Object.assign(
    config.SiteConfig,
    normalizeRuntimeParams({ ...config.SiteConfig, ...update }),
  );
  await saveConfig(config);
}
