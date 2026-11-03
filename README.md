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
- API Lambda: `lambda/shift-api/lambda_function.py`（予定保存の条件付きS3更新用にboto3を同梱）
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
  | GET | `/shift/plan` | 最新（または `?month=YYYY-MM`）の plan.json。`&run=list` でスナップショット一覧、`&run=<日時>` で生成実行時点の原本 |
  | GET | `/shift/months` | 保存済みの月の一覧 |
  | GET | `/shift/config` | スタッフマスタの取得 |
  | POST | `/shift/config` | スタッフマスタの保存（検証・バックアップつき） |
  | POST | `/shift/regenerate` | 生成 Lambda を非同期起動して案を再計算 |
  | GET | `/shift/edits` | 月の編集データの取得（`?month=` 必須） |
  | POST | `/shift/edits` | 月の編集データの保存（端末間で共有） |
  | GET | `/shift/work-plans` | 日別予定・担当者別表示・リビジョンの取得（`?date=YYYY-MM-DD`） |
  | POST | `/shift/work-plans` | 予定の追加・編集・中止・削除、連絡コピーの控え保存（競合時409） |

- 各ルートに Lambda 呼び出し権限があることを確認します（photos と同様）。
- Cognito ユーザープールの **グループ** に admin / family が設定されていることを確認します
  （photos の編集権限と同じ仕組み。worker ユーザーは 403 になります）。
- フロントエンドの公開: `deploy/admin/shift/` と `deploy/data/pages.json` を公開サイト
  バケットへアップロードし、CloudFront で `/admin/shift/*` と `/data/pages.json` を
  無効化します。

### 作業予定の管理と業務連絡

- `/schedule/daily-plan/` で全ての予定を作成・閲覧・編集・削除・中止する。
  `/admin/message/` は保存済み予定の読込・文面の補足・コピー専用とし、コピーで予定を変更しない。
  両画面は既存Cognito・シフトAPI・非公開S3を使う（admin/family限定）。
- 予定の必須項目は日付・作業者・作業内容。家族のみ・パートのみ・混合作業を作業者の選択から判定する。
  家族とパートは他ログと共通のモーダルで別々に選び、作業内容は分類別モーダルか自由入力で指定する。
  時間・複数圃場・メモは任意。同じ予定に複数の作業・時間帯を追加でき、家族の参加も作業ごとに指定できる。
  シフトの作業者・時間を入力へ取り込み、TimeTree再取得・月の作業計画への導線も予定画面に集約する。
  読込は候補表示のみで保存済み予定を自動変更しない。パートのみの複数人作業は連絡係を指定する。
- 業務連絡は保存済み予定に設定されたパート宛先へ文面を作る。必要な時間・圃場／集合場所が不足する場合は
  コピーをブロックし、対象の予定編集へのリンクを表示する。家族名は文面には追加しない。
  手修正文面は予定に反映せず、コピー時の控えに残す。毎月の定型文のコピー・編集は従来どおり。
- 日誌の「作業予定」は保存済み予定を既存のGET APIから読み、作業ログ一覧の上に表示する。
  両欄は見出しをカード外に置き、見出し・カードの共通スタイルを使う。
  admin/familyの既存Cognitoログインが必要。取得エラー・未ログイン・予定なしは区別し、日誌の編集・保存を妨げない。
  担当者名・作業種別（既知の別名を正規化）・指定圃場が一致するログを参考表示する。
  該当ログが見つからない場合は、作業に対応する入力ページへのリンクを表示する。
  入力先が一意に決まらない育苗や自由記述の作業、ログ取得失敗時・中止連絡には表示しない。
  時刻は照合せず、完了・未実施の判定や実績の自動作成は行わない。自由記述の作業は完全一致のみ。
  登録元を表示し、旧形式の保存データは「業務連絡」として扱う。
  トップ右カードもadmin/family向けに今日・明日の保存済み予定を表示し、
  「予定を追加・編集」と「作業予定を連絡する」から選択日を各入力ページへ渡す（業務連絡の指定なしは従来どおり明日）。
  定植予定・管理作業の確認候補は同カード下部に折りたたみ、左の日誌・中央の天候は重複表示しない。
  workerには非公開予定の取得・作成導線を出さず、確認事項だけを表示する。
  予定と確認事項の取得失敗はそれぞれ再試行できる。確認候補は作業実施を断定するものではない。
  トップの変更は `deploy/index.html`・`deploy/common/top-work-plans.js` と業務連絡ページも公開し、
  `/index.html`・`/`・`/common/top-work-plans.js`・`/admin/message/*` をCloudFront無効化する。
  この表示の公開には `deploy/diary/index.html`・`diary.js`・`diary.css`・`planned-work.js` を更新し、
  `/diary/*` をCloudFront無効化する。
