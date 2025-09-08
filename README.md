# postman-codex-tool

小型 CLI：透過 Postman API 取得/更新 Collection，並支援以 AI 操作檔（ops.json）批次新增/修改請求，並在名稱末端自動加註「[AI]」。

> 重要：開始任何操作（update、ai、patch 等）之前，請先執行 `get` 取得 Postman 上的最新 Collection。
>
> 這能確保本地資料與遠端同步，避免覆蓋或衝突。
>
> 範例：
> ```bash
> node postman.js get --env ./postman.env.json --collectionUid <uid> --out ./.tmp/collection.json
> ```

## 環境需求
- Node.js 18+（建議）
- 可存取網路（呼叫 Postman API）
- 有效的 Postman API Key

## 安裝/準備
- 本工具無外部依賴，僅需 Node.js。將此資料夾放置任意位置即可使用。
- 建議建立/複製 `postman.env.json`（可參考 `postman.env.json.example`）：
  ```json
  {
    "id": "local-ci-env",
    "name": "CI Postman Env",
    "values": [
      { "key": "postmanApiKey", "value": "<YOUR_KEY>", "type": "secret", "enabled": true },
      { "key": "workspaceId",  "value": "<YOUR_WORKSPACE_ID>", "type": "text", "enabled": true },
      { "key": "collectionUid", "value": "<YOUR_COLLECTION_UID>", "type": "text", "enabled": true },
      { "key": "aiOutputFile", "value": "./.tmp/ai_output.json", "type": "text", "enabled": true },
      { "key": "aiOutputIsPatch", "value": "false", "type": "text", "enabled": true }
    ],
    "_postman_variable_scope": "environment",
    "_postman_exported_using": "local-ci"
  }
  ```

### 取得 Postman API Key
- 登入 Postman 網站或桌面版 → 右上角頭像 → Settings → API keys → Generate API Key。
- 將產生的 Key 填入 `postman.env.json` 的 `postmanApiKey`。

### 取得 workspaceId 與 collectionUid（Postman API）
- 基底：`https://api.getpostman.com`
- 取得 workspaces：
  ```bash
  curl --request GET \
    --url 'https://api.getpostman.com/workspaces' \
    --header 'X-Api-Key: <POSTMAN_API_KEY>'
  ```
  回傳的 `workspaces[].id` 即 `workspaceId`。
- 取得 collections：
  ```bash
  curl --request GET \
    --url 'https://api.getpostman.com/collections' \
    --header 'X-Api-Key: <POSTMAN_API_KEY>'
  ```
  或（若環境支援 workspace 篩選）：
  ```bash
  curl --request GET \
    --url 'https://api.getpostman.com/collections?workspace=<WORKSPACE_ID>' \
    --header 'X-Api-Key: <POSTMAN_API_KEY>'
  ```
  回傳的 `collections[].uid` 即 `collectionUid`。

## 使用方式

### 下載集合
```bash
node postman.js get --env ./postman.env.json --collectionUid <uid> --out ./.tmp/collection.json
```

### 以完整 JSON 回推集合
```bash
node postman.js update --env ./postman.env.json --input ./.tmp/collection.json --patch false
```

### 以 JSON Patch 更新集合
```bash
node postman.js update --env ./postman.env.json --input ./patch.json --patch true
```

### 以 AI 操作檔新增/修改集合
- 會先移除整個 Collection 內既有的「[AI]」尾綴，再對本次新增/異動的資料夾與請求於名稱末端加上「[AI]」。
- 名稱比對會自動忽略尾綴「[AI]」，避免重複或找不到目標。

```bash
node postman.js ai --env ./postman.env.json --ops ./postman.ops.patch.new.json
```

AI 操作檔（ops.json）格式示例（postman.ops.patch.new.json）：
```json
{
  "base": ["example"],
  "operations": [
    { "kind": "folder", "path": ["範例區", "子資料夾（範例）"] },
    {
      "kind": "request",
      "path": ["範例區", "子資料夾（範例）"],
      "name": "範例 GET 請求",
      "method": "GET",
      "url": {
        "raw": "{{url}}/example/:id/resource?foo=bar",
        "host": ["{{url}}"],
        "path": ["example", ":id", "resource"],
        "query": [{ "key": "foo", "value": "bar" }],
        "variable": [{ "key": "id", "value": "123" }]
      },
      "description": "說明: 這是一個示範 GET 請求，可依實際 API 替換路徑與參數。"
    },
    {
      "kind": "request",
      "path": ["範例區", "子資料夾（範例）"],
      "name": "範例 POST 請求",
      "method": "POST",
      "url": {
        "raw": "{{url}}/example/create",
        "host": ["{{url}}"],
        "path": ["example", "create"]
      },
      "body": { "mode": "raw", "raw": "{\n  \"name\": \"demo\"\n}", "options": { "raw": { "language": "json" } } },
      "description": "說明: 這是一個示範 POST 請求，包含 JSON body。"
    }
  ]
}
```

## 常見問題
- 權限錯誤：請確認 `postmanApiKey` 正確且擁有該 collection 的存取權。
- 網路逾時：請稍後重試或確認 CI/環境網路設定。
