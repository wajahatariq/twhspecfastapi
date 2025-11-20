#!/bin/sh
set -e

# If SERVICE_ACCOUNT_JSON is set as an env var (Fly secret),
# write it to a local file so gspread can use it.
if [ -n "$SERVICE_ACCOUNT_JSON" ]; then
  echo "$SERVICE_ACCOUNT_JSON" > service_account.json
fi

# Ensure GOOGLE_SERVICE_ACCOUNT_FILE default if not set
if [ -z "$GOOGLE_SERVICE_ACCOUNT_FILE" ]; then
  export GOOGLE_SERVICE_ACCOUNT_FILE="service_account.json"
fi

# Start uvicorn on port 8080
exec uvicorn app.main:app --host 0.0.0.0 --port 8080
