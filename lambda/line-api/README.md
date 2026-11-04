# LINE登録・承認・業務連絡送信

既存のCognito（admin/family）・非公開シフトS3・SSMのLINE資格情報を使う独立Lambda。
テスト専用の `yamamoto-farm-line-test` と、予定APIの `yamamoto-farm-shift-api` は上書きしない。
定時送信、グループチャット、毎月の定型文のAPI送信、返信本文のOS保存は対象外。
返信は公式アカウント管理アプリで対応する。

## 配置前の確認

- コードのローカルテストと実際のLINE送信は別。下記の通し確認が終わるまで本番運用しない。
- 登録コードの受信にはWebhookからLINEプロフィールAPIを使い、承認画面用の表示名を取得する。
  氏名だけでは自動紐づけしない。ID・表示名・登録日時・承認者は非公開S3へ保存する。
- 秘密値・登録コード・ユーザーID・本文をログや公開データへ出さない。
  API Gatewayの本文ログも有効にしない。

## ビルド

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build_line_api_zip.ps1
```

`line-api.zip` を新規生成する。既存のshift-apiビルダーで検証済みSDKを取得し、
次の3ソースを同梱する。**ファイル単体の貼り付けでは動かない。**

- `lambda/line-api/lambda_function.py` → `lambda_function.py`
- `lambda/shift-api/lambda_function.py` → `work_plans.py`（予定の検証・読み込み・既存認証定数を共用）
- `lambda/line-test/lambda_function.py` → `line_webhook.py`（生本文の署名検証を共用）

SDKは既存 `lambda/shift-api/requirements.txt` と同じ。
公開サイトへZIPや原本の秘密情報を置かない。

## AWS設定

新しいLambda `yamamoto-farm-line-api`、Python 3.13、ハンドラ
`lambda_function.lambda_handler`、256MB、タイムアウト30秒、VPCなし。
HTTP APIとSSMと同じリージョンに作成し、`line-api.zip` をアップロードする。

環境変数：

| 名前 | 値 |
| --- | --- |
| `SHIFT_BUCKET` | 既存の非公開シフトバケット |
| `SHIFT_PREFIX` | `shift/` |
| `WORKERS_BUCKET` | 公開サイトの `data/workers.json` があるS3バケット |

`WORKERS_BUCKET` の値はCloudFrontドメイン名ではなくバケット名。
作業者の安定識別子は `workers.json` の `name`、予定との照合は `display` の完全一致。
role=worker または family、activeがfalseでない作業者だけを扱う。adminは登録対象外。
既存の権限区分は変更しない。氏名・識別子の重複はエラー。
名前変更・退職・ブロック・登録解除があると未送信分は停止する。
ブロック解除後は自動復帰せず、本人を確認し登録をやり直す。

実行ロールはCloudWatch Logs権限に加え、以下を付与する。
`REGION` / `ACCOUNT_ID` / `PRIVATE_BUCKET` / `PUBLIC_BUCKET` を置き換える。
SSMは既存 `alias/aws/ssm` を利用。カスタマー管理KMSキーの場合はその権限も別途必要。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": [
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/yamamoto-farm/line/channel-access-token",
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/yamamoto-farm/line/channel-secret"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::PUBLIC_BUCKET/data/workers.json",
        "arn:aws:s3:::PRIVATE_BUCKET/shift/line/*",
        "arn:aws:s3:::PRIVATE_BUCKET/shift/work-plans/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": [
        "arn:aws:s3:::PRIVATE_BUCKET/shift/line/*",
        "arn:aws:s3:::PRIVATE_BUCKET/shift/work-plans/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::PRIVATE_BUCKET",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["shift/line/*", "shift/work-plans/*"]
        }
      }
    }
  ]
}
```

ListBucketは未作成オブジェクトが403ではなく404と判別できるように必要。
公開サイト側の `data/workers.json` は既存オブジェクトを必ず配置しておく。

既存の写真・シフトと同じHTTP APIに以下を設定する。

| ルート | 認証 | 統合先 |
| --- | --- | --- |
| POST `/line/webhook` | NONE（Lambda内でLINE署名検証） | 新 `yamamoto-farm-line-api` |
| GET `/line/manage` | 既存Cognito JWT・必須scope openid | 同上 |
| POST `/line/manage` | 既存Cognito JWT・必須scope openid | 同上 |

全てペイロード2.0。API GatewayのLambda呼び出し権限はAPI・メソッド・ルートに限定。
既存の `/line/webhook` の統合先だけをテストLambdaから切り替える。
**写真・シフトのルートのCognito認証は外さない。** Lambda内でもissuer/client/groupを再確認する。
管理APIはGET/POSTのみで、無認証の直接テストイベントに管理操作は許可しない。

CORSの許可Originは既存の公開OSのOriginを維持し、GET/POST、Authorization、Content-Typeを許可。
自動デプロイがオフなら利用ステージへデプロイ。
LINE Developersで既存Webhook URLの「検証」が成功することを確認し、利用をオンにする。
Webhook再送も利用できる。API Gatewayで名前付きステージを使う場合、外部URLのステージ部分は維持する。

フロントは `deploy/admin/message/` 内と `deploy/schedule/daily-plan/` の変更を公開し、
CloudFrontで `/admin/message/*` と `/schedule/daily-plan/*` を無効化する。
`line.js` も必要。APIを先に配置し、フロントを後から公開する。
未設定・APIエラーでも既存コピー機能は使える（LINE状態の取得は明示ボタンからのみ）。

## 登録・承認

