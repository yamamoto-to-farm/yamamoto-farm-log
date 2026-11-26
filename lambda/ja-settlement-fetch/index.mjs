import { createHash } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { capture, discover } from "./browser.mjs";

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

function validReportDate(value) {
  if (typeof value !== "string" || !/^\d{8}$/.test(value) || value < "20261101") return false;
  const date = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10).replaceAll("-", "") === value;
}

async function putOnce(s3, input) {
  try {
    await s3.send(new PutObjectCommand({ ...input, IfNoneMatch: "*" }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 412) return false;
    throw error;
  }
}

export function createHandler({ s3, secrets, captureReport, discoverReports, bucket, secretId, signUrl = getSignedUrl }) {
  return async (event) => {
    const status = authorized(event?.requestContext?.authorizer?.jwt?.claims || {});
    if (status !== 200) return response(status, { message: "利用する権限がありません。" });
    const route = event.routeKey;
    if (!["POST /settlements/capture", "POST /settlements/discover", "POST /settlements/import",
      "GET /settlements/analyses", "GET /settlements/pdf"].includes(route)) return response(404, { message: "不明なルートです。" });
    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (error) {
      if (error instanceof SyntaxError) return response(400, { message: "JSONが不正です。" });
      throw error;
    }
    if (!body || Array.isArray(body) || typeof body !== "object") return response(400, { message: "リクエスト本文が不正です。" });
    const keys = Object.keys(body).sort().join(",");
    if (route === "POST /settlements/capture" && keys) return response(400, { message: "リクエスト本文は空のJSONにしてください。" });
    if (route === "POST /settlements/discover" &&
        (keys !== "page,year" || typeof body.year !== "string" || !/^\d{4}$/.test(body.year) || Number(body.year) < 2026 ||
         !Number.isInteger(body.page) || body.page < 1 || body.page > 1000)) {
      return response(400, { message: "対象年またはページ番号が不正です。" });
    }
    if (route === "POST /settlements/import" &&
        (keys !== "date,number" || !validReportDate(body.date) ||
         typeof body.number !== "string" || !/^\d{6,12}$/.test(body.number))) {
      return response(400, { message: "通知書の日付または番号が不正です。" });
    }
    const query = event.queryStringParameters || {};
    if (route === "GET /settlements/pdf" &&
        (Object.keys(query).sort().join(",") !== "date,number" || !validReportDate(query.date) ||
         typeof query.number !== "string" || !/^\d{6,12}$/.test(query.number))) {
      return response(400, { message: "通知書の日付または番号が不正です。" });
    }

    let stage = "configuration";
    try {
      if (!bucket || (route.startsWith("POST ") && !secretId)) throw new Error("Missing configuration");
      if (route === "GET /settlements/pdf") {
        stage = "storage";
        const key = `settlements/analysis/${query.date}_${query.number}.json`;
        let record;
        try {
          const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          record = JSON.parse(await result.Body.transformToString());
        } catch (error) {
          if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey") {
            return response(404, { message: "通知書が見つかりません。" });
          }
          throw error;
        }
        if (record.date !== query.date || record.number !== query.number ||
            typeof record.source !== "string" || !/^settlements\/analysis-sources\/[a-f0-9]{64}\.pdf$/.test(record.source)) {
          throw new Error("Invalid source reference");
        }
        const url = await signUrl(s3, new GetObjectCommand({
          Bucket: bucket, Key: record.source, ResponseContentType: "application/pdf",
          ResponseContentDisposition: "inline", ResponseCacheControl: "private, no-store",
        }), { expiresIn: 300 });
        return response(200, { url });
      }
      if (route === "GET /settlements/analyses") {
        stage = "storage";
        const reports = [];
        let token;
        do {
          const listing = await s3.send(new ListObjectsV2Command({
            Bucket: bucket, Prefix: "settlements/analysis/", ContinuationToken: token,
          }));
          for (const object of listing.Contents || []) {
            if (!/^settlements\/analysis\/\d{8}_\d{6,12}\.json$/.test(object.Key)) {
              throw new Error("Unexpected analysis object");
            }
            const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
            reports.push(JSON.parse(await result.Body.transformToString()));
          }
          token = listing.NextContinuationToken;
        } while (token);
        return response(200, { reports });
      }
      stage = "secret";
      const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
      const credentials = JSON.parse(secret.SecretString || "");
      if (typeof credentials.username !== "string" || !credentials.username ||
          typeof credentials.password !== "string" || !credentials.password) {
        throw new Error("Invalid credentials configuration");
      }
      if (route === "POST /settlements/discover") {
        stage = "listing";
        return response(200, await discoverReports(credentials, body.year, body.page));
      }
      if (route === "POST /settlements/import") {
        stage = "capture";
        const report = await captureReport(credentials, undefined, body);
        if (report.date !== body.date || report.number !== body.number || !report.analysis) {
          throw new Error("Invalid captured report");
        }
        stage = "storage";
        const hash = createHash("sha256").update(report.pdf).digest("hex");
        const source = `settlements/analysis-sources/${hash}.pdf`;
        await putOnce(s3, {
          Bucket: bucket, Key: source, Body: report.pdf, ContentType: "application/pdf", CacheControl: "no-store",
        });
        const record = { date: report.date, number: report.number, ...report.analysis, source };
        const created = await putOnce(s3, {
          Bucket: bucket, Key: `settlements/analysis/${report.date}_${report.number}.json`,
          Body: JSON.stringify(record), ContentType: "application/json; charset=utf-8", CacheControl: "no-store",
        });
        return response(200, { status: created ? "saved" : "already_saved", date: report.date, number: report.number });
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
  discoverReports: discover,
  bucket: process.env.FINANCE_BUCKET,
  secretId: process.env.JA_SECRET_ID,
});
