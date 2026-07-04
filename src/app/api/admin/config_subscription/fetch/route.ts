import { NextRequest, NextResponse } from 'next/server';

import { isGuardFailure, requireOwner } from '@/lib/api-auth';
import {
  decodeConfigSubscriptionContent,
  readConfigSubscriptionText,
} from '@/lib/config-subscription';
import { fetchWithUrlGuard, UrlValidationError } from '@/lib/url-guard';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const guardResult = await requireOwner(request, {
      forbiddenMessage: '权限不足，只有站长可以拉取配置订阅',
    });
    if (isGuardFailure(guardResult)) return guardResult.response;

    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: '缺少URL参数' }, { status: 400 });
    }

    const response = await fetchWithUrlGuard(url);

    if (!response.ok) {
      return NextResponse.json(
        { error: `请求失败: ${response.status} ${response.statusText}` },
        { status: response.status },
      );
    }

    const configContent = await readConfigSubscriptionText(response);

    let decodedContent;
    try {
      decodedContent = await decodeConfigSubscriptionContent(configContent);
    } catch (decodeError) {
      console.warn('Base58 解码失败', decodeError);
      throw decodeError;
    }

    return NextResponse.json({
      success: true,
      configContent: decodedContent,
      message: '配置拉取成功',
    });
  } catch (error) {
    if (error instanceof UrlValidationError) {
      return NextResponse.json({ error: error.reason }, { status: 403 });
    }

    console.error('拉取配置失败:', error);
    return NextResponse.json({ error: '拉取配置失败' }, { status: 500 });
  }
}
