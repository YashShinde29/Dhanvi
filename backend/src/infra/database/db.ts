import type pg from "pg";

export type Row = Record<string, unknown>;

/**
 * Minimal parameterized query surface shared by the pool and transactions. SQL is always parameterized ($1…);
 * identifiers in the legacy EF schema are quoted PascalCase (groups."Groups"."Id").
 */
export interface Queryable {
  query<T = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  one<T = Row>(sql: string, params?: readonly unknown[]): Promise<T>;
  maybeOne<T = Row>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
}

export interface Tx extends Queryable {
  /** Runs after COMMIT succeeds (e.g. enqueue BullMQ jobs). Never runs on rollback. */
  afterCommit(fn: () => Promise<void> | void): void;
  /** Takes a transaction-scoped advisory lock, the port of pg_advisory_xact_lock(hashtextextended(key, seed)). */
  advisoryLock(key: string, seed: number): Promise<void>;
}

export type IsolationLevel = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";

function wrap(client: pg.Pool | pg.PoolClient): Queryable {
  const query = async <T>(sql: string, params: readonly unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params as unknown[])).rows as T[];
  return {
    query,
    async one<T>(sql: string, params: readonly unknown[] = []) {
      const rows = await query<T>(sql, params);
      if (rows.length !== 1) throw new Error(`Expected exactly one row, received ${rows.length}.`);
      return rows[0] as T;
    },
    async maybeOne<T>(sql: string, params: readonly unknown[] = []) {
      const rows = await query<T>(sql, params);
      if (rows.length > 1) throw new Error(`Expected at most one row, received ${rows.length}.`);
      return (rows[0] as T | undefined) ?? null;
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      return (await client.query(sql, params as unknown[])).rowCount ?? 0;
    },
  };
}

export class Database implements Queryable {
  private readonly base: Queryable;
  /** onHookError receives failures of after-commit hooks; the committed transaction is never reported as failed. */
  constructor(readonly pool: pg.Pool, private readonly onHookError: (error: unknown) => void = () => undefined) {
    this.base = wrap(pool);
  }
  query<T = Row>(sql: string, params?: readonly unknown[]) { return this.base.query<T>(sql, params); }
  one<T = Row>(sql: string, params?: readonly unknown[]) { return this.base.one<T>(sql, params); }
  maybeOne<T = Row>(sql: string, params?: readonly unknown[]) { return this.base.maybeOne<T>(sql, params); }
  execute(sql: string, params?: readonly unknown[]) { return this.base.execute(sql, params); }

  /**
   * One PostgreSQL transaction on one pooled connection. Business rules, row locks (SELECT … FOR UPDATE),
   * ledger postings and audit rows of a use case commit or roll back together — the same boundary the .NET
   * services drew with BeginTransactionAsync + UseTransactionAsync across DbContexts.
   */
  async transaction<T>(fn: (tx: Tx) => Promise<T>, isolation: IsolationLevel = "READ COMMITTED"): Promise<T> {
    const client = await this.pool.connect();
    const hooks: Array<() => Promise<void> | void> = [];
    let result: T;
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const inner = wrap(client);
      const tx: Tx = {
        ...inner,
        afterCommit: (hook) => { hooks.push(hook); },
        advisoryLock: async (key, seed) => { await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, $2))", [key, seed]); },
      };
      result = await fn(tx);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw error;
    }
    client.release();
    for (const hook of hooks) {
      try { await hook(); } catch (error) { this.onHookError(error); }
    }
    return result;
  }
}
