# Bettermail


你看雪花飘散。


快速、无状态的收信、获取内容并随即删除。

## 推荐部署：粘贴 JS

1. 打开 [Releases](../../releases)，下载 **`bettermail-v*.js`**
2. Cloudflare → **Workers & Pages** → **Create** → **Create Worker**
3. 点 **Edit code**，**全选删除**默认代码，**粘贴**下载的 JS 全文
4. 右上角 **Deploy** / **Save and Deploy**
5. **Settings → Bindings → Add → KV Namespace**
   - Variable name 必须为：`BMAIL`
   - 选已有或 Create new
6. （可选）**Settings → Variables and Secrets** → `API_TOKEN`
7. （可选）同处设置 `ALLOW_LIST_ALL=1` 才允许不传 `to` 拉取全部邮箱；默认禁止
8. **Email** → **Email Routing** → Catch-all → **Send to a Worker** → 该 Worker

## API
[文档、MCP和给AI的提示词](https://bmail.apifox.cn/)




声明：本项目仅用于个人学习使用，请于下载后24小时内删除。本项目不对包括但不限于欧盟地区；对此类项目存在任何特殊限制、许可制度、备案制度、审批制度、注册制度、报告制度、看一眼都需要备案的国家或地区；任何未来宣布"我们也禁止这个"的国家或地区；以及开发者今天不知道、明天可能知道的其他地区提供服务。本项目不对未满 18 周岁，或虽已满 18 周岁但根据所在地法律仍属于未成年人的用户提供服务。如果您无法确认自己是否已成年，请咨询当地法律、监护人，或等几年再回来。本项目思想上的开发地位于 [星空共和国](https://ssf.network/zh-CN/)，太平洋，公海。

此外，开发喵特别授权您在 issue 中抚摸（不包括:揉捏、拉拽、提起、~~淫虐~~）开发者猫耳的自由。[去摸](https://github.com/Sunwuyuan/Bettermail/issues/new?template=摸摸开发者的猫耳.md)

本项目曾在 [LINUX DO](https://linux.do/u/wuyuan/summary) 推广过。