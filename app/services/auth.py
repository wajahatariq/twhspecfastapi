# app/services/auth.py
import hashlib
from datetime import datetime, timedelta
from typing import Optional

from jose import jwt

from app.config import JWT_SECRET_KEY, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES
from app.services.google_sheets import get_users_ws, load_users_df


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def user_exists(user_id: str) -> bool:
    df = load_users_df()
    if df.empty:
        return False
    return user_id in df["ID"].astype(str).values


def add_user(user_id: str, password: str):
    ws = get_users_ws()
    hashed_pw = hash_password(password)
    ws.append_row([user_id, hashed_pw])


def validate_login(user_id: str, password: str) -> bool:
    df = load_users_df()
    if df.empty:
        return False

    hashed_pw = hash_password(password)
    df["ID"] = df["ID"].astype(str)
    match = df[(df["ID"] == user_id) & (df["Password"] == hashed_pw)]
    return not match.empty


def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    if expires_delta is None:
        expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    expire = datetime.utcnow() + expires_delta
    to_encode = {"sub": subject, "exp": expire}
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return encoded_jwt
