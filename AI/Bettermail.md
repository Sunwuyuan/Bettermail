---
title: Bettermail
language_tabs:
  - shell: Shell
  - http: HTTP
  - javascript: JavaScript
  - ruby: Ruby
  - python: Python
  - php: PHP
  - java: Java
  - go: Go
toc_footers: []
includes: []
search: true
code_clipboard: true
highlight_theme: darkula
headingLevel: 2
generator: "@tarslib/widdershins v4.0.30"

---

# Bettermail

Catch-all 邮件入库 KV，GET/POST /mails 消费（返回即删）。

Base URLs:

* <a href="https://bettermail-demo.wuyuan.dev">Bettermail 演示站: https://bettermail-demo.wuyuan.dev</a>

# Authentication

- HTTP Authentication, scheme: bearer

* API Key (ApiKeyAuth)
    - Parameter Name: **X-API-Key**, in: header. 

# Default

## GET 获取配置

GET /config

供前端探测是否需要密码（API_TOKEN 已设置）、是否允许不填邮箱拉全量（ALLOW_LIST_ALL），该接口无需鉴权。

> 返回示例

> 200 Response

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "needsAuth": true,
    "allowListAll": true
  }
}
```

### 返回结果

|状态码|状态码含义|说明|数据模型|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|none|[ConfigResponse](#schemaconfigresponse)|

<a id="opIdconsumeMailsGet"></a>

## GET 获取邮件

GET /mails

获取邮件的GET接口，邮件在请求完成后就会从服务端删除，收件地址不需要提前注册。

如果服务端配置了ALLOW_LIST_ALL为1活着true，则可以不传to，直接获取所有收件地址的邮件。

公共实例为 邮箱@190823.xyz API地址是https://bettermail-demo.wuyuan.dev，可以直接使用，但需要在项目README中注明链接到 https://x.com/wuyuandev

### 请求参数

|名称|位置|类型|必选|说明|
|---|---|---|---|---|
|to|query|string(email)| 是 |收件邮箱，省略即查看全局邮件，默认必填。配置环境变量 ALLOW_LIST_ALL 为1可解除限制|
|limit|query|integer| 否 |none|
|token|query|string| 否 |等同 Bearer（可选）|

> 返回示例

> 400 Response

```json
{
    "code": 400,
    "message": "mailbox required: pass to/email/mailbox, or set ALLOW_LIST_ALL",
    "data": null
}
```

> 200 Response

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "string",
        "receivedAt": "2019-08-24T14:15:22Z",
        "from": "string",
        "to": "string",
        "subject": "string",
        "messageId": "string",
        "date": "string",
        "text": "string",
        "html": "string",
        "headers": {},
        "attachments": [
          null
        ],
        "rawBase64": "string",
        "rawSize": 0
      }
    ],
    "to": "string",
    "hasMore": true
  }
}
```

### 返回结果

