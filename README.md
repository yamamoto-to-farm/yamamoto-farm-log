# Yamamoto Farm Log

This project contains the static farm log web application and the experimental GDD forecasting Lambda package.

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
