const VIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_VIEW_ENTRIES = 10_000;

export class ListViewCounter {
  private readonly entries = new Map<string, { expiresAt: number }>();

  constructor(
    private readonly windowMs = VIEW_WINDOW_MS,
    private readonly capacity = MAX_VIEW_ENTRIES,
  ) {}

  async record(
    id: string,
    visitor: string,
    write: () => Promise<void>,
  ): Promise<boolean> {
    const key = JSON.stringify([id, visitor]);
    const now = Date.now();
    const previous = this.entries.get(key);
    if (previous && previous.expiresAt > now) return false;
    this.entries.delete(key);
    while (this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const entry = { expiresAt: now + this.windowMs };
    // 在写入前占位，合并同一进程内并发到达的访问。
    this.entries.set(key, entry);
    try {
      await write();
      return true;
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }
}

export const listViewCounter = new ListViewCounter();
