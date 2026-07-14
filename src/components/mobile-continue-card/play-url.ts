interface MobileContinuePlayUrlParams {
  source: string;
  id: string;
  title: string;
  year?: string;
  query?: string;
}

export function buildMobileContinuePlayUrl({
  source,
  id,
  title,
  year,
  query,
}: MobileContinuePlayUrlParams): string {
  const params = new URLSearchParams({ source, id, title });
  const normalizedYear = year?.trim();
  const normalizedQuery = query?.trim();

  if (normalizedYear) {
    params.set('year', normalizedYear);
  }
  if (normalizedQuery) {
    params.set('stitle', normalizedQuery);
  }

  return `/play?${params.toString()}`;
}
