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

> 提醒（暫存與 Patch 位置）：請將 Codex/AI 產生、或更新時使用的 patch/ops/匯出檔，統一放在 `./.tmp/` 目錄下；該目錄已在 `.gitignore` 中忽略，避免污染版本控制。CLI 會自動建立目錄（亦可手動：`mkdir -p ./.tmp`）。

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

### 建議流程（避免衝突與歧義）
1) 先用 `get` 同步遠端：輸出到 `./.tmp/collection.json`。
2) 於 `./.tmp/` 中準備你的檔案：
   - 若要完整覆寫，編輯 `collection.json` 後用 `update --patch false`。
   - 若要套用 JSON Patch，建立 `patch.json`（RFC6902）後用 `update --patch true`。
   - 若要用 AI 操作檔，建立 `ai_ops.patch.json` 後用 `ai --ops`。
3) 再執行 `update` 或 `ai`，確保來源都來自 `./.tmp/`。

### 下載集合
```bash
node postman.js get --env ./postman.env.json --collectionUid <uid> --out ./.tmp/collection.json
```
未提供 `--out` 時，結果會輸出到標準輸出（stdout）。

### 以完整 JSON 回推集合
```bash
node postman.js update --env ./postman.env.json --input ./.tmp/collection.json --patch false
```

### 以 JSON Patch 更新集合（RFC6902）
```bash
node postman.js update --env ./postman.env.json --input ./.tmp/patch.json --patch true
```
說明：`patch.json` 應為 JSON Patch 陣列（RFC6902），例如：
`[{ "op": "replace", "path": "/item/0/name", "value": "New Name" }]`。

### 以 AI 操作檔新增/修改集合
- 會先移除整個 Collection 內既有的「[AI]」尾綴，再對本次新增/異動的資料夾與請求於名稱末端加上「[AI]」。
- 名稱比對會自動忽略尾綴「[AI]」，避免重複或找不到目標。

```bash
# 建議：將 ops 檔置於 ./.tmp/
node postman.js ai --env ./postman.env.json --ops ./.tmp/ai_ops.patch.json
# 範例檔（僅示意）位於倉庫根目錄：./postman.ops.patch.new.json
```

### 參數與來源優先權
- `--env`：指定環境檔路徑（預設 `./postman.env.json`）。
- `postmanApiKey` 與 `collectionUid` 讀取順序：命令列參數 > 環境變數（僅 API Key：`POSTMAN_API_KEY`）> 環境檔。
- `update` 預設輸入：若未提供 `--input`，會讀取環境檔的 `aiOutputFile`；是否為 Patch 依 `--patch` 或 `aiOutputIsPatch` 判定。

註：`workspaceId` 僅用於你自行呼叫 Postman API 列表時的過濾（curl 範例），CLI 本身不需要它。

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
