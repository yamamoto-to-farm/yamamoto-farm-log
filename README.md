# Yamamoto Farm Log（山本農園ログ）

農園ログの静的Webアプリと、GDD予測（実験的）のLambdaパッケージを含むプロジェクトです。

## 共有ログインのポリシー

`deploy/data/auth-config.json` が共有ローカルセッションのポリシーを制御します。
`sensitivePathPrefixes: []` を明示的に空にすると、パス別の再認証は無効になり、
管理ページも他のページと同じセッション有効期限（8時間）・アイドルタイムアウト
（60分）を使います。ロールとページアクセスのチェックは引き続き有効です。
パス設定が欠落・不正な場合は既定の `/admin/` が維持されます。
認証設定エディタは、空のパス欄を `[]` として保存します。

`deploy/data/auth-config.json` を S3 の `data/auth-config.json` にアップロードする前に、
更新した共有UIと設定エディタをデプロイしてください（サイト同期は `data/` を除外します）。
CloudFront で `/data/auth-config.json` を無効化（invalidate）し、開いているページを
再読み込みして、メモリ上の設定を更新します。
テスト: `node --test tests\auth-policy.test.cjs`

## 圃場写真（非公開）

`/photos/index.html` は、PKCE（S256）を使う Cognito 認可コードログインを別途使用します。
既存の農園ログのログインは変更ありません。専用プールに管理者が登録したユーザーは、
全圃場写真の閲覧・追加ができます。セルフサインアップは無効のまま維持してください。
ブラウザのローカルロールは写真APIでは受け付けません。
ページはトップメニューからリンクされています。圃場詳細からのリンクは配置を再検討中のため
一時的に外していますが、写真ページ自体は利用できます。

### AWSの設定とデプロイ

- リージョン: `ap-northeast-1`
- 非公開バケット: `yamamoto-farm-private-photos`。S3 Block Public Access は4つとも有効、
  ACL無効、公開バケットポリシーなしを維持します。このバケットを公開サイトの
  CloudFront ディストリビューションに追加しないでください。
- Lambda: `yamamoto-farm-photos-api`、Python 3.13、ハンドラ
  `lambda_function.lambda_handler`。`lambda/photos/lambda_function.py` の内容を
  コンソールの `lambda_function.py` にデプロイするか、このファイル1つを
  アーカイブ直下に入れて zip 化します。ランタイム提供の boto3 を使うため、
  追加パッケージは不要です。
- 環境変数: `PHOTO_BUCKET=yamamoto-farm-private-photos`、
  `PHOTO_PREFIX=photos/`
- 実行ロール: 非公開バケットへの `s3:ListBucket`（`photos/` と `photos/*` に限定）、
  `arn:aws:s3:::yamamoto-farm-private-photos/photos/*` への `s3:GetObject`・
  `s3:PutObject`・`s3:DeleteObject`。基本の CloudWatch Logs ポリシーは維持。
  公開バケットへの権限は不要です。
- HTTP API の Lambda プロキシ統合: ペイロード形式 **2.0**。以下の全ルートに
  JWT オーソライザー `farm-photos-cognito` と必須スコープ **openid** を付けます:

  | メソッド | パス | 用途 |
  | --- | --- | --- |
  | GET | `/photos` | 圃場のアップロード完了済み写真を一覧（20件/ページ） |
  | GET | `/photos/search` | 期間と圃場（任意）で検索（24件/ページ） |
  | POST | `/photos/uploads` | 5分有効・サイズ制限付きの S3 POST を発行 |
  | POST | `/photos/complete` | アップロードを検証しメタデータを公開 |
  | POST | `/photos/edit` | メモと撮影日の編集（admin/family のみ） |

- 写真検索は `from`・`to`（YYYY-MM-DD）が必須です。任意の `fields` は圃場名の
  JSONエンコード配列で、省略または空なら全圃場が対象です。従来の単一 `field`
  パラメータも引き続き使えます。返された `cursor` は同じ検索条件で辿ってください。
  ギャラリーのURLは複数選択の復元に `field` パラメータの繰り返しを使います。
  ギャラリーのフィルタはエリア一括選択に対応しますが、写真のアップロード先は
  1圃場のみ選択します。複数圃場ギャラリーのフロントエンドを公開する前に
  Lambda を再デプロイしてください。