- 日別予定は入力対象（家族従業員／パート従業員）→作業形態→１つの作業者選択モーダル→作業内容の順に入力する。
  家族の予定には①家族のみ・②家族＋パート、パートの予定には②家族＋パート・③パート複数・④パート１人だけ表示する。
  ①は家族、③④はシフトにいるパート、②は両方をモーダルに表示する。④は単一選択。
  フォームには「作業者」として選択結果だけを表示し、③が1人のときは注意する。
  保存時も選択した形態の人数・区分を確認する。保存形式・連絡文面の既存 `kind` は維持する。
  シフト読込は設定のログイン連携を優先し、従業員マスタのフルネームへ変換する。
  未連携は名前が一意に一致する場合のみ使い、同姓など曖昧な場合は設定の確認を案内する。
  読込後のパート従業員はその日の有効シフト（保留・除外・勤務時間0を除く）に限定する。
  入力クリア・保存後も同じ日は制限を維持し、日付変更で解除する。パートの選択前に未読込ならシフトを取得する。
  パートの名前の下に登録済みの時間・作業を短く表示し、同じ人を複数予定に選べる。
  保存後は「続けて作業予定を追加」で別の作業を入力する。作業別家族選択は既存の例外設定がある場合だけ表示する。
  出勤パートは時間によらず中止以外の予定の登録有無だけ確認し、「○○は作業予定がありません」と表示する。
  家族の未登録・未割当時間・作業完了は判定しない。
  パートを選ぶと勤務時間から別予定・入力中の別作業を差し引いた時間候補を表示する。
  正午をまたぐ勤務は12:00から `break_minutes.spanning_noon` 分を昼休憩として除く（短い休憩の時刻は推定しない）。
  候補が１つなら未入力の開始・終了へ初期設定し、複数なら選択する。入力済み時刻は作業者変更でも上書きしない。
  作業時間は候補内で短縮可能。出退勤が異なる人は各人の勤務内だけ参加し、全員が参加できる候補だけを表示する。
  編集中の予定自身・中止は差し引かない。時間未指定の別予定は差し引けないことを表示する。
  パートの勤務時間外・昼休憩・他の作業との重複は保存を拒否する。家族だけの時間は引き続き任意。
  日別予定・業務連絡・`deploy/common/filter/filter-worker.js` を公開・キャッシュ無効化する。
  統合コピーのAPI変更を含むため、新しい `shift-api.zip` を先に反映する。APIルート・IAM権限の追加は不要。
- 保存先は `SHIFT_BUCKET` の `<SHIFT_PREFIX>work-plans/YYYY-MM-DD.json`。
  `plans` に予定IDをキーとして、時間帯（開始・終了・圃場・作業・作業場集合・共同作業者）、宛先グループ、
  作業形態・連絡係・宛先・メモ・中止状態・更新者・更新時刻を保持する。
  パートの `attendance: {氏名: [{start, end}]}` と各作業の `participation: {氏名: [{start, end}]}` を保存する。
  前者はシフトの出退勤、後者は作業時間と本人の勤務時間が重なる参加時間。`people` の投影は各人の参加時間を表示する。
  旧予定はそのまま読めるが、出退勤未登録の通常連絡は予定編集でシフトを確認・保存するまでコピーできない。
  GETの `time_support: true` を確認してから新形式を保存し、旧APIによる時間情報の破棄を防ぐ。
  共同作業者は参加した作業だけトップ・日誌に表示・照合される。
  圃場なしは担当者＋作業内容で照合し、複数圃場はどれかが一致するログを表示する。
  「除草剤散布」「草刈り」は作業区分も一致させ、混同しない。完了判定はしない。
