import PostalMime from "postal-mime";

const MAX_RAW_STORE_BYTES = 2 * 1024 * 1024;
const MAX_INBOUND_BYTES = 25 * 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const EMAIL_TTL_SECONDS = 7 * 24 * 60 * 60;

interface ApiResult<T = unknown> {
  code: number;
  message: string;
  data: T | null;
}

interface StoredEmail {
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

interface MailsData {
  list: StoredEmail[];
  to: string | null;
  hasMore: boolean;
}

function ok<T>(data: T, message = "ok"): Response {
  const body: ApiResult<T> = { code: 0, message, data };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function fail(code: number, message: string, httpStatus?: number): Response {
  const body: ApiResult<null> = { code, message, data: null };
  return new Response(JSON.stringify(body), {
    status: httpStatus ?? (code === 401 ? 401 : code === 404 ? 404 : 400),
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function normalizeEmail(addr: string): string {
  return addr.trim().toLowerCase();
}

function bareAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return normalizeEmail(m ? m[1]! : addr);
}

async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function authorize(request: Request, env: Env): Promise<boolean> {
  const token = env.API_TOKEN?.trim();
  if (!token) return true;

  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return timingSafeEqualString(auth.slice(7).trim(), token);
  }
  const key = request.headers.get("x-api-key");
  if (key) return timingSafeEqualString(key.trim(), token);
  const q = new URL(request.url).searchParams.get("token");
  if (q) return timingSafeEqualString(q, token);
  return false;
}

function mailKey(to: string, receivedMs: number, id: string): string {
  const ts = receivedMs.toString().padStart(15, "0");
  return `m:${normalizeEmail(to)}:${ts}:${id}`;
}

function parseLimit(raw: unknown): number {
  if (raw == null || raw === "") return DEFAULT_LIMIT;
  const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
}

async function streamToArrayBuffer(
  stream: ReadableStream,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error(`payload exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

function headersToObject(headers: Headers): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((value, key) => {
    o[key] = value;
  });
  return o;
}

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function storeEmail(
  env: Env,
  message: ForwardableEmailMessage,
): Promise<void> {
  if (message.rawSize > MAX_INBOUND_BYTES) {
    message.setReject("Message too large");
    return;
  }

  const id = crypto.randomUUID();
  const receivedMs = Date.now();
  const receivedAt = new Date(receivedMs).toISOString();
  const to = bareAddress(message.to);
  const from = bareAddress(message.from);

  let rawBuf: ArrayBuffer;
  try {
    rawBuf = await streamToArrayBuffer(message.raw, MAX_INBOUND_BYTES);
  } catch (e) {
    console.error(
      JSON.stringify({
        message: "read raw failed",
        error: e instanceof Error ? e.message : String(e),
        to,
        from,
      }),
    );
    message.setReject("Failed to read message body");
    return;
  }

  let subject = message.headers.get("subject") ?? "";
  let messageId = message.headers.get("message-id");
  let date = message.headers.get("date");
  let text: string | null = null;
  let html: string | null = null;
  const attachments: StoredEmail["attachments"] = [];

  try {
    const parsed = await PostalMime.parse(rawBuf);
    subject = parsed.subject ?? subject;
    messageId = parsed.messageId ?? messageId;
    date = parsed.date ?? date;
    text = parsed.text ?? null;
    html = parsed.html ?? null;
    if (parsed.attachments?.length) {
      for (const att of parsed.attachments) {
        const content =
          att.content instanceof ArrayBuffer
            ? new Uint8Array(att.content)
            : att.content instanceof Uint8Array
              ? att.content
              : null;
        const size = content?.byteLength ?? 0;
        const item: StoredEmail["attachments"][number] = {
          filename: att.filename ?? null,
          mimeType: att.mimeType || "application/octet-stream",
          size,
          contentId: att.contentId ?? null,
        };
        if (content && size > 0 && size <= 256 * 1024) {
          item.contentBase64 = bytesToBase64(content);
        }
        attachments.push(item);
      }
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        message: "postal-mime parse failed",
        error: e instanceof Error ? e.message : String(e),
        to,
        from,
      }),
    );
  }

  const stored: StoredEmail = {
    id,
    receivedAt,
    from,
    to,
    subject,
    messageId,
    date,
    text,
    html,
    headers: headersToObject(message.headers),
    attachments,
    rawSize: message.rawSize,
  };

  if (rawBuf.byteLength <= MAX_RAW_STORE_BYTES) {
    stored.rawBase64 = bytesToBase64(rawBuf);
  }

  await env.BMAIL.put(mailKey(to, receivedMs, id), JSON.stringify(stored), {
    expirationTtl: EMAIL_TTL_SECONDS,
    metadata: {
      to,
      from,
      subject: subject.slice(0, 200),
      receivedAt,
    },
  });
}

async function consumeMails(
  env: Env,
  to: string | null,
  limit: number,
): Promise<MailsData> {
  const prefix = to ? `m:${normalizeEmail(to)}:` : "m:";
  const listed = await env.BMAIL.list({ prefix, limit });

  if (listed.keys.length === 0) {
    return { list: [], to, hasMore: false };
  }

  const keys = listed.keys.map((k) => k.name);
  const values = await Promise.all(keys.map((k) => env.BMAIL.get(k)));

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
  await Promise.all(toDelete.map((k) => env.BMAIL.delete(k)));

  return {
    list,
    to,
    hasMore: !listed.list_complete || list.length >= limit,
  };
}

async function readParams(
  request: Request,
  url: URL,
): Promise<{ to: string | null; limit: number }> {
  let to =
    url.searchParams.get("to") ??
    url.searchParams.get("email") ??
    url.searchParams.get("mailbox");
  let limit = parseLimit(url.searchParams.get("limit"));

  if (request.method === "POST") {
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = (await request.json().catch(() => ({}))) as {
        to?: string;
        email?: string;
        mailbox?: string;
        limit?: number | string;
      };
      to = body.to ?? body.email ?? body.mailbox ?? to;
      if (body.limit != null) limit = parseLimit(body.limit);
    } else if (
      ct.includes("application/x-www-form-urlencoded") ||
      ct.includes("multipart/form-data")
    ) {
      const form = await request.formData().catch(() => null);
      if (form) {
        const fTo = form.get("to") ?? form.get("email") ?? form.get("mailbox");
        if (typeof fTo === "string") to = fTo;
        const fLimit = form.get("limit");
        if (fLimit != null) limit = parseLimit(fLimit);
      }
    }
  }

  return {
    to: to?.trim() ? normalizeEmail(to) : null,
    limit,
  };
}

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      await storeEmail(env, message);
    } catch (e) {
      console.error(
        JSON.stringify({
          message: "email handler failed",
          error: e instanceof Error ? e.message : String(e),
          from: message.from,
          to: message.to,
        }),
      );
      try {
        const id = crypto.randomUUID();
        const receivedMs = Date.now();
        const to = bareAddress(message.to);
        const fallback: StoredEmail = {
          id,
          receivedAt: new Date(receivedMs).toISOString(),
          from: bareAddress(message.from),
          to,
          subject: message.headers.get("subject") ?? "(store-failed)",
          messageId: message.headers.get("message-id"),
          date: message.headers.get("date"),
          text: null,
          html: null,
          headers: headersToObject(message.headers),
          attachments: [],
          rawSize: message.rawSize,
        };
        ctx.waitUntil(
          env.BMAIL.put(
            mailKey(to, receivedMs, id),
            JSON.stringify(fallback),
            { expirationTtl: EMAIL_TTL_SECONDS },
          ),
        );
      } catch {
        /* accept silently */
      }
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers":
            "Authorization, Content-Type, X-API-Key",
          "access-control-max-age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path !== "/mails") {
      return fail(404, "not found", 404);
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return fail(405, "method not allowed", 405);
    }

    if (!(await authorize(request, env))) {
      return fail(401, "unauthorized", 401);
    }

    try {
      const { to, limit } = await readParams(request, url);
      return ok(await consumeMails(env, to, limit));
    } catch (e) {
      console.error(
        JSON.stringify({
          message: "fetch failed",
          error: e instanceof Error ? e.message : String(e),
          path,
        }),
      );
      return fail(500, "internal error", 500);
    }
  },
} satisfies ExportedHandler<Env>;
