export interface ResourceAdmission {
  allowed: boolean;
  retryAfterMs: number;
}

export interface SharedResourceStore {
  consume(
    key: string,
    amount: number,
    limit: number,
    windowMs: number,
    now: number,
  ): Promise<ResourceAdmission>;
  acquire(
    key: string,
    token: string,
    limit: number,
    now: number,
    until: number,
  ): Promise<ResourceAdmission>;
  renew(
    key: string,
    token: string,
    now: number,
    until: number,
  ): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
  prune(now: number): Promise<void>;
}