1. 業務連絡ページの「LINE登録・承認・この日の送信履歴」を開き「LINE連携を取得」。
2. 対象の作業者（パート・家族）を選び「登録コードを発行」。`LINK ...` 全文を本人へ個別に渡す。
3. 本人が公式アカウントを友だち追加し、個人LINEの1対1チャットへ全文を送信。
4. 管理画面を再取得。承認待ちのLINE表示名を、コードを渡した本人に別途確認する。
5. 「本人を確認して承認」。管理者確認まで送信不可。1つのLINEを複数作業者には紐づけない。

コードは15分有効、保存するのはSHA-256ハッシュのみ。
発行し直しは前のコード・承認待ちを無効化する。登録済みIDは上書きできない。
解除・取消後の新規登録は新コードと再承認が必要。
期限は最初の受信まで。受信済みの同一イベント再送は二重登録しない。
LINE表示名は本人確認の根拠ではなく、対面等の確認材料としてだけ使う。
解除は保存済みリンクを空にするが、過去の送信記録には監査・再試行用のIDが残る。
リンク・送信記録の保存期間や削除運用は本番利用時に決める。

接続テストの `test-user-id` は自動でパートへ移行しない。対象本人の手順で改めて承認する。
自分だけの画面テストでは、本人の許可なく実在パートのコードを自分のLINEに登録しない。
実際のパート1人に協力してもらい少人数で確認する。

家族も同じ本人登録・管理者承認を経て送信できる。
予定編集の「家族への業務連絡」で明示的に選択した家族だけが連絡対象になる。
既存予定や未選択の家族へ自動で連絡しない。連絡対象の家族は予定内の全作業に参加し、
全作業に開始・終了時刻が必要。家族の連絡用時間帯はその予定の作業時間から作成し、
パートのシフト勤務時間とは区別する。複数予定の場合は作業時間をまとめて表示する。

## 送信・再試行

- LINE連携を取得した後、カードの「LINE送信内容を確認」から準備する。
- 対象全員の承認が必須。未登録者がいれば送信不可とし、コピーを残す。
- 全予定IDと更新版、各人の参加時間、全対象予定の一致をサーバーでも確認する。
- 原本の予定・文面・宛先IDを送信準備として非公開S3へ固定保存し、確認ダイアログで全文を表示する。
- 5000 UTF-16文字を上限とする。コピー機能の10000文字上限は変えない。
- 確認後、ブラウザーから1人ずつ送信APIを呼ぶ（1リクエスト1人、LINE待ちは最大8秒）。
- 個人ごとに受付・失敗・結果不明を永続化。部分成功を「全員送信済み」としない。
- 全員受付後だけ既存の連絡控えへ送信時点のsnapshot・全文を保存し、
  既存の予定変更検出・文面復元につなげる。
- 控えの保存に失敗しても受付済みの人を再送しない。履歴から再試行すると控え保存だけを復旧する。

S3状態はETag条件付き書込。初回通信前に個人ごとのretry keyと結果不明状態を保存する。
通信断・Lambda停止・多重操作時も同じ本文・宛先・キーで再試行する。
LINE受付済み（200、または受付済みrequest-id付き409）は配達・既読を保証しない。
401/429等は失敗、5xx・タイムアウトは結果不明として明示する。
トークン・権限の設定不備は管理者が直す。自動的に新しいキーで送り直さない。

再試行は最初の試行から23時間以内（LINEキー保持24時間に余裕を持たせる）。
結果不明のまま期限超過した場合は自動再送・終了できない。
管理者が到着とLINE側・S3記録を確認し、二重送信リスクを解消してから個別対応する。
送信記録を安易に消して新規送信しない。

結果不明での再試行だけは、後から予定が変わっていても当初の固定文を使う。
初回送信・明確な失敗後の再送は最新予定を再確認し、変更時は止める。
登録先変更・解除・ブロックは結果不明時も停止し、別IDへ自動転送しない。
新しい連絡を送る前に、未完了分は履歴から再試行、または結果不明がない場合だけ終了する。
別の連絡として再送する場合は明示確認を取る。

非公開S3：

- `shift/line/links.json`：登録コードのハッシュ・承認待ち・承認済みリンク
- `shift/line/deliveries/YYYY-MM-DD.json`：日付別の送信準備・宛先ごとの結果（1日100準備・2MiBまで）
- `shift/work-plans/YYYY-MM-DD.json`：全員受付後の既存形式の連絡控え

処理件数とサイズの上限を超えた場合は通知して停止する。黙って履歴を捨てない。
定型文・変更連絡・Botからの新規pushも月間通数の対象になるため、公式管理画面で残量を確認する。
現在はOS内の残通数表示は未実装。無料枠超過時は手動チャット／コピーで対応する。

## 検証

```powershell
python -B -m unittest discover -s lambda\line-api -p "test_*.py"
python -B -m unittest discover -s lambda\line-test -p "test_*.py"
node --test tests\line-message.test.cjs tests\message-plan.test.cjs
```

外部通信は全てモック。実AWSで以下を別途確認する：

1. 未認証・workerは管理APIを呼べない。不正署名は401、LINEの検証は200。
2. 発行 → 本人からLINK全文送信 → 未承認では送れない → 管理者承認。
3. 時間違いのカード・共通追記・手修正の全文確認 → 対象の個人LINEへ実到着。
4. 1人失敗時の表示、受付済み分を再送しない再試行、リロード後の履歴復元。
5. 全員受付後の控えと予定変更表示、未登録時の手動コピー、管理アプリでの返信。

これらは実装・ローカル検証だけでは完了扱いにしない。
問題時はフロントをコピー運用に戻し、Webhook統合先を旧テストLambdaに戻せる。
ただし本番送信を開始した後の結果不明ジョブは残し、未確認のまま再送しない。
