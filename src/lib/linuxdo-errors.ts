export const LINUXDO_ERROR_MESSAGES = {
  linuxdo_unavailable: 'LinuxDo 登录暂不可用',
  linuxdo_invalid_state: '登录请求无效或已过期，请重新发起',
  linuxdo_access_denied: '已取消 LinuxDo 授权',
  linuxdo_token_failed: 'LinuxDo 授权验证失败，请重试',
  linuxdo_profile_failed: '获取 LinuxDo 账号信息失败，请重试',
  linuxdo_inactive: 'LinuxDo 账号尚未激活',
  linuxdo_trust_level: 'LinuxDo 账号信任等级不足',
  linuxdo_not_bound: '当前未开放注册，请先登录已有账号并在设置中绑定 LinuxDo',
  linuxdo_identity_taken: '该 LinuxDo 账号已绑定其他账号',
  linuxdo_user_bound: '当前账号已绑定其他 LinuxDo 账号',
  linuxdo_owner_forbidden: '站长账号使用账号密码登录，不支持绑定 LinuxDo',
  linuxdo_banned: '账号已被封禁',
  linuxdo_user_missing: '账号不存在，请重新登录',
  linuxdo_session_changed: '登录状态已变化，请重新登录',
  linuxdo_auto_created: '通过 LinuxDo 创建的账号需保留登录绑定',
  linuxdo_register_failed: '创建账号失败，请稍后重试',
  linuxdo_invite_invalid: '邀请码无效或已用尽',
  linuxdo_rate_limited: '注册过于频繁，请稍后再试',
  linuxdo_request_invalid: '请求参数无效',
  linuxdo_failed: 'LinuxDo 操作失败，请稍后重试',
} as const;
export type LinuxDoErrorCode = keyof typeof LINUXDO_ERROR_MESSAGES;
export function getLinuxDoErrorMessage(code: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(LINUXDO_ERROR_MESSAGES, code)
    ? LINUXDO_ERROR_MESSAGES[code as LinuxDoErrorCode]
    : undefined;
}