- 写真編集は `field`・`id`・`takenOn`（YYYY-MM-DD）・`note`（1000文字まで）を
  受け付けます。編集できるのは検証済みの Cognito `admin`/`family` グループのみで、
  自分がアップロードした写真でも同様です。ギャラリーはローカルのロール判定ではなく
  APIの `canEdit` を使います。日付変更は両方の日付インデックスを更新して旧エントリを
  削除します。圃場・画像・ID・アップロード者は変わりません。既存のトップ写真の
  選択は同じ写真を指し続けます。
- S3検索の高速化（新しいAWSサービスは不要）:
  1. 新しい Lambda をデプロイし、最初は `PHOTO_SEARCH_INDEX_VERSION` を未設定のままに
     します。アップロード完了・編集・削除が
     `photos/by-field-date/<圃場名のSHA-256>/<takenOn>/<id>.json` を維持します。
  2. アップロード・編集・削除を止めた状態で、Lambda を（API Gateway 経由ではなく）
     直接 `{"action":"backfill"}` で起動します。`{"indexed": N}` の成功応答を待ちます。
     これは現行レコードの旧 by-date エントリも修復します。移行が中断しても再実行できます。
  3. 既存のバケット/プレフィックスの環境変数は維持したまま、環境変数
     `PHOTO_SEARCH_INDEX_VERSION=2` を追加します。バックフィル成功後にのみ有効化します。
  4. 既存の統合と必須 `openid` スコープで JWT 保護の `POST /photos/edit` を追加し、
     その後フロントエンドを公開します。
  インデックス検索は日付/圃場キーを列挙して新しい順にマージし、要求されたページ分
  （最大24オブジェクト）のメタデータだけを読みます。署名URLや変化しうる結果を
  Lambda メモリにキャッシュしません。正確な合計件数は依然として該当キーの全列挙が
  必要で、圃場ごと（またはグローバル日付インデックス）で10万キーを超える走査は、
  期間を絞るよう明示的に求めて拒否します。これは定数時間のデータベース検索では
  ありません。
  テスト: `python -B -m unittest discover -s lambda\photos -p "test_*.py"`
  フロントエンド編集テスト: `node --test tests\photos-edit.test.cjs`

- 日誌レイアウト: 760px超では日付ナビと天気が1行に並び、狭い画面では縦に積まれます。
  作業カードはコンパクトな間隔で内容に応じて広がり、入れ子のスクロールバーではなく
  ページスクロールを使います。日付クリックでカレンダーダイアログが開きます。
  その日の写真は「この日の写真を見る」でダイアログを開いたときだけ読み込みます。
  ボタンは認証付き `GET /photos/by-date?date=YYYY-MM-DD&countOnly=1`（`{"total": N}`）で
  件数のみを取得し、写真のメタデータや画像は読みません。件数表示対応の日誌を公開する
  前に Lambda を再デプロイしてください。再度開くと署名付き画像URLを再取得します。
  ダイアログと写真ボタンは印刷されません。天気と日誌の作業内容は既存の印刷動作を
  維持します。
  モーダルのテスト: `node --test tests\diary-modals.test.cjs`

- JWT発行者:
  `https://cognito-idp.ap-northeast-1.amazonaws.com/  ap-northeast-1_OFiPcQjkC`、
  オーディエンス: `mg1q2dnn576jln28m5sja6eaf`。Lambda は検証済みクレームが
  このクライアント・発行者のアクセストークンであることも要求します。
- API Gateway に**各ルート**の Lambda 呼び出し権限があることを確認してください。
  コンソールの統合では通常自動で付与されます。必要なら API Gateway をプリンシパルとし、
  このAPIの実行ARNに限定した Lambda のリソースベースポリシーを使います。
  公開の Lambda Function URL は有効化しないでください。
- API の CORS: オリジン `https://d3sscxnlo0qnhe.cloudfront.net`、ヘッダー
  `authorization`・`content-type`、メソッド `GET`・`POST`・`OPTIONS`、
  認証情報は無効、max age 300。プリフライトは HTTP API に処理させ、
  OPTIONS ルートに JWT 認証を付けないでください。