|状态码|状态码含义|说明|数据模型|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|ok|[MailsResponse](#schemamailsresponse)|
|400|[Bad Request](https://tools.ietf.org/html/rfc7231#section-6.5.1)|none|[ErrorResponse](#schemaerrorresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|unauthorized|[ErrorResponse](#schemaerrorresponse)|

<a id="opIdconsumeMailsPost"></a>

## POST 获取邮件

POST /mails

获取邮件的POST接口，邮件在请求完成后就会从服务端删除，收件地址不需要提前注册。

如果服务端配置了ALLOW_LIST_ALL为1活着true，则可以不传to，直接获取所有收件地址的邮件。

公共实例为 邮箱@190823.xyz API地址是https://bettermail-demo.wuyuan.dev，可以直接使用，但需要在项目README中注明链接到 https://x.com/wuyuandev

> Body 请求参数

```json
{
    "to": "demo@190823.xyz",
    "limit": 20
}
```

### 请求参数

|名称|位置|类型|必选|说明|
|---|---|---|---|---|
|token|query|string| 否 |等同 Bearer（可选）|
|body|body|[MailsRequest](#schemamailsrequest)| 否 |none|

> 返回示例

> 200 Response

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "string",
        "receivedAt": "2019-08-24T14:15:22Z",
        "from": "string",
        "to": "string",
        "subject": "string",
        "messageId": "string",
        "date": "string",
        "text": "string",
        "html": "string",
        "headers": {},
        "attachments": [
          null
        ],
        "rawBase64": "string",
        "rawSize": 0
      }
    ],
    "to": "string",
    "hasMore": true
  }
}
```

### 返回结果

|状态码|状态码含义|说明|数据模型|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|ok|[MailsResponse](#schemamailsresponse)|
|400|[Bad Request](https://tools.ietf.org/html/rfc7231#section-6.5.1)|none|[ErrorResponse](#schemaerrorresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|unauthorized|[ErrorResponse](#schemaerrorresponse)|

# 数据模型

<h2 id="tocS_ConfigResponse">ConfigResponse</h2>

<a id="schemaconfigresponse"></a>
<a id="schema_ConfigResponse"></a>
<a id="tocSconfigresponse"></a>
<a id="tocsconfigresponse"></a>

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "needsAuth": true,
    "allowListAll": true
  }
}

```

### 属性

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|code|integer|true|none||none|
|message|string|true|none||none|
|data|[ConfigData](#schemaconfigdata)|true|none||none|

<h2 id="tocS_ConfigData">ConfigData</h2>

<a id="schemaconfigdata"></a>
<a id="schema_ConfigData"></a>
<a id="tocSconfigdata"></a>
<a id="tocsconfigdata"></a>

```json
{
  "needsAuth": true,
  "allowListAll": true
}

```

### 属性

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|needsAuth|boolean|true|none||true 表示已设置 API_TOKEN，调用 /mails 需要鉴权|
|allowListAll|boolean|true|none||true 表示允许省略 to 拉取全部邮箱|

<h2 id="tocS_MailsRequest">MailsRequest</h2>

<a id="schemamailsrequest"></a>
<a id="schema_MailsRequest"></a>
<a id="tocSmailsrequest"></a>
<a id="tocsmailsrequest"></a>

```json
{
  "to": "user@example.com",
  "email": "user@example.com",
  "limit": 1
}

```

### 属性

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|to|string(email)|false|none||none|
|email|string(email)|false|none||to 别名|
|limit|integer|false|none||none|

<h2 id="tocS_ApiEnvelope">ApiEnvelope</h2>

<a id="schemaapienvelope"></a>
<a id="schema_ApiEnvelope"></a>
<a id="tocSapienvelope"></a>
<a id="tocsapienvelope"></a>

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "string",
        "receivedAt": "2019-08-24T14:15:22Z",
        "from": "string",
        "to": "string",
        "subject": "string",
        "messageId": "string",
        "date": "string",
        "text": "string",
        "html": "string",
        "headers": {
          "property1": "string",
          "property2": "string"
        },
        "attachments": [
          {
            "filename": null,
            "mimeType": null,
            "size": null,
            "contentId": null,
            "contentBase64": null
          }
        ],
        "rawBase64": "string",
        "rawSize": 0
      }
    ],
    "to": "string",
    "hasMore": true
  }
}

```

### 属性

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|code|integer|true|none||none|
|message|string|true|none||none|
|data|[MailsData](#schemamailsdata)|true|none||none|

<h2 id="tocS_MailsResponse">MailsResponse</h2>

<a id="schemamailsresponse"></a>
<a id="schema_MailsResponse"></a>
<a id="tocSmailsresponse"></a>
<a id="tocsmailsresponse"></a>

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "string",
        "receivedAt": "2019-08-24T14:15:22Z",
        "from": "string",
        "to": "string",
        "subject": "string",
        "messageId": "string",
        "date": "string",
        "text": "string",
        "html": "string",
        "headers": {},
        "attachments": [
          null
        ],
        "rawBase64": "string",
        "rawSize": 0
      }
    ],
    "to": "string",
    "hasMore": true
  }
}

```

