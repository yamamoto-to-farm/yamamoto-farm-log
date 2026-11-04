# LINE connection test

自分だけで接続を確認する独立したLambda。予定・シフト・連絡控えは変更しない。
通常の返信本文・画像・プロフィールは保存せず、公式アカウント管理アプリで対応する。
Webhookから返信やテスト送信はしない。LINE側はチャットをオン、応答メッセージをオフにする。

## 1. Lambda作成

- 既存LambdaとSSMパラメータと同じリージョンに `yamamoto-farm-line-test` を新規作成。
- Python 3.13、ハンドラ `lambda_function.lambda_handler`、128MB、タイムアウト20秒。
- このディレクトリの `lambda_function.py` だけをLambdaのコード画面へ貼り付けてDeploy。
  boto3はLambda標準ランタイムのものを使う。既存のshift用ZIPは使わない。
- VPCへの接続は不要。外部のLINE APIへHTTPS接続できる必要がある。
- Function URL・定期実行は作らない。手動テストはLambdaコンソールからのみ行う。

実行ロールは通常のCloudWatch Logs権限に加え、次の最小権限を設定する。
`REGION` / `ACCOUNT_ID` は自分の値へ置き換える。
SSMパラメータのARNは `parameter/yamamoto-farm/...`（parameterの直後に `/` は1つ）。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": [
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/yamamoto-farm/line/channel-access-token",
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/yamamoto-farm/line/channel-secret",
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/yamamoto-farm/line/test-registration",
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/yamamoto-farm/line/test-user-id"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "ssm:PutParameter",
      "Resource": [
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/yamamoto-farm/line/test-registration",
        "arn:aws:ssm:REGION:ACCOUNT_ID:parameter/yamamoto-farm/line/test-user-id"
      ]
    }
  ]
}
```

既存の2パラメータはSecureStringで保存しておく：

- `/yamamoto-farm/line/channel-access-token`
- `/yamamoto-farm/line/channel-secret`

標準の `alias/aws/ssm` を使用する。カスタマー管理KMSキーへ変更する場合は、
キーのポリシーと必要なEncrypt/Decrypt権限も別途設定する。
トークン・シークレットはコード・環境変数・テストイベントに書かず、チャットにも貼らない。

## 2. Webhook接続

既存のHTTP APIへ **POST `/line/webhook` だけ**を追加し、この新Lambdaに統合する。
ペイロード形式は2.0。このルートはLINEから呼び出すためCognitoオーソライザーなし。
既存の写真・シフト等の認証設定は変更しない。Lambda内で生の本文のLINE署名を検証する。
API GatewayからこのLambdaを呼び出す権限は、このAPI・ルートに限定する。
ステージの自動デプロイがオフならデプロイする。

LINE Developers → Messaging API設定：

1. Webhook URLに `https://API_HOST/line/webhook` を登録。
   名前付きステージがある場合はAPIの実際の呼び出しURLに合わせる。
2. 「検証」が成功することを確認（空のeventsも200で返す）。
3. Webhookの利用をオン。Webhook再送も利用できる。

API Gatewayでリクエスト本文・Authorization等のログ記録は有効にしない。
Lambdaもイベント全体・本文・ID・トークンをログに出さず、エラー種別のみ出力する。
この段階ではチャネル基本設定の「あなたのユーザーID」表示・Business ID連携は不要。

## 3. 登録コードで自分を登録

Lambdaコンソールから次のテストイベントを手動実行する。
この直接実行を許可するIAM権限は管理者にだけ与える。

```json
{"action": "prepare_registration"}
```

200のbody内に `registration_message` と有効期限を返す。
`REGISTER ...` の全文をコピーし、**送信先にしたい自分の個人LINEから**
公式アカウントの1対1チャットへ送信する。
登録コードは15分有効。チャット・スクリーンショット等で他人へ共有しない。
再準備すると前のコードは無効になる。

正しい署名・コード・送信者IDを確認して、以下を自動作成する：

- `test-registration`：コードのSHA-256ハッシュと期限（SecureString）
- `test-user-id`：自分の送信者ID（SecureString）

SSM一覧で `test-user-id` が作成されたことを確認する（値の表示は不要）。
登録成功の自動返信はない。普段のチャットだけでは登録されない。
登録済みIDは上書きしない。同じイベントの再送は重複登録せず処理する。
異なるID・不正コード等は4xx、AWS障害は5xxとし、CloudWatchに理由を出す。
LINEからの再送でも失敗が続く場合は設定を直してから新しい登録コードで試す。

登録し直す必要がある場合だけ、管理者が送信先を確認したうえで
SSMの `test-user-id` と `test-registration` を削除し、再準備する。
自動解除・上書き機能は設けない。

## 4. 自分宛てに固定文を送信

PowerShellの `[guid]::NewGuid().ToString()` で新しいUUIDを1つ作り、
次の `retry_key` を置き換える。**意図した新規送信ごとに作り、再試行では変えない。**

```json
{
  "action": "send_test",
  "retry_key": "a620fb4b-8c37-46bc-9fd5-d28b4bdeee2d"
}
```

固定文 `Yamamoto Farm OS: LINE connection test.` を登録先にだけ送る。
イベントから宛先・本文を変えることはできない。1回の新規送信は原則1通を使用する。

- `accepted`：LINE APIが受け付けた。自分のLINEで実際の到着を確認する。
- `already_accepted`：同じretry keyですでに受け付け済み。追加送信はしない。
- `delivery_confirmed: false`：受付は配達・既読の保証ではない。
- タイムアウト・5xx：送信済みの可能性があるため、同じイベント・同じキーで24時間以内に再試行。
- 401/403/429等：トークン・権限・通数上限等を確認する。むやみにキーを変えて再送しない。

LINEのretry keyの保持期間は24時間。期間後の再実行は重複送信のおそれがあるため、
到着と実行履歴を確認せず再送しない。
登録後は再送時も同じID・固定文を維持する。テスト中にトークンを別チャネルのものへ切り替えない。

ここまでで接続テストは完了。パート本人との紐づけ、OSの送信ボタン、
人ごとの送信結果・控え・再連絡の整合は次の段階で実装する。

## ローカル検証（外部通信なし）

```powershell
python -B -m unittest discover -s lambda\line-test -p "test_*.py"
```

テストはAWS SDKとHTTPをモックするため、ローカルへのboto3追加は不要。
実AWSでの署名検証・SSM登録・LINE到着は別途、上記手順で確認する。
