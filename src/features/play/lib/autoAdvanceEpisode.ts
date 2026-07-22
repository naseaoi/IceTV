interface AutoAdvanceEpisodeState {
  enabled: boolean;
  armed: boolean;
  alreadyAdvanced: boolean;
  currentEpisodeIndex: number;
  episodeCount: number;
}

export function shouldAutoAdvanceEpisode({
  enabled,
  armed,
  alreadyAdvanced,
  currentEpisodeIndex,
  episodeCount,
}: AutoAdvanceEpisodeState): boolean {
  return (
    enabled &&
    armed &&
    !alreadyAdvanced &&
    currentEpisodeIndex >= 0 &&
    currentEpisodeIndex < episodeCount - 1
  );
}