### 属性

allOf

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|*anonymous*|[ApiEnvelope](#schemaapienvelope)|false|none||none|

and

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|*anonymous*|object|false|none||none|
|» data|[MailsData](#schemamailsdata)|false|none||none|

<h2 id="tocS_ErrorResponse">ErrorResponse</h2>

<a id="schemaerrorresponse"></a>
<a id="schema_ErrorResponse"></a>
<a id="tocSerrorresponse"></a>
<a id="tocserrorresponse"></a>

```json
{
  "code": 0,
  "message": "ok",
  "data": null
}

```

### 属性

allOf

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|*anonymous*|[ApiEnvelope](#schemaapienvelope)|false|none||none|

and

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|*anonymous*|object|false|none||none|
|» data|null|false|none||none|

<h2 id="tocS_MailsData">MailsData</h2>

<a id="schemamailsdata"></a>
<a id="schema_MailsData"></a>
<a id="tocSmailsdata"></a>
<a id="tocsmailsdata"></a>

```json
{
  "list": [
    {
      "id": "string",
      "receivedAt": "2019-08-24T14:15:22Z",
      "from": "string",
      "to": "string",
      "subject": "string",
      "messageId": "string",
      "date": "string",
      "text": "string",
      "html": "string",
      "headers": {
        "property1": "string",
        "property2": "string"
      },
      "attachments": [
        {
          "filename": "string",
          "mimeType": "string",
          "size": 0,
          "contentId": "string",
          "contentBase64": "string"
        }
      ],
      "rawBase64": "string",
      "rawSize": 0
    }
  ],
  "to": "string",
  "hasMore": true
}

```

### 属性

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|list|[[Email](#schemaemail)]|true|none||none|
|to|string¦null|true|none||none|
|hasMore|boolean|true|none||none|

<h2 id="tocS_Email">Email</h2>

<a id="schemaemail"></a>
<a id="schema_Email"></a>
<a id="tocSemail"></a>
<a id="tocsemail"></a>

```json
{
  "id": "string",
  "receivedAt": "2019-08-24T14:15:22Z",
  "from": "string",
  "to": "string",
  "subject": "string",
  "messageId": "string",
  "date": "string",
  "text": "string",
  "html": "string",
  "headers": {
    "property1": "string",
    "property2": "string"
  },
  "attachments": [
    {
      "filename": "string",
      "mimeType": "string",
      "size": 0,
      "contentId": "string",
      "contentBase64": "string"
    }
  ],
  "rawBase64": "string",
  "rawSize": 0
}

```

### 属性

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|id|string|false|none||none|
|receivedAt|string(date-time)|false|none||none|
|from|string|false|none||none|
|to|string|false|none||none|
|subject|string|false|none||none|
|messageId|string¦null|false|none||none|
|date|string¦null|false|none||none|
|text|string¦null|false|none||none|
|html|string¦null|false|none||none|
|headers|object|false|none||none|
|» **additionalProperties**|string|false|none||none|
|attachments|[[Attachment](#schemaattachment)]|false|none||none|
|rawBase64|string|false|none||none|
|rawSize|integer|false|none||none|

<h2 id="tocS_Attachment">Attachment</h2>

<a id="schemaattachment"></a>
<a id="schema_Attachment"></a>
<a id="tocSattachment"></a>
<a id="tocsattachment"></a>

```json
{
  "filename": "string",
  "mimeType": "string",
  "size": 0,
  "contentId": "string",
  "contentBase64": "string"
}

```

### 属性

|名称|类型|必选|约束|中文名|说明|
|---|---|---|---|---|---|
|filename|string¦null|false|none||none|
|mimeType|string|false|none||none|
|size|integer|false|none||none|
|contentId|string¦null|false|none||none|
|contentBase64|string|false|none||none|

