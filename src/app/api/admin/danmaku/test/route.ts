import { NextRequest, NextResponse } from 'next/server';

import {
  isDanmakuProviderConfigured,
  searchDanmakuCandidates,
} from '@/features/play/lib/danmaku/provider.server';
import { isGuardFailure, requireAdmin } from '@/lib/api-auth';
import { getConfigFresh } from '@/lib/config';

export const runtime = 'nodejs';

const TEST_TIMEOUT_MS = 5000;
const TEST_KEYWORD = '葬送的芙莉莲';

type TestResult =
  | { success: true; message: string }
  | { success: false; error: string; details?: string };

export async function POST(request: NextRequest): Promise<Response> {
  const guardResult = await requireAdmin(request, {
    forbiddenMessage: '你是管理员吗你就访问？',
  });
  if (isGuardFailure(guardResult)) return guardResult.response;

  try {
    const config = await getConfigFresh();

    if (!config.SiteConfig.EnableDanmaku) {
      return NextResponse.json<TestResult>(
        {
          success: false,
          error: '弹幕功能未开启',
          details: '请先在站点配置中开启"播放器弹幕"开关',
        },
        { status: 400 },
      );
    }

    if (!isDanmakuProviderConfigured()) {
      return NextResponse.json<TestResult>(
        {
          success: false,
          error: '弹幕服务未配置',
          details: '请检查环境变量 DANMAKU_API_BASE_URL 是否已正确设置',
        },
        { status: 400 },
      );
    }

    const candidates = await searchDanmakuCandidates(
      TEST_KEYWORD,
      TEST_TIMEOUT_MS,
    );

    if (candidates.length === 0) {
      return NextResponse.json<TestResult>(
        {
          success: false,
          error: '弹幕服务连接成功但未返回数据',
          details: `搜索关键词"${TEST_KEYWORD}"未返回结果，可能是弹幕库为空或服务配置有误`,
        },
        { status: 200 },
      );
    }

    return NextResponse.json<TestResult>({
      success: true,
      message: `弹幕服务连接正常，测试搜索返回 ${candidates.length} 条结果`,
    });
  } catch (error) {
    let errorMessage = '未知错误';
    let errorDetails: string | undefined;

    if (error instanceof Error) {
      errorMessage = error.message;

      if (errorMessage.includes('not-configured')) {
        errorDetails = '环境变量 DANMAKU_API_BASE_URL 未配置';
      } else if (errorMessage.includes('upstream-unavailable')) {
        errorDetails = '无法连接到弹幕服务，请检查服务地址和网络连接';
      } else if (errorMessage.includes('upstream-rejected')) {
        errorDetails =
          '弹幕服务拒绝请求，请检查 token 是否正确或服务是否正常运行';
      } else if (errorMessage.includes('invalid-response')) {
        errorDetails = '弹幕服务返回格式错误，请检查服务版本是否匹配';
      } else if (errorMessage.includes('安全校验拦截')) {
        errorDetails = errorMessage;
      }
    }

    return NextResponse.json<TestResult>(
      {
        success: false,
        error: '弹幕服务测试失败',
        details: errorDetails || errorMessage,
      },
      { status: 500 },
    );
  }
}
