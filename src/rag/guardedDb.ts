/**
 * A SQLite connection that can be closed safely while other code still holds it (RS-1: "Erase everything" crashed
 * natively in sqlite3_finalize <- closeDatabase, because the reset closed the shared connection with reads and
 * indexing still running on it).
 *
 * Every *Async call on the wrapped connection is counted while it runs. close():
 *   1. marks the connection closing: any new call — including through a handle someone saved earlier — rejects in
 *      JS with DbClosedError and never reaches the native side;
 *   2. waits for the calls already running to finish (their own statements are finalized by then);
 *   3. closes the native connection once; later or concurrent close() calls share the same promise.
 * No native imports: the connection is passed in, so this is testable with any object of the same shape.
 */

export class DbClosedError extends Error {
  constructor(what = "database") {
    super(`${what} is closed`);
    this.name = "DbClosedError";
  }
}

export interface Closable {
  closeAsync(): Promise<void>;
}

export interface Guarded<T extends Closable> {
  /** The connection to use: same methods, counted and refused once closing. Its closeAsync() is close(). */
  db: T;
  /** Idempotent, safe while calls are in flight; resolves once the native connection is closed. */
  close(): Promise<void>;
  readonly closing: boolean;
  /** Calls running right now (for tests and diagnostics). */
  readonly inFlight: number;
}

export function guard<T extends Closable>(raw: T, what = "database"): Guarded<T> {
  let closing = false;
  let inFlight = 0;
  let closed: Promise<void> | null = null;
  let idle: (() => void) | null = null;

  const settle = () => {
    inFlight--;
    if (inFlight === 0 && idle) idle();
  };

  const close = (): Promise<void> => {
    if (closed) return closed;
    closing = true;
    closed = (async () => {
      if (inFlight > 0) await new Promise<void>((resolve) => (idle = resolve));
      await raw.closeAsync();
    })();
    return closed;
  };

  const db = new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === "closeAsync") return close;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string" || !prop.endsWith("Async")) {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (...args: unknown[]) => {
        if (closing) return Promise.reject(new DbClosedError(what));
        inFlight++;
        let result: Promise<unknown>;
        try {
          result = Promise.resolve(value.apply(target, args));
        } catch (e) {
          settle();
          return Promise.reject(e);
        }
        return result.finally(settle);
      };
    },
  }) as T;

  return {
    db,
    close,
    get closing() {
      return closing;
    },
    get inFlight() {
      return inFlight;
    },
  };
}
