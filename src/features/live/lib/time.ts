export function parseCustomTimeFormat(timeStr: string): Date {
  if (timeStr.includes('T') || timeStr.includes('-')) {
    return new Date(timeStr);
  }

  const match = timeStr.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})$/,
  );

  if (match) {
    const [, year, month, day, hour, minute, second, timezone] = match;

    const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${timezone}`;
    return new Date(isoString);
  }

  return new Date(timeStr);
}

export function formatTimeToHHMM(timeString: string): string {
  try {
    const date = parseCustomTimeFormat(timeString);
    if (isNaN(date.getTime())) {
      return timeString;
    }
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return timeString;
  }
}
