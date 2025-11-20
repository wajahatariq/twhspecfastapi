import os
import json

import gspread
import pandas as pd
from datetime import datetime, timedelta, time
import pytz
from typing import Optional

from app.config import SHEET_NAME, SERVICE_ACCOUNT_FILE, TIMEZONE

tz = pytz.timezone(TIMEZONE)

_gc = None
_spectrum_ws = None
_insurance_ws = None
_users_ws = None

# New: read JSON content if provided
SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")

def normalize_card_number(card: str) -> str:
    """
    Remove all non-digit characters from the card number.
    """
    if card is None:
        return ""
    s = str(card).strip()
    return "".join(ch for ch in s if ch.isdigit())


def normalize_expiry(expiry: str) -> str:
    """
    Normalize expiry to MMYY (digits only, 4 characters).
    Examples:
      "09/34" -> "0934"
      "9/34"  -> "0934"
      "0934"  -> "0934"
    """
    if expiry is None:
        return ""
    s = str(expiry).strip()
    digits = "".join(ch for ch in s if ch.isdigit())

    if len(digits) == 3:
        # e.g. 934 -> 0934
        digits = "0" + digits
    elif len(digits) > 4:
        # If somehow longer than 4, cut extra
        digits = digits[:4]

    return digits

def get_gc() -> gspread.Client:
    """
    Return a cached gspread Client.

    Priority:
    1. If GOOGLE_SERVICE_ACCOUNT_JSON is set -> use that (JSON content).
    2. Else fall back to SERVICE_ACCOUNT_FILE (path-based).
    """
    global _gc
    if _gc is not None:
        return _gc

    if SERVICE_ACCOUNT_JSON:
        # JSON content stored directly in env var
        try:
            info = json.loads(SERVICE_ACCOUNT_JSON)
        except json.JSONDecodeError as e:
            raise RuntimeError(
                f"Invalid GOOGLE_SERVICE_ACCOUNT_JSON content: {e}"
            ) from e

        _gc = gspread.service_account_from_dict(info)
    else:
        # Fallback to file path for local/dev
        _gc = gspread.service_account(filename=SERVICE_ACCOUNT_FILE)

    return _gc


def get_spectrum_ws():
    global _spectrum_ws
    if _spectrum_ws is None:
        gc = get_gc()
        _spectrum_ws = gc.open(SHEET_NAME).worksheet("Sheet1")
    return _spectrum_ws


def get_insurance_ws():
    global _insurance_ws
    if _insurance_ws is None:
        gc = get_gc()
        _insurance_ws = gc.open(SHEET_NAME).worksheet("Sheet2")
    return _insurance_ws


def get_users_ws():
    global _users_ws
    if _users_ws is None:
        gc = get_gc()
        _users_ws = gc.open(SHEET_NAME).worksheet("Sheet3")
    return _users_ws


def load_users_df() -> pd.DataFrame:
    ws = get_users_ws()
    records = ws.get_all_records()
    return pd.DataFrame(records)


def load_data(ws) -> pd.DataFrame:
    records = ws.get_all_records()
    df = pd.DataFrame(records)

    if "Expiry Date" in df.columns:
        df["Expiry Date"] = (
            df["Expiry Date"]
            .astype(str)
            .str.replace("/", "", regex=False)
            .str.strip()
            .str.zfill(4)
        )
    return df


def process_dataframe(df: pd.DataFrame, delete_after_minutes: int = 5):
    if df.empty:
        return df, df

    if "Timestamp" in df.columns:
        df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")
        df["Timestamp"] = df["Timestamp"].apply(
            lambda x: x.tz_localize(None) if hasattr(x, "tzinfo") and x.tzinfo else x
        )
        now = datetime.now(tz).replace(tzinfo=None)
        cutoff = now - timedelta(minutes=delete_after_minutes)
        df = df[
            (df["Status"] == "Pending")
            | (
                (df["Status"].isin(["Charged", "Declined"]))
                & (df["Timestamp"] >= cutoff)
            )
        ]

    pending = df[df["Status"] == "Pending"]
    return pending, None


