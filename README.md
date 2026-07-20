# Bettermail

Cloudflare Worker：catch-all 收信 → KV(`BMAIL`) → `/mails` 消费（返回即删）。

## 推荐部署：粘贴 JS

1. 打开 [Releases](../../releases)，下载 **`bettermail-v*.js`**
2. Cloudflare → **Workers & Pages** → **Create** → **Create Worker**
3. 点 **Edit code**，**全选删除**默认代码，**粘贴**下载的 JS 全文
4. 右上角 **Deploy** / **Save and Deploy**
5. **Settings → Bindings → Add → KV Namespace**  
   - Variable name 必须为：`BMAIL`  
   - 选已有或 Create new
6. （可选）**Settings → Variables and Secrets** → `API_TOKEN`
7. **Email** → **Email Routing** → Catch-all → **Send to a Worker** → 该 Worker

本地同样产物：

```bash
npm i && npm run build
# 打开 dist/index.js → 全选复制 → 粘贴到 Dashboard
```

> `dist/index.js` 是标准 ESM Worker 模块（`export default { fetch, email }`），可直接粘贴，无需 npm / wrangler。

## API

仅 `GET|POST /mails`

```json
{ "code": 0, "message": "ok", "data": { "list": [], "to": null, "hasMore": false } }
```

| 参数 | 说明 |
|------|------|
| `to` / `email` | 收件箱，省略=全局 |
| `limit` | 1–100，默认 50 |

鉴权可选：未设 `API_TOKEN` 则开放；已设则 `Authorization: Bearer` / `X-API-Key` / `?token=`。

```bash
curl "https://bettermail.<sub>.workers.dev/mails?to=a@b.com" \
  -H "Authorization: Bearer $API_TOKEN"
```

OpenAPI：[`openapi.yaml`](./openapi.yaml)

## CLI 部署（可选）

```bash
npm i
npx wrangler kv namespace create BMAIL
# 填 wrangler.jsonc 里 BMAIL.id
npx wrangler secret put API_TOKEN   # 可选
npm run deploy
```

## 发版

```bash
git tag v1.0.0
git push origin v1.0.0
```

自动构建 Release，附件含可粘贴的 `bettermail-v*.js`。

## 本地

```bash
cp .dev.vars.example .dev.vars
npm run dev
```