- S3 の CORS: 同じオリジン、メソッド `GET`・`HEAD`・`POST`・`PUT`、許可ヘッダー `*`、
  公開ヘッダー `ETag`、max age 300。CORS は S3 へのアクセス権を与えるものではありません。
- Cognito: パブリックSPAクライアント（シークレットなし）、セルフサインアップ無効、
  認可コードグラントのみ、スコープ `openid email`。コールバック
  `https://d3sscxnlo0qnhe.cloudfront.net/photos/callback.html`、サインアウトURL
  `https://d3sscxnlo0qnhe.cloudfront.net/photos/index.html`。
- フロントエンドの接続情報は `deploy/photos/config.js` にあります。`deploy/photos/` と、
  変更した `deploy/fields/index.html`・`deploy/data/pages.json`・`deploy/sw.js` を
  パスを保ったまま**公開サイトバケット**にアップロードします。これらはコードであり、
  非公開の写真データは含みません。更新後のサービスワーカーが読み込まれるよう、
  該当する CloudFront パスを無効化してください。
- API の `$default` へのデプロイは、全ルートで JWT 認証と `openid` スコープを
  確認した**あとにのみ**行ってください。このリポジトリは AWS を自動変更しません。

### 保存・プライバシー・制限

S3キーは `photos/fields/<圃場名のSHA-256>/` を使い、その下に `images/`・`pending/`・
`records/` のサブプレフィックスがあります。写真ごとに一意のIDがあり、同時書き込みで
壊れる共有JSONインデックスはありません。`pending/` はアップロードのメタデータを保存し、
一覧に出るのは完了済みの `records/` エントリだけです。完了処理の再試行は冪等です。
この初期版では pending レコードを自動削除しないでください（安全な再試行を支えるためです）。
失敗・放置されたアップロードは非公開オブジェクトとして残ることがあります。全画像に
有効期限を設定するのではなく、明示的に確認して掃除してください。
現状は圃場名が関連付けのキーです。圃場名を変更する場合は、その写真のレコード・キーの
移行が必要です（自動リネームは実装されていません）。

ブラウザは JPEG/PNG/WebP（元ファイル最大20MB）を長辺1920px以内のJPEGに変換し、
canvas再エンコードで元のメタデータを除去し、出力5MBを強制します。HEICと元ファイルの
保存には対応していません。APIはコンテンツタイプ・サイズ・JPEGシグネチャを確認しますが、
完全な画像デコーダやマルウェアスキャナでは**ありません**。この初期版は遅延読み込みの
表示用画像を使い、別個のサムネイルファイルは作りません。一覧は取得済みレコードを
撮影日で並べ替えます。S3のページングはアップロードID順で、全体の撮影日順ではありません。
すべての写真を含めるには後続ページを読み込んでください。

トークンはタブごとの sessionStorage に保持し、公開JSONには決して入れません。
リフレッシュトークンは保持しないため、セッションが切れたら再ログインが必要です。
サービスワーカーは `/photos/` のリクエストや外部のS3/APIリクエストをキャッシュしません。
S3の画像応答は `no-store` を指定します。署名付きURLは5分有効のベアラー認証情報です。
ログや共有に残さないでください。発行済みのURLはログアウト後も期限まで有効なことがあり、
権限のあるユーザーは写真の保存やスクリーンショットができます。
これをブラウザの機能で防ぐことはできません。

### 検証

```powershell
python -m unittest discover -s lambda\photos -p "test_*.py" -v
```

テストはインメモリのS3モックを使い、AWSには接続しません。デプロイ後は次を確認します:
**全ルート**への未認証リクエストが401を返すこと。Cognitoログインと初回パスワード変更が
できること。JPEGのアップロードが選択した圃場に表示され拡大できること。権限のある別の
ユーザーが閲覧できること。署名なしのS3アクセスが拒否されること。ログアウトでページの
画像が消えること。既存のログが変わらないこと。
実際のAWSデプロイとエンドツーエンドの認可は別途確認が必要です。

## シフト案の自動作成（lambda/shift）

毎月26日の朝に、timetree の勤務希望から翌月のシフト案（予算シナリオ付き）を作り、
非公開バケットへ保存して SNS で知らせる Lambda です。農園OSは**提案の表示まで**を担当し、
timetree の修正（確定・「希」外し）は人が行います。

