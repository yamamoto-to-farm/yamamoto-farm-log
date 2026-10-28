# Yamamoto Farm Log

This project contains the static farm log web application and the experimental GDD forecasting Lambda package.

## Private field photos

The `/photos/index.html` page uses a separate Cognito authorization-code login
with PKCE (S256). Existing farm-log login is unchanged. Every user provisioned by
an administrator in the dedicated pool can read/add all farm photos; self-signup
must remain disabled. Local browser roles are not accepted by the photo API.
The page is linked from the top menu. The field-detail link is temporarily
removed while its placement is reconsidered; the photo page remains available.

### AWS setup and deployment

- Region: `ap-northeast-1`.
- Private bucket: `yamamoto-farm-private-photos`. Keep all four S3 Block Public
  Access settings enabled, ACLs disabled, and no public bucket policy. Do not add
  this bucket to the site's public CloudFront distribution.
- Lambda: `yamamoto-farm-photos-api`, Python 3.13, handler
  `lambda_function.lambda_handler`. Deploy the content of
  `lambda/photos/lambda_function.py` to the console's `lambda_function.py`, or
  zip that single file at the archive root. Runtime-provided boto3 is used;
  no additional packages are required.
- Environment: `PHOTO_BUCKET=yamamoto-farm-private-photos`,
  `PHOTO_PREFIX=photos/`.
- Execution role: `s3:ListBucket` on the private bucket, restricted to
  `photos/` and `photos/*`; `s3:GetObject` and `s3:PutObject` on
  `arn:aws:s3:::yamamoto-farm-private-photos/photos/*`. Keep the basic CloudWatch
  Logs policy. No delete permission or access to the public bucket is required.
- HTTP API Lambda proxy integration: payload format **2.0**. All routes
  below must use JWT authorizer `farm-photos-cognito` and required scope
  **openid**:

  | Method | Path | Purpose |
  | --- | --- | --- |
  | GET | `/photos` | List a field's completed photos, 20 per page |
  | GET | `/photos/search` | Search by date range and optional fields, 24 per page |
  | POST | `/photos/uploads` | Issue a 5-minute size-limited S3 POST |
  | POST | `/photos/complete` | Validate upload and publish its metadata |

- Photo search requires `from` and `to` (YYYY-MM-DD). Optional `fields` is a
  JSON-encoded array of field names; omitted or empty means all fields. The
  legacy single `field` parameter remains supported. Follow the returned
  `cursor` with the same search conditions. The gallery URL uses repeated
  `field` parameters to restore multiple selections. Gallery filters support
  area-wide selection; photo uploads still select exactly one destination.
  Redeploy the Lambda before publishing the multi-field gallery frontend.

- JWT issuer:
  `https://cognito-idp.ap-northeast-1.amazonaws.com/  ap-northeast-1_OFiPcQjkC`;
    audience: `mg1q2dnn576jln28m5sja6eaf`. Lambda also requires the verified
  claims to identify an access token for this client and issuer.
- Ensure API Gateway has Lambda invoke permission for **each** route. The
  console integration normally adds this; if necessary use Lambda's
  resource-based policy with API Gateway as principal, restricted to this
  API's execution ARN. Do not enable a public Lambda function URL.
- API CORS: origin `https://d3sscxnlo0qnhe.cloudfront.net`; headers
  `authorization`, `content-type`; methods `GET`, `POST`, `OPTIONS`;
  credentials disabled; max age 300. Let HTTP API handle preflight; do not
  attach JWT auth to a separate OPTIONS route.
- S3 CORS: same origin; methods `GET`, `HEAD`, `POST`, `PUT`; allowed headers
  `*`; exposed header `ETag`; max age 300. CORS does not grant S3 access.
- Cognito: public SPA client (no secret), self-signup disabled, code grant only,
  scopes `openid email`; callback
  `https://d3sscxnlo0qnhe.cloudfront.net/photos/callback.html`, sign-out URL
  `https://d3sscxnlo0qnhe.cloudfront.net/photos/index.html`.
- Front-end connection values are in `deploy/photos/config.js`. Upload
  `deploy/photos/` plus modified `deploy/fields/index.html`,
  `deploy/data/pages.json`, and `deploy/sw.js` to the **public site bucket**,
  preserving paths. These contain code, not private photo data. Invalidate
  their CloudFront paths so the updated service worker is loaded.
- Deploy the API to `$default` **only after** verifying JWT auth and `openid`
  scope on every route. This repository does not automatically modify AWS.

### Storage, privacy, and limits

S3 keys use `photos/fields/<SHA-256 of field name>/` with `images/`, `pending/`,
and `records/` sub-prefixes. Each photo has a unique ID; there is no shared
JSON index that concurrent writers can overwrite. `pending/` stores upload
metadata; only completed `records/` entries are listed. A retry of completion
is idempotent. Do not delete pending records automatically in this initial
version: they support safe retries. Failed/abandoned uploads can leave private
objects; inspect and clean those explicitly rather than expiring all images.
Field names are currently the association key: renaming a field requires
migrating its photo records/keys (no automatic rename is implemented).

The browser converts JPEG/PNG/WebP (source max 20MB) into a JPEG with a maximum
1920px long edge, removes source metadata by canvas re-encoding, and enforces
5MB output. HEIC and original-file preservation are not supported. The API
checks content type, size and JPEG signature; it is **not** a full image decoder
or malware scanner. This first version uses lazy-loaded display images, not
separate thumbnail files. Lists sort the fetched records by capture date;
S3 pagination is by upload ID, not global capture date. Load subsequent pages
to include all photos.

Tokens are held in per-tab sessionStorage, never in public JSON. Refresh tokens
are not retained; an expired session requires login again. The service worker
does not cache `/photos/` requests or external S3/API requests. S3 image
responses specify `no-store`. Signed URLs are bearer credentials valid for
5 minutes: do not log/share them; a URL already issued can work until expiry
even after logout, and an authorized user can still save/screenshot photos.
No browser feature can prevent that.

### Validation

```powershell
python -m unittest discover -s lambda\photos -p "test_*.py" -v
```

Tests use an in-memory S3 mock and do not access AWS. After deployment verify:
unauthenticated requests to **every** route return 401; Cognito login and
initial password change work; a JPEG upload appears in the selected field and
can be enlarged; another authorized user can view it; unsigned S3 access is
denied; logout removes the page's images; existing logs remain unchanged.
Real AWS deployment and end-to-end authorization must be checked separately.

## Repository structure

- `deploy/` : static front-end files published to S3
- `src/gdd/` : Python implementation for GDD-based prediction to be deployed to AWS Lambda
- `scripts/` : helper scripts for packaging and deployment
- `requirements.txt` : Python dependencies for Lambda

## Local validation

```bash
python -m py_compile src/gdd/__init__.py src/gdd/weather_loader.py src/gdd/gdd_calculator.py src/gdd/model.py src/gdd/app.py
```

## Build Lambda zip

PowerShell:

```powershell
./scripts/build_gdd_lambda_zip.ps1
```

Then upload `gdd.zip` to the target Lambda function.

## Lambda handler

Set the handler to:

```text
app.lambda_handler
```

## Example request payload

```json
{
  "planting_date": "2026-01-10",
  "harvest_date": "2026-03-20",
  "variety": "新藍",
  "target_weight_kg": 2.3,
  "weather_path": "../../data/weather/2026.json"
}
```
