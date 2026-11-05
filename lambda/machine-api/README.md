# 機械資料・操作メモ

既存 `data/machines.json` の機械IDを使う資料庫。機械マスタと既存作業ログを変更せず、
説明書・操作メモ・目盛り／調整の控えを自由文とPDF／写真で保存する。
「メモリ番号」「プリセット」等の固定スキーマは設けない。

## 画面と権限

- `/machines/index.html`：機械一覧、名称・ID検索。
- `/machines/detail.html?machine=SL350`：機械ごとの資料、本文検索、作業ログへのリンク。
- 分類は「取扱説明書」「操作メモ」「目盛り・調整の控え」。本文・写真に作業機、条件、
  実際の目盛り、確認日などを自由記入する。更新日時はサーバーで付与する。
- worker/family/adminは閲覧、family/adminのみ編集・添付。APIでも検証する。
- メーカーの指示と農園独自メモを分けて表示する。登録資料・調整値の安全性を自動保証しない。
- QR生成に「機械資料・操作メモ（機械指定）」を追加。従来の機械作業QRを置換しない。
  既存作業選択画面からも資料へ移動できるが、作業が1つのときの自動移動は維持する。

## データ

公開 `data/machines.json` は既存の `id` / `name` / `allowedPageIds` のまま。
本文、添付メタデータ、PDF、写真はすべて専用の非公開バケットに置く。

```text
machine-library/
  records/<machineId>.json
  tickets/<machineId>/<uploadId>.json
  staging/<machineId>/<uploadId>
  files/<machineId>/<uploadId>.<pdf|jpg|png>
```

レコード例（`revision` はJSON内ではなくS3 ETagをAPIで返す）：

```json
{
  "machineId": "SL350",
  "entries": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "kind": "setting",
      "title": "ホッパーの開度目盛り",
      "body": "作業機・資材の条件、確認した目盛り、確認日を記入",
      "url": "",
      "attachments": [],
      "updatedAt": "2026-11-05T10:00:00+00:00",
      "updatedBy": "Cognito sub"
    }
  ],
  "assets": {}
}
```

機械ごとにCAS条件付きで全件保存し、他の編集者の変更を上書きしない。
競合・保存結果不明時は入力を残して通知し、利用者が入力を控えてから再取得する。
1台100資料・添付50件・JSON256KiB、1資料10添付・本文10000文字。
PDF20MiB、JPEG/PNG10MiBまで。写真は圧縮・切り抜きせず保持する。
個人情報・資格情報を含む資料は登録しない。配布権限のある資料だけを保存する。

アップロードは15分の署名付きPOST→形式・サイズ・先頭シグネチャ検証→確定保存。
S3クライアントはvirtual形式を明示し、ブラウザ向けPOSTにはバケットのリージョン別
エンドポイント（東京なら `<bucket>.s3.ap-northeast-1.amazonaws.com`）を発行する。
確定ファイルは条件付き作成で上書きせず、再利用されたアップロードURLから変更できない。
ファイル検証はウイルス検査やPDF内部の無害化ではない。信頼できる資料のみ扱う。
保存済み資料の参照だけを認証後に5分の署名付きGETで開く。URLを恒久保存・ログ出力しない。
発行済みURLは有効期間中は共有可能なため、外部へ渡さない。
有効期限で開けない場合は、資料画面の添付ボタンを押し直す。

資料の削除・添付解除は参照のみ除去する。確定ファイルとチケットは非公開保管に残る。
履歴復元画面・完全削除・保管期限の自動処理は初期対象外。
本番利用前に保管期間・管理者による削除手順を決める。
機械IDは資料のキーなので変更せず、表示名称だけを変更する。機械削除後の資料は
保管されるが画面/APIからは取得不可。ID変更・削除が必要なら先に資料の扱いを決める。

