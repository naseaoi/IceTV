export interface CompletionSummary {
  title: string;
  year: string;
  cover: string;
  episodes: number;
  totalWatchSeconds: number;
  firstWatchedAt: number | null;
  completedAt: number;
  celebrated: boolean;
}
