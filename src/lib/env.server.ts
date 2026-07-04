import 'server-only';

export function getOwnerUsername(): string {
  return process.env.ICETV_USERNAME || '';
}

export function getOwnerPassword(): string {
  return process.env.ICETV_PASSWORD || '';
}