def get_pending_transactions(sheet: str) -> pd.DataFrame:
    if sheet == "spectrum":
        ws = get_spectrum_ws()
    elif sheet == "insurance":
        ws = get_insurance_ws()
    else:
        raise ValueError("sheet must be 'spectrum' or 'insurance'")

    df = load_data(ws)
    pending, _ = process_dataframe(df)
    return pending

def get_all_transactions(sheet: str) -> pd.DataFrame:
    """
    Return all transactions for the given sheet as a DataFrame.
    sheet must be 'spectrum' or 'insurance'.
    """
    if sheet == "spectrum":
        ws = get_spectrum_ws()
    elif sheet == "insurance":
        ws = get_insurance_ws()
    else:
        raise ValueError("sheet must be 'spectrum' or 'insurance'")

    df = load_data(ws)
    return df

def get_recent_transactions(
    sheet: str,
    minutes: int = 20,
    agent_name: Optional[str] = None,
) -> pd.DataFrame:
    """
    Return transactions from the given sheet within the last `minutes`.
    Optionally filter by Agent Name.
    """
    if sheet == "spectrum":
        ws = get_spectrum_ws()
    elif sheet == "insurance":
        ws = get_insurance_ws()
    else:
        raise ValueError("sheet must be 'spectrum' or 'insurance'")

    df = load_data(ws)
    if df.empty or "Timestamp" not in df.columns:
        return pd.DataFrame()

    # Parse Timestamp and drop invalid
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")
    df = df.dropna(subset=["Timestamp"])

    # Make timestamps naive and compare with current time in TIMEZONE
    df["Timestamp"] = df["Timestamp"].astype("datetime64[ns]")
    now = datetime.now(tz).replace(tzinfo=None)
    cutoff = now - timedelta(minutes=minutes)

    df = df[df["Timestamp"] >= cutoff]

    # Optional agent filter
    if agent_name:
        if "Agent Name" in df.columns:
            df = df[df["Agent Name"].astype(str).str.strip() == str(agent_name).strip()]

    return df

def update_status_by_record_id(sheet: str, record_id: str, new_status: str):
    if sheet == "spectrum":
        ws = get_spectrum_ws()
    elif sheet == "insurance":
        ws = get_insurance_ws()
    else:
        raise ValueError("sheet must be 'spectrum' or 'insurance'")

    all_records = ws.get_all_records()
    df = pd.DataFrame(all_records)
    if df.empty or "Record_ID" not in df.columns or "Status" not in df.columns:
        raise ValueError("Sheet missing required columns")

    df["Record_ID"] = df["Record_ID"].astype(str).str.strip()
    record_id = str(record_id).strip()

    matched = df[df["Record_ID"] == record_id]
    if matched.empty:
        raise ValueError("Record not found")

    idx = matched.index[0]
    row_num = idx + 2
    col_num = df.columns.get_loc("Status") + 1

    ws.update_cell(row_num, col_num, new_status)
    return True


def get_record_by_id(sheet: str, record_id: str) -> dict:
    if sheet == "spectrum":
        ws = get_spectrum_ws()
    elif sheet == "insurance":
        ws = get_insurance_ws()
    else:
        raise ValueError("sheet must be 'spectrum' or 'insurance'")

    all_records = ws.get_all_records()
    df = pd.DataFrame(all_records)
    if df.empty or "Record_ID" not in df.columns:
        return {}

    df["Record_ID"] = df["Record_ID"].astype(str).str.strip()
    record_id = str(record_id).strip()

    matched = df[df["Record_ID"] == record_id]
    if matched.empty:
        return {}

    record = matched.iloc[0].to_dict()
    return record
from datetime import datetime, timedelta
import pytz

# ... existing code ...

