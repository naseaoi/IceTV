export function installWebPolyfills() {
  if (!(globalThis as { Headers?: unknown }).Headers) {
    class MinimalHeaders {
      private store: Record<string, string> = {};

      constructor(init?: HeadersInit) {
        if (!init) return;
        if (Array.isArray(init)) {
          init.forEach(([key, value]) => this.set(key, value));
          return;
        }
        if (typeof (init as Headers).entries === 'function') {
          Array.from((init as Headers).entries()).forEach(([key, value]) =>
            this.set(key, value),
          );
          return;
        }
        Object.entries(init).forEach(([key, value]) =>
          this.set(key, String(value)),
        );
      }

      set(key: string, value: string) {
        this.store[key.toLowerCase()] = String(value);
      }

      get(key: string) {
        return this.store[key.toLowerCase()] ?? null;
      }

      has(key: string) {
        return key.toLowerCase() in this.store;
      }

      entries() {
        return Object.entries(this.store)[Symbol.iterator]();
      }
    }

    (globalThis as { Headers?: unknown }).Headers = MinimalHeaders;
  }

  if (!(globalThis as { Request?: unknown }).Request) {
    (globalThis as { Request?: unknown }).Request = class {
      constructor(
        public url = '',
        public init: Record<string, unknown> = {},
      ) {}
    };
  }

  if (!(globalThis as { Response?: unknown }).Response) {
    class MinimalResponse {
      body: string;
      status: number;
      headers: Headers;

      constructor(
        body?: string,
        init?: { status?: number; headers?: HeadersInit },
      ) {
        this.body = body || '';
        this.status = init?.status ?? 200;
        this.headers = new Headers(init?.headers || {});
      }

      static json(
        data: unknown,
        init?: { status?: number; headers?: HeadersInit },
      ) {
        const headers = new Headers(init?.headers || {});
        headers.set('content-type', 'application/json');
        return new MinimalResponse(JSON.stringify(data), {
          status: init?.status,
          headers,
        });
      }

      async json() {
        return this.body ? JSON.parse(this.body) : null;
      }

      async text() {
        return this.body;
      }
    }

    (globalThis as { Response?: unknown }).Response = MinimalResponse;
  }
}
