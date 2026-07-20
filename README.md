# Bettermail

Cloudflare Worker：catch-all 收信 → KV(`BMAIL`) → `/mails` 消费（返回即删）。

## 粘贴JS部署

1. 打开 [Releases](../../releases) 下载 `bettermail-v*.js`
2. Cloudflare → **Workers & Pages** → Create Worker → **Edit code**
3. 粘贴下载的 JS → **Save and Deploy**
4. **Settings → Bindings** → KV，变量名 **`BMAIL`**（新建或选用已有 namespace）
5. （可选）**Settings → Variables** → Secret：`API_TOKEN`
6. **Email Routing** → Catch-all → Send to a Worker → 该 Worker


## API
[Apifox 文档](https://bmail.apifox.cn/)

`GET|POST /mails`

```json
{ "code": 0, "message": "ok", "data": { "list": [], "to": null, "hasMore": false } }
```

| 参数 | 说明 |
|------|------|
| `to` / `email` | 收件箱，省略=全局 |
| `limit` | 1–100，默认 50 |

鉴权可选：未设 `API_TOKEN` 则开放；已设则 `Authorization: Bearer` / `X-API-Key` / `?token=`。

```bash
curl "https://bettermail.<sub>.workers.dev/mails?to=a@b.com&limit=20" \
  -H "Authorization: Bearer $API_TOKEN"

curl -X POST "https://bettermail.<sub>.workers.dev/mails" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_TOKEN" \
  -d '{"to":"a@b.com","limit":20}'
```

## CLI 部署

```bash
npm i
npx wrangler kv namespace create BMAIL
# 填 wrangler.jsonc 中 BMAIL 的 id
npx wrangler secret put API_TOKEN   # 可选
npm run deploy
# 或仅 dist：npm run deploy:dist
```