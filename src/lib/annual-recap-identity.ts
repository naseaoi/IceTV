export function followRecapMessageId(
  profileId: string,
  year: number,
  at: number,
): string {
  return `follow-recap:${profileId}:${year}:${at}`;
}

export function parseFollowRecapMessageId(
  id: string,
): [string, number, number] | null {
  const match = /^follow-recap:([A-Za-z0-9]{12}):(\d{4}):(\d+)$/.exec(id);
  if (!match || !Number.isSafeInteger(Number(match[3]))) return null;
  return [match[1], Number(match[2]), Number(match[3])];
}

export function followRecapSortKey(id: string): string {
  const value = parseFollowRecapMessageId(id);
  return value ? `follow-recap:${value[0]}:${value[1]}` : id;
}

export function parseFollowRecapSortKey(key: string): [string, number] | null {
  const match = /^follow-recap:([A-Za-z0-9]{12}):(\d{4})$/.exec(key);
  return match ? [match[1], Number(match[2])] : null;
}
