export type UpdaterPhase =
  | 'idle'
  | 'pulling'
  | 'pulled'
  | 'up-to-date'
  | 'restarting'
  | 'verifying'
  | 'succeeded'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed';

export interface UpdaterStatus {
  capable: boolean;
  reason?: string;
  target?: {
    container: string;
    project: string;
    service: string;
    image: string;
    currentVersion: string | null;
  };
  job: {
    phase: UpdaterPhase;
    pulledVersion?: string | null;
    message?: string;
    startedAt?: number;
    updatedAt?: number;
  };
}

export type UpgradeResponse =
  | { available: false; reason?: string }
  | { available: true; status: UpdaterStatus; backupPath?: string };