- 既存の業務連絡由来の予定も同じ画面で編集・削除・中止できる。別の予定は保持する。
  中止は作業内容を残し、中止を解除することもできる。削除とは区別する。
  旧`people`形式は読込時に予定単位へ変換し、次回保存時に移行する。`people`は担当者別表示用の投影となる。
- コピー成功後のPOST `operation: "communicate"` で `communications` に連絡時点の予定・文面・宛先・更新版・日時を保存する。
  参加する予定ID・出退勤時間・各作業の参加時間が同じパートだけをまとめ、全作業を１日分の文面に統合する。
  同じ勤務・参加時間なら全員同じ予定は１通、Aが午前作業1＋午後作業3、B/Cが午前作業2＋午後作業3なら２通となる。
  同じ収穫13:00–16:00でもAが08:00–15:30、Bが09:00–16:00勤務なら２通に分け、Aの収穫は13:00–15:30と記載する。
  文面に出勤・退勤と各作業時間を記載する。予定間で保存した出退勤が異なる場合は更新を案内し、コピーを拒否する。
  POSTの `copies: [{id, plan_revision}, ...]` で全対象予定の控えを１回の条件付き更新により保存する。
  一部の予定が変更・削除された場合は全控えの保存を拒否する。従来の単一 `id` 形式も維持する。
  業務連絡のコピー状態は宛先と全予定の組合せごとに確認し、別宛先へのコピーを自分宛ての控えと混同しない。
  コピーは送信とは区別し、今回のAPIはクライアントから「送信済み」に変更できない。LINEBot送信自体は未実装。
  最後の連絡控えと現在の予定を比較し、「連絡後に変更あり」を表示する。再コピーで最新の控えを追加する。
  コピー失敗時は控えを作成しない。コピー済みで控え保存に失敗した場合は明示し、再コピーで再試行する。
  コピー済みの削除は警告・`confirm_copied: true` が必要。将来の送信済みはAPIでも削除を拒否する。
  削除しても控えは残す。日別JSONの条件付き更新なのでS3 DeleteObject権限は不要。
- **公開順序：先に新しいshift-api.zipをyamamoto-farm-shift-apiへ反映し、その後フロントを公開する。**
  既存GET/POSTルートとIAM権限を使うため追加設定は不要。直接入力は旧APIでは保存をブロックして更新を案内する。
  新規 `deploy/schedule/daily-plan/*`・`deploy/common/work-plan-form.js` と `deploy/data/pages.json` も公開し、
  `/schedule/daily-plan/*`・`/common/*`・`/data/pages.json`・`/admin/message/*`・`/diary/*`・`/index.html`・`/` を無効化する。
- GETの `revision`（S3 ETag、未作成時null）をPOSTに渡し、`IfMatch` / `IfNoneMatch` で競合を防ぐ。
  競合や保存失敗は通知する。コピー記録は予定の更新版も照合し、古い予定に基づく記録を拒否する。
- 公開前に `lambda/shift-api/lambda_function.py` を **yamamoto-farm-shift-api** に反映し、
  上表のGET/POSTルートを既存のシフトAPI統合に追加する。両方にJWTオーソライザーと必須スコープ
  `openid` を設定し、Lambda呼出権限も追加する。
  実行ロールには非公開バケットの `shift/work-plans/*` への `s3:PutObject` を追加する
  （カスタム `SHIFT_PREFIX` の場合は読み替える。既存のGetObject/ListBucket権限も必要）。
  条件付きPutObjectに対応するboto3を `lambda/shift-api/requirements.txt` で固定し同梱する。
  `powershell -ExecutionPolicy Bypass -File scripts\build_shift_api_zip.ps1` で
  `shift-api.zip` を構築する（pip・Pythonが必要）。SDKの条件付き更新対応・ZIP整合性を検証する。
  このZIPは **yamamoto-farm-shift-api** 用であり、生成用の `shift.zip` とは別物。
- 更新時も日別予定・業務連絡・共通予定読込・トップ・日誌の変更をまとめて公開する。
  上記の公開順序と無効化対象を使う。登録済みのページ・APIルート・IAM権限の追加は不要。
