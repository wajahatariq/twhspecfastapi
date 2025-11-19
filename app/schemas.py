# app/schemas.py
from typing import Optional, Literal, Dict, Any

from pydantic import BaseModel, Field, EmailStr


class AgentTransactionCreate(BaseModel):
    sheet: Literal["spectrum", "insurance"]
    agent_name: str = Field(..., alias="agent_name")
    name: str
    ph_number: str
    address: str
    email: str
    card_holder_name: str
    card_number: str
    expiry_date: str
    cvc: int
    charge: str
    llc: str
    provider: Optional[str] = None  # ignored for insurance


class AgentTransactionUpdate(BaseModel):
    # All optional so agents can patch specific fields
    name: Optional[str] = None
    ph_number: Optional[str] = None
    address: Optional[str] = None
    email: Optional[EmailStr] = None
    charge: Optional[str] = None
    llc: Optional[str] = None
    provider: Optional[str] = None  # spectrum only


class SignupRequest(BaseModel):
    user_id: str = Field(..., min_length=3)
    password: str = Field(..., min_length=4)


class LoginRequest(BaseModel):
    user_id: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class StatusUpdateRequest(BaseModel):
    new_status: Literal["Pending", "Charged", "Declined", "Charge Back"]


class TransactionRecord(BaseModel):
    data: Dict[str, Any]