## ビルド

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build_machine_api_zip.ps1
```

リポジトリ直下の **`machine-api.zip`** を新規Lambda専用に使う。
既存shift-apiビルダーのSDK（`lambda/shift-api/requirements.txt`）を再利用し、
機械APIを `lambda_function.py`、認証定数・レスポンス等の共有実装を `work_plans.py` として同梱する。
シフト・LINE・写真Lambdaを上書きしない。ZIPを公開サイトのS3へ置かない。

## AWS配置（コード作成だけでは未稼働）

### 1. S3

専用バケットを作成（例：`yamamoto-farm-machine-library`、名前は空き状況による）。
パブリックアクセスを全面ブロック、バケット所有者強制、デフォルト暗号化を有効にする。
バージョニングを推奨。PDF・写真の保管費用と旧版の保持期間も確認する。

ブラウザからアップロードするためCORSを設定：

```json
[
  {
    "AllowedOrigins": ["https://d3sscxnlo0qnhe.cloudfront.net"],
    "AllowedMethods": ["POST", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 300
  }
]
```

`machine-library/staging/` だけを対象に1日後の期限切れ削除を推奨。
`files/` / `records/` / `tickets/` に同じ削除ルールを適用しない。
チケットはファイル名等の復元に使うため、確定ファイルより先に削除しない。

### 2. Lambda

新規 **`yamamoto-farm-machine-api`**：
Python3.13、256MB、30秒、ハンドラ `lambda_function.lambda_handler`、VPCなし。
東京リージョン、専用ZIPをアップロード。

| 環境変数 | 値 |
|---|---|
| `MACHINE_BUCKET` | 新規非公開資料バケット名 |
| `MACHINES_BUCKET` | 既存公開サイトのS3バケット名（`yamamoto-farm-log`） |

基本CloudWatch Logs権限に加え、次のインラインポリシーを設定する。
`PRIVATE_BUCKET` / `PUBLIC_BUCKET` を実際のバケット名に置換する。
カスタマー管理KMSキーを使う場合は別途KMS権限も必要。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::PUBLIC_BUCKET/data/machines.json",
        "arn:aws:s3:::PRIVATE_BUCKET/machine-library/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::PRIVATE_BUCKET/machine-library/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::PRIVATE_BUCKET",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["machine-library/*"]
        }
      }
    }
  ]
}
```

ListBucketは未作成キーの404判別に必要。Lambdaから削除はしないためDeleteObjectは不要。
ログには本文・ファイル内容・署名付きURLを出力しない。API Gatewayの本文ログも有効にしない。

### 3. HTTP API

写真・LINEと同じ既存HTTP APIに追加：

| ルート | 統合先 | 認証 |
|---|---|---|
| GET `/machines` | 新しい機械Lambda | 既存Cognito JWT、必須scope `openid` |
| POST `/machines` | 同上 | 同上 |

ペイロード2.0、Lambda呼び出し権限はAPI・メソッド・ルート限定。
CORSは既存OS Origin、GET/POST、Authorization/Content-Typeを許可する。
既存の写真・シフト・LINEルートの認証と統合は変更しない。
自動デプロイがオフなら利用ステージへデプロイする。

### 4. フロント公開

以下を公開サイトS3へ配置する。`data/` は通常同期から除外されるのでページマスタは個別配置。

- `deploy/machines/` 全体 → `machines/`
- `deploy/index.html` → `index.html`
- `deploy/data/pages.json` → `data/pages.json`
- `deploy/admin/machine-qr.html` → `admin/machine-qr.html`
- `deploy/machine-work-hub.html` → `machine-work-hub.html`

本番でページマスタを編集している場合は最新を取得し、
`machine-library` / `machine-library-detail-access` の2エントリだけを統合する。
機械マスタは更新不要。ローカルの古い機械一覧で本番を上書きしない。
CloudFront無効化：
`/machines/*`、`/index.html`、`/data/pages.json`、
`/admin/machine-qr.html`、`/machine-work-hub.html`。

## 検証

```powershell
python -B -m unittest discover -s lambda\machine-api -p test_lambda_function.py
node --test tests\machines.test.cjs
```

オフラインテストと模擬ブラウザ検証は実AWSの確認とは別。配置後に以下を確認する。

1. 未認証401、workerはGETと保存済み添付取得のみ可能、編集・アップロード403。
2. 1台で文章保存、再読込、別端末で閲覧。自由な開度目盛りメモが残る。
3. PDFと写真を添付し、署名付きPOST・確定・資料保存・別ユーザーで閲覧まで成功する。
4. 期限切れ添付URLは再発行でき、未保存・別機械のファイル取得は拒否される。
5. 2画面同時編集は後から保存する側が409。入力は残り、先の保存を壊さない。
6. 同じアップロードURLを再利用しても確定ファイルが上書きされない。
7. 従来QR・作業ログ入力が維持され、資料用QRから対象機械が開く。
8. 公開サイトJSONやログに本文・添付・署名付きURLが混入していない。