- 検証: `node --test tests\daily-plan.test.cjs tests\message-plan.test.cjs tests\top-work-plans.test.cjs tests\diary-planned-work.test.cjs tests\diary-status.test.cjs` と
  `python -B -m unittest discover -s lambda\shift-api -p "test_*.py"`。

## リポジトリ構成

- `deploy/` : S3に公開する静的フロントエンドファイル
- `src/gdd/` : AWS Lambda にデプロイする GDD 予測の Python 実装
- `lambda/photos/` : 圃場写真（非公開）APIの Lambda
- `lambda/shift/` : 毎月のシフト案生成 Lambda（上記参照）
- `lambda/shift-api/` : シフト案 読み取りAPIの Lambda（admin/family 限定）
- `scripts/` : パッケージングとデプロイの補助スクリプト
- `requirements.txt` : Lambda 用の Python 依存パッケージ

## ローカル検証

### メニュー・収穫KPI

- メニュー定義の `disabled: true` は「準備中」の非リンク表示にする。育苗ログ・品種分析・
  年次比較が対象。施肥計画・防除計画も未実装のためボタンを無効表示する。
- 収穫KPIは表のみ横スクロール可能（キーボード操作可）。印刷時はスクロール制限を解除する。
- 検証: `node --test tests\*.test.cjs`。
- 公開時はトップ、施肥・防除の各入力ページ、`deploy\performance\` 内の
  `harvest-kpi.html`・`harvest-kpi.js`・`kpi-render.js` を更新する。
  `deploy\data\pages.json` は自動同期の対象外なので別途アップロードし、対応するCloudFrontキャッシュを無効化する。

### 日誌の状態表示

- トップと日誌は `deploy/diary/status.js` の共通判定を使う。日誌JSONがあれば内容が空でも
  「日誌保存済み」、日誌なし・作業ログありは「作業記録あり」、両方なしは「記録なし」。
  記録なしを「作業なし」とは判断しない。
- 作業ログの自動表示を基本とし、日誌の編集・保存は必要な日の補足に使う。
  保存していない日を未完了・警告扱いしない。トップの対象日は折りたたんで表示する。
- 日誌・作業CSVのHTTP 404だけを未登録と扱う。403・5xx・通信失敗・JSON解析失敗は
  「取得できません」と通知し、再試行できる。失敗結果はキャッシュしない。
- 日誌の取得失敗中は編集・保存を止める。保存直前の既存日誌取得に失敗した場合も上書きしない。
- 公開時は `deploy/index.html`、`deploy/common/json.js`・`csv.js`、
  `deploy/diary/` の `index.html`・`diary.js`・`status.js`・`loadDiary.js`・
  `work-summary.js`・`saveDiary.js`・`viewCard.js`・`editCard.js` を更新し、対応するCloudFrontキャッシュを無効化する。
  日誌のJSON/CSV読込モジュールには更新版のクエリを付け、古いHTTPエラー処理の再利用を避ける。
  API・Lambda・メニュー定義の変更は不要。

### JA請求明細

- ソース: `lambda/ja-statement-analysis/`（PDF解析・分類・取込API）。
- 経費専用非公開バケット: `yamamoto-farm-private-finance-01`（東京、SSE-S3、
  パブリックアクセス全ブロック、バージョニング有効）。
- Lambda: `yamamoto-farm-finance-api`、Python 3.13、x86_64、
  `lambda_function.lambda_handler`、512MB、タイムアウト60秒。
- 実行ロール: `yamamoto-farm-finance-import-role`。`AWSLambdaBasicExecutionRole` と
  経費用S3ポリシー `FinanceBucketAccess` を使用。
- `s3:ListBucket` は経費バケット全体に許可する。未作成の分類辞書を `GetObject` で確認する際も
  この権限が必要（prefix条件だけに制限すると404ではなく403になる）。
  `GetObject` / `PutObject` は `uploads/*`、`invoices/*`、`imports/*` と
  `classification-rules.json` に限定し、削除権限は付けない。
- 環境変数: `FINANCE_BUCKET=yamamoto-farm-private-finance-01`。
- 全APIで既存Cognitoの検証済み `admin` / `family` を許可。HTTP APIの全ルートには
  既存JWTオーソライザー `farm-photos-cognito` と必須スコープ `openid` を設定する。
- S3イベント通知は `uploads/` prefix・`.pdf` suffixのオブジェクト作成のみを対象にする。
  S3からLambdaへの呼び出し権限も必要。JSON保存による再帰起動は避ける。
- API: `POST /finance/uploads`、`GET /finance/invoices`、
  `GET /finance/invoices/{invoice_no}`、`GET /finance/imports`、
  `GET /finance/imports/{import_id}`、`GET /finance/forecasts`、
  `POST /finance/classifications`、`POST /finance/reimport`。
- 手動分類は `invoice_no + line_seq` で再取込時も保持する。請求予定の表示は最新発行分を使う。
  サンプルPDFは個人情報を含むため、リポジトリやZIPには含めない。
- 数量・単価が空欄の運賃やマイナス明細も金額を保持して合計照合する。空欄は0ではなくnull。
  「○月以降決済予定」は `onwards: true` として保持し、特定月の予定と区別して表示する。
- バケットのCORSには公開サイトのOriginだけを許可し、アップロード用に `POST` を許可する。

テストはAWSに接続しない。ローカルAPIテストには、ルートの `requirements.txt` に指定された
`boto3==1.34.144` も必要（Lambdaではランタイム付属のSDKを使う）。

```powershell
python -m pip install -r .\lambda\ja-statement-analysis\requirements.txt
python -m pip install boto3==1.34.144
python -B -m unittest discover -s .\lambda\ja-statement-analysis -p "test_*.py"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build_ja_statement_lambda_zip.ps1
```

ビルドは一時領域で新規ZIPを作成してから出力を置き換えるため、既存ZIPへ追記しない。
ZIP内の重複・CRC・必須モジュールを検証する。出力は `ja-statement-analysis.zip`。

#### 経費分析ページ

`/finance/index.html` は写真・シフトと同じCognitoセッションと既存callbackを使う。
ログイン後は経費ページへ戻るため、Cognitoのcallback URL追加は不要。
APIによるadmin/family判定がデータ保護を担い、ローカルロールは画面ナビゲーションにだけ使う。
経費データは非公開APIから `cache: "no-store"` で取得し、localStorage等には保存しない。

- 月別・大分類別の積み上げ棒グラフと金額表。取引日の月 / 決済月を切替。
  グラフの金額目盛り・横補助線は表示対象の最大積み上げ額に合わせて自動調整する。
  月の棒（キーボード操作可）から期間をその月に絞り、明細を金額降順で表示。「期間を解除」で戻す。
- 未分類を表示条件内の品名＋部署の完全一致でまとめ、合計金額降順で表示する（規格違いを含む）。
  手動確定済みは対象外。一括修正は既存分類APIで1件ずつ保存し、途中失敗時は保存済み件数を通知、
  同じダイアログでの再試行は未完了分のみ対象。辞書追加は従来の個別修正から行う。
- 明細の並び順は取引日降順・金額降順・金額昇順から選べる。
- 期間・大分類・品名/規格/部署で絞り込み。明細は30件ずつ表示。
- 最新発行分の引落予定（過去月の請求書を後から取り込んでも最新発行分を表示）。
- 要確認/未分類と農機課明細のフィルター。手動分類、任意の辞書追加・過去分再分類。
- PDFアップロード後は結果を最大約60秒待ち、未完了なら「最新データに更新」で再確認する。
  検証失敗は保留と表示し、取り込み履歴から警告・未解析行を確認できる。
- 保存済みPDFの再取り込み。

```powershell
node --test tests\finance.test.cjs tests\auth-policy.test.cjs
```

公開時は **`deploy\finance\` 内の4ファイル**を公開サイトS3の `finance/` に配置し、
`deploy\data\pages.json` を `data/pages.json` に別途反映する（サイト同期ではdata/が除外される）。
CloudFrontで `/finance/*` と `/data/pages.json` を無効化する。
リポジトリ直下の `finance/` にある原本PDFは公開しない。
Lambdaの変更・再デプロイは不要。公開後にadmin/familyで請求書表示・分類保存・PDFアップロードを
実APIで確認すること。ローカルブラウザ検証では認証とAPIを模擬しており、実アカウントでの確認とは別。

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