def create_transaction(sheet: str, data: dict) -> dict:
    if sheet == "spectrum":
        ws = get_spectrum_ws()
    elif sheet == "insurance":
        ws = get_insurance_ws()
    else:
        raise ValueError("sheet must be 'spectrum' or 'insurance'")

    records = ws.get_all_records()
    df = pd.DataFrame(records)
    if df.empty:
        next_id = "1"
    else:
        try:
            existing_ids = (
                df["Record_ID"]
                .astype(str)
                .str.extract(r"(\d+)", expand=False)
                .dropna()
                .astype(int)
            )
            next_id = str(existing_ids.max() + 1) if not existing_ids.empty else "1"
        except Exception:
            next_id = str(len(df) + 1)

    now = datetime.now(tz)
    date_of_charge = now.strftime("%Y-%m-%d")
    ts = now.strftime("%Y-%m-%d %I:%M:%S %p")

    record_id = next_id

    # Normalize card number and expiry date before saving
    raw_card_number = data.get("card_number", "")
    raw_expiry = data.get("expiry_date", "")

    card_number = normalize_card_number(raw_card_number)
    expiry = normalize_expiry(raw_expiry)

    if sheet == "spectrum":
        row = [
            record_id,
            data.get("agent_name", ""),
            data.get("name", ""),
            data.get("ph_number", ""),
            data.get("address", ""),
            data.get("email", ""),
            data.get("card_holder_name", ""),
            card_number,          # cleaned card number
            expiry,               # cleaned expiry
            int(data.get("cvc") or 0),
            str(data.get("charge") or ""),
            data.get("llc", ""),
            data.get("provider", ""),
            date_of_charge,
            "Pending",
            ts,
        ]
        ws.append_row(row)
        headers = ws.row_values(1)
        record_dict = dict(zip(headers, row))
        return record_dict

    # insurance sheet (no Provider column)
    row = [
        record_id,
        data.get("agent_name", ""),
        data.get("name", ""),
        data.get("ph_number", ""),
        data.get("address", ""),
        data.get("email", ""),
        data.get("card_holder_name", ""),
        card_number,          # cleaned card number
        expiry,               # cleaned expiry
        int(data.get("cvc") or 0),
        str(data.get("charge") or ""),
        data.get("llc", ""),
        date_of_charge,
        "Pending",
        ts,
    ]
    ws.append_row(row)
    headers = ws.row_values(1)
    record_dict = dict(zip(headers, row))
    return record_dict


def update_transaction_fields(sheet: str, record_id: str, updates: dict) -> dict:
    """
    Update basic transaction fields (name, phone, address, email, charge, llc, provider).
    Returns the updated record as a dict.
    """
    if sheet == "spectrum":
        ws = get_spectrum_ws()
    elif sheet == "insurance":
        ws = get_insurance_ws()
    else:
        raise ValueError("sheet must be 'spectrum' or 'insurance'")

    all_records = ws.get_all_records()
    df = pd.DataFrame(all_records)
    if df.empty or "Record_ID" not in df.columns:
        raise ValueError("Sheet missing required columns")

    df["Record_ID"] = df["Record_ID"].astype(str).str.strip()
    record_id = str(record_id).strip()

    matched = df[df["Record_ID"] == record_id]
    if matched.empty:
        raise ValueError("Record not found")

    idx = matched.index[0]
    row_num = idx + 2  # header row is 1

    # Map payload keys to sheet column names
    field_map = {
        "name": "Name",
        "ph_number": "Ph Number",
        "address": "Address",
        "email": "Email",
        "charge": "Charge",
        "llc": "LLC",
        "provider": "Provider",
    }

    for key, value in updates.items():
        if key not in field_map:
            continue
        col_name = field_map[key]
        if col_name not in df.columns:
            # e.g. Provider does not exist on insurance sheet
            continue
        col_idx = df.columns.get_loc(col_name) + 1
        ws.update_cell(row_num, col_idx, value if value is not None else "")

    # Reload the updated record
    updated_records = ws.get_all_records()
    updated_df = pd.DataFrame(updated_records)
    if updated_df.empty or "Record_ID" not in updated_df.columns:
        raise ValueError("Unable to reload updated record")

    updated_df["Record_ID"] = updated_df["Record_ID"].astype(str).str.strip()
    updated_match = updated_df[updated_df["Record_ID"] == record_id]
    if updated_match.empty:
        raise ValueError("Updated record not found")

    return updated_match.iloc[0].to_dict()

