const EMAIL_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface StoredEmail {
  id: string;
  receivedAt: string;
  from: string;
  to: string;
  subject: string;
  messageId: string | null;
  date: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string>;
  attachments: Array<{
    filename: string | null;
    mimeType: string;
    size: number;
    contentId?: string | null;
    contentBase64?: string;
  }>;
  rawBase64?: string;
  rawSize: number;
}

export interface MailsData {
  list: StoredEmail[];
  to: string | null;
  hasMore: boolean;
}

export interface MailStore {
  put(mail: StoredEmail, receivedMs: number): Promise<void>;
  consume(to: string | null, limit: number): Promise<MailsData>;
}

function normalizeEmail(addr: string): string {
  return addr.trim().toLowerCase();
}

function mailKey(to: string, receivedMs: number, id: string): string {
  const ts = receivedMs.toString().padStart(15, "0");
  return `m:${normalizeEmail(to)}:${ts}:${id}`;
}

function isKv(binding: unknown): binding is KVNamespace {
  return (
    typeof binding === "object" &&
    binding !== null &&
    typeof (binding as KVNamespace).get === "function" &&
    typeof (binding as KVNamespace).put === "function" &&
    typeof (binding as KVNamespace).list === "function" &&
    typeof (binding as KVNamespace).delete === "function" &&
    typeof (binding as D1Database).prepare !== "function"
  );
}

function isD1(binding: unknown): binding is D1Database {
  return (
    typeof binding === "object" &&
    binding !== null &&
    typeof (binding as D1Database).prepare === "function" &&
    typeof (binding as D1Database).batch === "function"
  );
}

class KvMailStore implements MailStore {
  constructor(private kv: KVNamespace) {}

  async put(mail: StoredEmail, receivedMs: number): Promise<void> {
    await this.kv.put(
      mailKey(mail.to, receivedMs, mail.id),
      JSON.stringify(mail),
      {
        expirationTtl: EMAIL_TTL_SECONDS,
        metadata: {
          to: mail.to,
          from: mail.from,
          subject: mail.subject.slice(0, 200),
          receivedAt: mail.receivedAt,
        },
      },
    );
  }

  async consume(to: string | null, limit: number): Promise<MailsData> {
    const prefix = to ? `m:${normalizeEmail(to)}:` : "m:";
    const listed = await this.kv.list({ prefix, limit });

    if (listed.keys.length === 0) {
      return { list: [], to, hasMore: false };
    }

    const keys = listed.keys.map((k) => k.name);
    const values = await Promise.all(keys.map((k) => this.kv.get(k)));

    const list: StoredEmail[] = [];
    const toDelete: string[] = [];

    for (let i = 0; i < keys.length; i++) {
      const raw = values[i];
      const key = keys[i]!;
      if (!raw) {
        toDelete.push(key);
        continue;
      }
      try {
        list.push(JSON.parse(raw) as StoredEmail);
        toDelete.push(key);
      } catch {
        toDelete.push(key);
      }
    }

    list.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    await Promise.all(toDelete.map((k) => this.kv.delete(k)));

    return {
      list,
      to,
      hasMore: !listed.list_complete || list.length >= limit,
    };
  }
}

let d1SchemaReady = false;

class D1MailStore implements MailStore {
  constructor(private db: D1Database) {}

  private async ensureSchema(): Promise<void> {
    if (d1SchemaReady) return;
    await this.db.batch([
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS mails (
          id TEXT PRIMARY KEY NOT NULL,
          to_addr TEXT NOT NULL,
          received_ms INTEGER NOT NULL,
          received_at TEXT NOT NULL,
          payload TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `),
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_mails_to_received ON mails(to_addr, received_ms)`,
      ),
      this.db.prepare(
        `CREATE INDEX IF NOT EXISTS idx_mails_expires ON mails(expires_at)`,
      ),
    ]);
    d1SchemaReady = true;
  }

  async put(mail: StoredEmail, receivedMs: number): Promise<void> {
    await this.ensureSchema();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + EMAIL_TTL_SECONDS;
    await this.db
      .prepare(
        `INSERT INTO mails (id, to_addr, received_ms, received_at, payload, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           to_addr = excluded.to_addr,
           received_ms = excluded.received_ms,
           received_at = excluded.received_at,
           payload = excluded.payload,
           expires_at = excluded.expires_at`,
      )
      .bind(
        mail.id,
        normalizeEmail(mail.to),
        receivedMs,
        mail.receivedAt,
        JSON.stringify(mail),
        expiresAt,
      )
      .run();
  }

  async consume(to: string | null, limit: number): Promise<MailsData> {
    await this.ensureSchema();
    const now = Math.floor(Date.now() / 1000);

    // Lazy TTL cleanup (best-effort, ignore failures)
    void this.db
      .prepare(`DELETE FROM mails WHERE expires_at <= ?`)
      .bind(now)
      .run()
      .catch(() => {});

    const stmt = to
      ? this.db
          .prepare(
            `SELECT id, payload FROM mails
             WHERE to_addr = ? AND expires_at > ?
             ORDER BY received_ms ASC
             LIMIT ?`,
          )
          .bind(normalizeEmail(to), now, limit)
      : this.db
          .prepare(
            `SELECT id, payload FROM mails
             WHERE expires_at > ?
             ORDER BY received_ms ASC
             LIMIT ?`,
          )
          .bind(now, limit);

    const rows = await stmt.all<{ id: string; payload: string }>();
    const results = rows.results ?? [];

    if (results.length === 0) {
      return { list: [], to, hasMore: false };
    }

    const list: StoredEmail[] = [];
    const ids: string[] = [];

    for (const row of results) {
      ids.push(row.id);
      try {
        list.push(JSON.parse(row.payload) as StoredEmail);
      } catch {
        /* drop corrupt rows */
      }
    }

    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");
      await this.db
        .prepare(`DELETE FROM mails WHERE id IN (${placeholders})`)
        .bind(...ids)
        .run();
    }

    list.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

    return {
      list,
      to,
      hasMore: results.length >= limit,
    };
  }
}

/**
 * Resolve storage from bindings.
 * Priority: D1 (`DB`) > KV (`BMAIL`). At least one must be bound.
 */
export function resolveStore(env: {
  DB?: D1Database;
  BMAIL?: KVNamespace;
}): MailStore {
  if (env.DB && isD1(env.DB)) return new D1MailStore(env.DB);
  if (env.BMAIL && isKv(env.BMAIL)) return new KvMailStore(env.BMAIL);

  // Some dashboards may reuse BMAIL name for D1 by mistake — accept if it looks like D1
  if (env.BMAIL && isD1(env.BMAIL as unknown)) {
    return new D1MailStore(env.BMAIL as unknown as D1Database);
  }

  throw new Error(
    "No storage binding: bind DB (D1, preferred) or BMAIL (KV)",
  );
}

export function storageBackend(env: {
  DB?: D1Database;
  BMAIL?: KVNamespace;
}): "d1" | "kv" | "none" {
  if (env.DB && isD1(env.DB)) return "d1";
  if (env.BMAIL && isKv(env.BMAIL)) return "kv";
  if (env.BMAIL && isD1(env.BMAIL as unknown)) return "d1";
  return "none";
}