- `lambda/shift/lambda_function.py` : ハンドラ（fetch → parse → plan → S3保存 → 通知）
- `lambda/shift/shift_tool.py` : シフト調整ツール本体のコピー。原本は
  `g:\マイドライブ\02_労務管理\09_シフト管理\shift-tool\shift-tool\shift_tool.py`。
  原本を更新したら、このコピーも差し替えてください。
- テスト: `python -B -m unittest discover -s lambda\shift -p "test_*.py"`（AWS接続なし）
- ビルド: `./scripts/build_shift_lambda_zip.ps1` → `shift.zip`（Linux用ホイールを同梱。
  boto3 はランタイム提供のため含めない）

### AWS設定（photosと同じ方針。このリポジトリはAWSを自動変更しません）

- 非公開バケット（例 `yamamoto-farm-private-shift`）: S3 Block Public Access は4つとも有効、
  ACL無効、公開ポリシーなし。公開サイトの CloudFront には追加しない。キー構成:
  - `shift/config.json` … スタッフマスタ（入力）。shift-tool の config.json から
    **`timetree_email` / `timetree_password` を削除したもの**をアップロードする
    （認証情報は Secrets Manager に移す）。時給を含むため公開バケットには置かない。
  - `shift/<YYYY-MM>/entries.csv` `plan.txt` `proposal.csv` `plan.json` … 月別の結果
  - `shift/<YYYY-MM>/runs/<日時>/` … 実行ごとのスナップショット（取得した `.ics` 原本＋
    `entries.csv`・`plan.json`）。timetree は希望と確定が同じカレンダーのため、
    月末編集後に再計算しても 26日時点の希望の原本がここに残る
  - `shift/latest.json` … 最新の plan.json（管理ページが読む）
  - `shift/ics/*.ics` … 手動再計算（`skip_fetch`）用の置き場（任意）
- Secrets Manager: シークレット（例 `yamamoto-farm/timetree`）に
  JSON `{"email": "...", "password": "..."}` を保存。
- SNS: トピックを作成し、通知先メールを購読（成功・失敗の両方を通知）。
- Lambda: ランタイム Python 3.13、ハンドラ `lambda_function.lambda_handler`、
  メモリ 512MB、タイムアウト 300秒。環境変数:
  - `SHIFT_BUCKET` =（非公開バケット名）
  - `SHIFT_PREFIX` = `shift/`（既定）
  - `TIMETREE_SECRET_ARN` =（シークレットのARN）
  - `SNS_TOPIC_ARN` =（トピックのARN）
- 実行ロール: 非公開バケットの `shift/*` に対する `s3:GetObject` / `s3:PutObject` と
  `s3:ListBucket`（prefix条件 `shift/*`）、対象シークレットの `secretsmanager:GetSecretValue`、
  トピックへの `sns:Publish`、基本の CloudWatch Logs。公開バケットへの権限は不要。
- EventBridge Scheduler: `cron(0 7 26 * ? *)`・タイムゾーン `Asia/Tokyo`、
  ターゲットはこの Lambda、ペイロード `{}`。
- 手動実行: コンソールのテストで `{"month": "2026-11"}`（対象月の指定）、
  `{"month": "2026-11", "skip_fetch": true}`（`shift/ics/` の .ics で再計算）、
  `{"peak": true}`（繁忙期・実働9h許容）。
- timetree-exporter は非公式ツールのため、timetree 側の変更で失敗することがあります。
  失敗は SNS で通知されるので、手元の shift-tool（CLI）で作成して S3 に置けば復旧できます。

### 管理ページ（/admin/shift/）とシフト案API

`/admin/shift/index.html` は、保存済みの plan.json をカレンダー表示し、予算スライダーで
シナリオを切り替え、timetree 確定操作のチェックリストを表示します。時給を含むため、
photos と同じ Cognito ログインに加えて **cognito:groups の admin または family** が必要です
（worker には返しません）。チェック状態はブラウザの localStorage にのみ保存されます。

- フロントエンド: `deploy/admin/shift/`（`/photos/auth.js` の PKCE ログインを再利用。
  Cognito 側の設定変更は不要）
