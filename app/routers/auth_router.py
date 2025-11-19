# app/routers/auth_router.py
from fastapi import APIRouter, HTTPException, status

from app.schemas import SignupRequest, LoginRequest, TokenResponse
from app.services.auth import user_exists, add_user, validate_login, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=TokenResponse)
def signup(payload: SignupRequest):
    if user_exists(payload.user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User ID already exists",
        )

    add_user(payload.user_id, payload.password)
    token = create_access_token(subject=payload.user_id)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest):
    if not validate_login(payload.user_id, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid ID or password",
        )

    token = create_access_token(subject=payload.user_id)
    return TokenResponse(access_token=token)
