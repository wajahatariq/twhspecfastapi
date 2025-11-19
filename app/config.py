# app/config.py
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# Google Sheet
SHEET_NAME = "Company_Transactions"  # same as your Streamlit app
SERVICE_ACCOUNT_FILE = os.getenv(
    "GOOGLE_SERVICE_ACCOUNT_FILE",
    str(BASE_DIR / "service_account.json"),
)

# Auth / JWT
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change_this_in_production")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# Timezone
TIMEZONE = "Asia/Karachi"