- API Lambda: `lambda/shift-api/lambda_function.py`（1ファイル。boto3 はランタイム提供）
- スタッフマスタ編集: `/admin/shift/config.html`（シフト管理ページの「⚙ スタッフ・設定」から）。
  保存は検証つきの `POST /shift/config` で行い、保存前の設定を
  `shift/config-backups/` に自動退避します。認証情報キーが混入しても保存時に除去します。
  反映は次回の自動生成（毎月26日）から。今月分に反映するには生成 Lambda を手動実行します。
- テスト: `python -B -m unittest discover -s lambda\shift-api -p "test_*.py"` と
  `node --test tests\shift-plan.test.cjs`

AWS設定（photos の HTTP API に追加）:

- Lambda: `yamamoto-farm-shift-api`、Python 3.13、ハンドラ `lambda_function.lambda_handler`、
  メモリ 128MB、タイムアウト 10秒。環境変数 `SHIFT_BUCKET`（非公開バケット名）、
  `SHIFT_PREFIX`=`shift/`、`PLAN_FUNCTION`=`yamamoto-farm-shift-plan`（再計算用）。
- 実行ロール: 非公開バケットの `shift/*` への `s3:GetObject`、`s3:ListBucket`
  （prefix条件 `shift/*`）、`shift/config.json`・`shift/config-backups/*`・
  `shift/*/edits.json` への `s3:PutObject`、生成 Lambda への `lambda:InvokeFunction`
  （再計算に必要）。
- 既存の HTTP API（photos と同じもの）にルートを追加し、**すべてに** JWT オーソライザー
  `farm-photos-cognito`・必須スコープ **openid** を付けます（ペイロード形式 2.0）:

  | メソッド | パス | 用途 |
  | --- | --- | --- |
  | GET | `/shift/plan` | 最新（または `?month=YYYY-MM`）の plan.json |
  | GET | `/shift/months` | 保存済みの月の一覧 |
  | GET | `/shift/config` | スタッフマスタの取得 |
  | POST | `/shift/config` | スタッフマスタの保存（検証・バックアップつき） |
  | POST | `/shift/regenerate` | 生成 Lambda を非同期起動して案を再計算 |
  | GET | `/shift/edits` | 月の編集データの取得（`?month=` 必須） |
  | POST | `/shift/edits` | 月の編集データの保存（端末間で共有） |

- 各ルートに Lambda 呼び出し権限があることを確認します（photos と同様）。
- Cognito ユーザープールの **グループ** に admin / family が設定されていることを確認します
  （photos の編集権限と同じ仕組み。worker ユーザーは 403 になります）。
- フロントエンドの公開: `deploy/admin/shift/` と `deploy/data/pages.json` を公開サイト
  バケットへアップロードし、CloudFront で `/admin/shift/*` と `/data/pages.json` を
  無効化します。

## リポジトリ構成

- `deploy/` : S3に公開する静的フロントエンドファイル
- `src/gdd/` : AWS Lambda にデプロイする GDD 予測の Python 実装
- `lambda/photos/` : 圃場写真（非公開）APIの Lambda
- `lambda/shift/` : 毎月のシフト案生成 Lambda（上記参照）
- `lambda/shift-api/` : シフト案 読み取りAPIの Lambda（admin/family 限定）
- `scripts/` : パッケージングとデプロイの補助スクリプト
- `requirements.txt` : Lambda 用の Python 依存パッケージ

## ローカル検証

```bash
python -m py_compile src/gdd/__init__.py src/gdd/weather_loader.py src/gdd/gdd_calculator.py src/gdd/model.py src/gdd/app.py
```

## Lambda zip のビルド（GDD）

PowerShell:

```powershell
./scripts/build_gdd_lambda_zip.ps1
```

できた `gdd.zip` を対象の Lambda 関数にアップロードします。

## Lambda ハンドラ（GDD）

ハンドラには次を設定します:

```text
app.lambda_handler
```

## リクエストペイロードの例（GDD）

```json
{
  "planting_date": "2026-01-10",
  "harvest_date": "2026-03-20",
  "variety": "新藍",
  "target_weight_kg": 2.3,
  "weather_path": "../../data/weather/2026.json"
}
```
