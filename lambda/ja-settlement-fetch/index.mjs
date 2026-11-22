import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { capture } from "./browser.mjs";

const clientId = "mg1q2dnn576jln28m5sja6eaf";
const issuer = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_OFiPcQjkC";

function response(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(body) };
}

function authorized(claims) {
  if (claims.token_use !== "access" || claims.client_id !== clientId || claims.iss !== issuer ||
      !claims.sub || !String(claims.scope || "").split(" ").includes("openid")) return 401;
  const groups = String(claims["cognito:groups"] || "").replace(/[[\],]/g, " ").split(/\s+/);
  return groups.some((group) => group === "admin" || group === "family") ? 200 : 403;
}

export function createHandler({ s3, secrets, captureReport, bucket, secretId }) {
  return async (event) => {
    const status = authorized(event?.requestContext?.authorizer?.jwt?.claims || {});
    if (status !== 200) return response(status, { message: "利用する権限がありません。" });
    if (event.routeKey !== "POST /settlements/capture") return response(404, { message: "不明なルートです。" });
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).length) {
        return response(400, { message: "リクエスト本文は空のJSONにしてください。" });
      }
    } catch (error) {
      if (error instanceof SyntaxError) return response(400, { message: "JSONが不正です。" });
      throw error;
    }

    let stage = "configuration";
    try {
      if (!bucket || !secretId) throw new Error("Missing configuration");
      stage = "secret";
      const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
      const credentials = JSON.parse(secret.SecretString || "");
      if (typeof credentials.username !== "string" || !credentials.username ||
          typeof credentials.password !== "string" || !credentials.password) {
        throw new Error("Invalid credentials configuration");
      }
      stage = "capture";
      const report = await captureReport(credentials);
      const key = `settlements/raw/${report.date}_${report.number}.pdf`;
      stage = "storage";
      try {
        await s3.send(new PutObjectCommand({
          Bucket: bucket, Key: key, Body: report.pdf, ContentType: "application/pdf",
          CacheControl: "no-store", IfNoneMatch: "*",
        }));
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 412) {
          return response(200, { status: "already_saved", date: report.date, number: report.number });
        }
        throw error;
      }
      return response(200, { status: "saved", date: report.date, number: report.number, pages: report.pages });
    } catch {
      console.error(`Settlement capture failed at ${stage}.`);
      return response(502, { message: "通知書を取得できませんでした。設定・ログイン情報・JA画面を確認してください。", stage });
    }
  };
}

export const handler = createHandler({
  s3: new S3Client({}),
  secrets: new SecretsManagerClient({}),
  captureReport: capture,
  bucket: process.env.FINANCE_BUCKET,
  secretId: process.env.JA_SECRET_ID,
});