def get_recent_transactions(sheet: str, minutes: int, agent_name: str | None = None) -> pd.DataFrame:
    """
    Return transactions from the last `minutes` minutes for a sheet,
    optionally filtered by agent_name.
    """
    if sheet == "spectrum":
        ws = get_spectrum_ws()
    elif sheet == "insurance":
        ws = get_insurance_ws()
    else:
        raise ValueError("sheet must be 'spectrum' or 'insurance'")

    records = ws.get_all_records()
    df = pd.DataFrame(records)
    if df.empty:
        return pd.DataFrame()

    if "Timestamp" not in df.columns:
        return pd.DataFrame()

    # Convert to datetime
    df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")
    df = df.dropna(subset=["Timestamp"])

    now = datetime.now(tz).replace(tzinfo=None)
    cutoff = now - timedelta(minutes=minutes)

    df = df[df["Timestamp"] >= cutoff]

    if agent_name and "Agent Name" in df.columns:
        df = df[df["Agent Name"] == agent_name]

    return df


def get_night_charged_total(sheet: Optional[str] = None) -> float:
    """
    Sum of Charge for Status=='Charged' in the night window (7 PM → 6 AM).

    If sheet == "spectrum": only Sheet1 is used.
    If sheet == "insurance": only Sheet2 is used.
    Otherwise: both sheets are included (spectrum + insurance).
    """
    if sheet == "spectrum":
        sheets = ["spectrum"]
    elif sheet == "insurance":
        sheets = ["insurance"]
    else:
        sheets = ["spectrum", "insurance"]

    total = 0.0

    # Work in Asia/Karachi, naive for comparisons
    now = datetime.now(tz).replace(tzinfo=None)
    now_time = now.time()

    # Night window logic (same as your Streamlit logic)
    if time(7, 0) <= now_time < time(19, 0):
        # Daytime: window was yesterday 19:00 → today 06:00
        window_start = datetime.combine(now.date() - timedelta(days=1), time(19, 0))
        window_end = datetime.combine(now.date(), time(6, 0))
    elif now_time >= time(19, 0):
        # Evening: window is today 19:00 → tomorrow 06:00
        window_start = datetime.combine(now.date(), time(19, 0))
        window_end = datetime.combine(now.date() + timedelta(days=1), time(6, 0))
    else:
        # Early morning (00:00–06:00): window is yesterday 19:00 → today 06:00
        window_start = datetime.combine(now.date() - timedelta(days=1), time(19, 0))
        window_end = datetime.combine(now.date(), time(6, 0))

    for s in sheets:
        if s == "spectrum":
            ws = get_spectrum_ws()
        else:
            ws = get_insurance_ws()

        records = ws.get_all_records()
        df = pd.DataFrame(records)
        if df.empty:
            continue

        if "Timestamp" not in df.columns or "Status" not in df.columns or "Charge" not in df.columns:
            continue

        df["Timestamp"] = pd.to_datetime(df["Timestamp"], errors="coerce")
        df = df.dropna(subset=["Timestamp"])

        # Normalize Charge to float
        charge_str = df["Charge"].astype(str).str.replace(r"[\$,]", "", regex=True)
        df["ChargeFloat"] = pd.to_numeric(charge_str, errors="coerce").fillna(0.0)

        mask = (
            (df["Status"] == "Charged")
            & (df["Timestamp"] >= window_start)
            & (df["Timestamp"] <= window_end)
        )
        total += df.loc[mask, "ChargeFloat"].sum()

    return float(total)

