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

function allowListAll(env: Env): boolean {
  const v = env.ALLOW_LIST_ALL?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
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

function needsAuth(env: Env): boolean {
  return Boolean(env.API_TOKEN?.trim());
}

function htmlPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bettermail</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400&family=Inter:wght@400;500;580&display=swap" rel="stylesheet">
<style>
:root{
  --bone:#f8f8f6;--paper:#ffffff;--stone:#efeeeb;
  --ink:#121212;--graphite:#373734;--ashen:#7b7974;--pebble:#9c9a92;
  --mist:#b7b7b5;--chalk:#e7e6e1;--obsidian:#000000;--clay:#d97757;
  --serif:"Source Serif 4",ui-serif,Georgia,Cambria,"Times New Roman",Times,serif;
  --sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --r:8px;--rc:16px;--re:24px;
  --shadow:rgba(0,0,0,.04) 0 4px 20px 0;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100%}
body{
  font-family:var(--sans);font-size:14px;line-height:1.5;font-weight:400;
  color:var(--ink);background:var(--bone);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
  display:flex;flex-direction:column;
}
.page{flex:1;width:100%;max-width:720px;margin:0 auto;padding:64px 24px 48px}
.brand{
  display:flex;align-items:center;gap:10px;margin-bottom:40px;
}
.brand .dot{
  width:8px;height:8px;border-radius:50%;background:var(--clay);flex:0 0 auto;
}
.brand h1{
  font-family:var(--serif);font-size:30px;font-weight:400;line-height:1.2;
  color:var(--ink);letter-spacing:normal;
}
.panel{
  background:var(--paper);border:1px solid var(--chalk);
  border-radius:var(--re);padding:32px;
  box-shadow:none;
}
.bar{display:flex;gap:12px;align-items:stretch}
.bar input{
  flex:1 1 auto;min-width:0;
  font:400 15px/1.4 var(--sans);color:var(--ink);
  background:var(--paper);border:1px solid var(--mist);
  border-radius:var(--r);padding:12px 16px;outline:none;
  transition:border-color .2s ease,box-shadow .2s ease;
}
.bar input::placeholder{color:var(--pebble)}
.bar input:focus{
  border-color:var(--graphite);
  box-shadow:0 0 0 1px var(--paper),0 0 0 3px rgba(18,18,18,.08);
}
.bar .auth{display:none;flex:0 1 148px}
.bar .auth.show{display:block}
.bar .btn-load{
  flex:0 0 auto;
  font:500 15px/1 var(--sans);color:var(--bone);
  background:var(--ink);border:none;border-radius:var(--r);
  padding:12px 22px;cursor:pointer;transition:opacity .2s ease;
}
.bar .btn-load:hover{opacity:.88}
.bar .btn-load:disabled{opacity:.4;cursor:not-allowed}
.hint{
  display:none;margin-top:14px;
  font-size:14px;line-height:1.5;color:var(--ashen);font-weight:400;
}
.hint.show{display:block}
.toolbar{
  display:flex;align-items:center;justify-content:space-between;
  gap:12px;margin:24px 0 16px;min-height:20px;
}
.status{font-size:12px;line-height:1.5;color:var(--ashen)}
.status.err{color:var(--clay)}
.btn-ghost{
  font:500 12px/1 var(--sans);color:var(--graphite);
  background:transparent;border:none;border-radius:var(--r);
  padding:6px 10px;cursor:pointer;
  transition:color .2s ease,background .2s ease;
}
.btn-ghost:hover{color:var(--ink);background:var(--stone)}
.btn-ghost:disabled{opacity:.35;cursor:not-allowed}
.list{display:flex;flex-direction:column;gap:12px}
.card{
  background:var(--paper);border:1px solid var(--chalk);
  border-radius:var(--re);padding:28px 32px;
  transition:box-shadow .2s ease;
}
.card:hover{box-shadow:var(--shadow)}
.card-head{
  display:flex;align-items:flex-start;gap:12px;margin-bottom:10px;
}
.card-meta{flex:1;min-width:0}
.card .from{
  font-weight:500;font-size:14px;color:var(--graphite);
  word-break:break-all;
}
.card .to{
  display:block;margin-top:2px;
  font-size:12px;color:var(--ashen);word-break:break-all;
}
.card .time{
  display:block;margin-top:4px;
  font-size:11px;line-height:1.5;color:var(--pebble);
}
.card .btn-del{
  flex:0 0 auto;
  font:500 12px/1 var(--sans);color:var(--ashen);
  background:transparent;border:none;border-radius:var(--r);
  padding:6px 8px;cursor:pointer;
  transition:color .2s ease,background .2s ease;
}
.card .btn-del:hover{color:var(--ink);background:var(--stone)}
.card .subject{
  font-family:var(--serif);font-size:24px;font-weight:400;
  line-height:1.33;color:var(--ink);margin-bottom:12px;
  word-break:break-word;
}
.card .body{
  font-size:14px;line-height:1.55;color:var(--graphite);
  white-space:pre-wrap;word-break:break-word;
  max-height:280px;overflow:auto;
}
.card .atts{margin-top:16px;display:flex;flex-wrap:wrap;gap:8px}
.card .att{
  font-size:11px;font-weight:500;line-height:1.5;color:var(--graphite);
  background:var(--stone);border-radius:var(--r);padding:4px 10px;
}
.empty{
  text-align:center;padding:80px 16px;
  font-size:14px;color:var(--pebble);
}
.site-foot{
  width:100%;background:var(--obsidian);
  margin-top:auto;padding:40px 24px;
}
.site-foot-inner{
  max-width:720px;margin:0 auto;
  display:flex;flex-wrap:wrap;gap:12px 28px;
  align-items:center;justify-content:center;
}
.site-foot a{
  font:400 14px/1.5 var(--sans);color:var(--pebble);
  text-decoration:none;transition:color .2s ease;
}
.site-foot a:hover{color:#e7e6e1}
@media(max-width:560px){
  .page{padding:40px 16px 40px}
  .brand{margin-bottom:28px}
  .brand h1{font-size:24px}
  .panel{padding:20px;border-radius:var(--rc)}
  .bar{flex-direction:column}
  .bar .auth{flex:1 1 auto}
  .bar .btn-load{width:100%}
  .card{padding:20px;border-radius:var(--rc)}
  .card .subject{font-size:20px}
  .site-foot{padding:32px 16px}
  .site-foot-inner{flex-direction:column;gap:16px}
}
</style>
</head>
<body>
<main class="page">
  <div class="brand">
    <span class="dot" aria-hidden="true"></span>
    <h1>Bettermail</h1>
  </div>
  <section class="panel">
    <form class="bar" id="form" autocomplete="off">
      <input type="email" id="email" name="email" placeholder="邮箱地址" spellcheck="false" inputmode="email">
      <input type="password" class="auth" id="token" name="token" placeholder="密码" spellcheck="false" autocomplete="off">
      <button type="submit" class="btn-load" id="load">加载</button>
    </form>
    <p class="hint" id="hint"></p>
  </section>
  <div class="toolbar">
    <div class="status" id="status"></div>
    <button type="button" class="btn-ghost" id="clearAll" hidden>清空全部</button>
  </div>
  <div class="list" id="list"></div>
</main>
<footer class="site-foot">
  <div class="site-foot-inner">
    <a href="https://github.com/Sunwuyuan/Bettermail" target="_blank" rel="noopener noreferrer">GitHub</a>
    <a href="https://x.com/wuyuandev" target="_blank" rel="noopener noreferrer">X</a>
    <a href="https://wuyuan.dev" target="_blank" rel="noopener noreferrer">wuyuan.dev</a>
  </div>
</footer>
<script>
(function(){
  var API = location.origin;
  var STORE_KEY = "bettermail.cache.v1";
  var TOKEN_KEY = "bettermail.token";
  var form = document.getElementById("form");
  var emailEl = document.getElementById("email");
  var tokenEl = document.getElementById("token");
  var loadBtn = document.getElementById("load");
  var statusEl = document.getElementById("status");
  var listEl = document.getElementById("list");
  var hintEl = document.getElementById("hint");
  var clearAllBtn = document.getElementById("clearAll");
  var cfg = { needsAuth: false, allowListAll: false };

  function setStatus(msg, isErr){
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (isErr ? " err" : "");
  }
  function readCache(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(!raw) return [];
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    }catch(e){ return []; }
  }
  function writeCache(items){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(items)); }catch(e){}
  }
  function fmtTime(iso){
    if(!iso) return "";
    try{
      var d = new Date(iso);
      if(isNaN(d.getTime())) return String(iso);
      return d.toLocaleString();
    }catch(e){ return String(iso); }
  }
  function bodyOf(m){
    if(m && m.text) return String(m.text);
    if(m && m.html){
      var t = String(m.html)
        .replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
        .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\\s+/g, " ")
        .trim();
      return t;
    }
    return "";
  }
  function removeOne(id){
    var next = readCache().filter(function(m){ return m && m.id !== id; });
    writeCache(next);
    render(next);
  }
  function clearAll(){
    writeCache([]);
    render([]);
    setStatus("");
  }
  function render(items){
    listEl.textContent = "";
    clearAllBtn.hidden = !items.length;
    if(!items.length){
      var emp = document.createElement("div");
      emp.className = "empty";
      emp.textContent = "—";
      listEl.appendChild(emp);
      return;
    }
    for(var i = 0; i < items.length; i++){
      var m = items[i] || {};
      var card = document.createElement("article");
      card.className = "card";

      var head = document.createElement("div");
      head.className = "card-head";

      var meta = document.createElement("div");
      meta.className = "card-meta";
      var from = document.createElement("div");
      from.className = "from";
      from.textContent = m.from || "";
      meta.appendChild(from);
      if(m.to){
        var to = document.createElement("span");
        to.className = "to";
        to.textContent = m.to;
        meta.appendChild(to);
      }
      var time = document.createElement("span");
      time.className = "time";
      time.textContent = fmtTime(m.receivedAt || m.date);
      meta.appendChild(time);
      head.appendChild(meta);

      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn-del";
      del.textContent = "删除";
      del.setAttribute("data-id", m.id || "");
      del.addEventListener("click", function(ev){
        var id = ev.currentTarget.getAttribute("data-id");
        if(id) removeOne(id);
      });
      head.appendChild(del);
      card.appendChild(head);

      var sub = document.createElement("div");
      sub.className = "subject";
      sub.textContent = m.subject || "（无主题）";
      card.appendChild(sub);

      var body = bodyOf(m);
      if(body){
        var bd = document.createElement("div");
        bd.className = "body";
        bd.textContent = body;
        card.appendChild(bd);
      }

      var atts = m.attachments;
      if(atts && atts.length){
        var row = document.createElement("div");
        row.className = "atts";
        for(var j = 0; j < atts.length; j++){
          var a = atts[j] || {};
          var chip = document.createElement("span");
          chip.className = "att";
          var name = a.filename || "file";
          var sz = typeof a.size === "number" ? " · " + a.size + "B" : "";
          chip.textContent = name + sz;
          row.appendChild(chip);
        }
        card.appendChild(row);
      }
      listEl.appendChild(card);
    }
  }
  function mergeTop(existing, incoming){
    var seen = Object.create(null);
    var out = [];
    for(var i = 0; i < incoming.length; i++){
      var m = incoming[i];
      if(!m || !m.id || seen[m.id]) continue;
      seen[m.id] = 1;
      out.push(m);
    }
    for(var k = 0; k < existing.length; k++){
      var e = existing[k];
      if(!e || !e.id || seen[e.id]) continue;
      seen[e.id] = 1;
      out.push(e);
    }
    return out;
  }
  function updateHints(){
    if(cfg.needsAuth){
      tokenEl.classList.add("show");
      try{
        var t = localStorage.getItem(TOKEN_KEY);
        if(t) tokenEl.value = t;
      }catch(e){}
    }else{
      tokenEl.classList.remove("show");
      tokenEl.value = "";
    }
    if(!cfg.allowListAll){
      hintEl.textContent = "需要填写邮箱地址。";
      hintEl.classList.add("show");
    }else{
      hintEl.textContent = "";
      hintEl.classList.remove("show");
    }
  }
  async function loadConfig(){
    try{
      var r = await fetch(API + "/config", { cache: "no-store" });
      var j = await r.json();
      if(j && j.code === 0 && j.data){
        cfg.needsAuth = !!j.data.needsAuth;
        cfg.allowListAll = !!j.data.allowListAll;
      }
    }catch(e){}
    updateHints();
  }
  async function loadMails(ev){
    if(ev) ev.preventDefault();
    var to = (emailEl.value || "").trim();
    if(!to && !cfg.allowListAll){
      hintEl.textContent = "需要填写邮箱地址。";
      hintEl.classList.add("show");
      setStatus("需要填写邮箱地址。", true);
      return;
    }
    var token = (tokenEl.value || "").trim();
    if(cfg.needsAuth && !token){
      setStatus("需要填写密码。", true);
      return;
    }
    loadBtn.disabled = true;
    setStatus("…");
    try{
      var headers = { "accept": "application/json" };
      if(token){
        headers["authorization"] = "Bearer " + token;
        try{ localStorage.setItem(TOKEN_KEY, token); }catch(e){}
      }
      var q = new URLSearchParams();
      if(to) q.set("to", to);
      var r = await fetch(API + "/mails?" + q.toString(), {
        method: "GET",
        headers: headers,
        cache: "no-store"
      });
      var j = await r.json();
      if(!j || j.code !== 0){
        setStatus((j && j.message) || ("错误 " + r.status), true);
        return;
      }
      var list = (j.data && j.data.list) || [];
      var next = mergeTop(readCache(), list.slice().reverse());
      writeCache(next);
      render(next);
      setStatus(list.length ? ("+" + list.length) : "0");
    }catch(e){
      setStatus("加载失败。", true);
    }finally{
      loadBtn.disabled = false;
    }
  }

  form.addEventListener("submit", loadMails);
  clearAllBtn.addEventListener("click", clearAll);
  render(readCache());
  loadConfig();
})();
</script>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'self'",
    },
  });
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

    if (path === "/" && request.method === "GET") {
      return htmlPage();
    }

    if (path === "/config" && request.method === "GET") {
      return ok({
        needsAuth: needsAuth(env),
        allowListAll: allowListAll(env),
      });
    }

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
      if (!to && !allowListAll(env)) {
        return fail(
          400,
          "mailbox required: pass to/email/mailbox, or set ALLOW_LIST_ALL",
        );
      }
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
