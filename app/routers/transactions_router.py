# app/routers/transactions_router.py
from typing import List, Optional
import json

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas import (
    StatusUpdateRequest,
    TransactionRecord,
    AgentTransactionCreate,
    AgentTransactionUpdate,
)

from app.services.google_sheets import (
    get_pending_transactions,
    update_status_by_record_id,
    get_record_by_id,
    create_transaction,
    update_transaction_fields,
    get_recent_transactions,
    get_night_charged_total,
    get_all_transactions,
)



from app.ws_manager import manager

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get("/pending", response_model=List[TransactionRecord])
def list_pending(sheet: str = Query(..., pattern="^(spectrum|insurance)$")):
    try:
        df = get_pending_transactions(sheet)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if df.empty:
        return []

    records = [TransactionRecord(data=row.to_dict()) for _, row in df.iterrows()]
    return records

@router.get("/recent", response_model=List[TransactionRecord])
def list_recent(
    sheet: str = Query(..., pattern="^(spectrum|insurance)$"),
    minutes: int = Query(20, ge=1, le=1440),
    agent_name: Optional[str] = Query(None),
):
    """
    Return recent transactions (last `minutes` minutes) for the given sheet.
    Optionally filter by agent_name.
    """
    try:
        df = get_recent_transactions(sheet, minutes, agent_name)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if df.empty:
        return []

    records = [TransactionRecord(data=row.to_dict()) for _, row in df.iterrows()]
    return records

@router.get("/all", response_model=List[TransactionRecord])
def list_all(
    sheet: str = Query(..., pattern="^(spectrum|insurance)$"),
):
    """
    Return all transactions for the selected sheet.
    Used by manager analytics (full table, charts, duplicates).
    """
    try:
        df = get_all_transactions(sheet)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if df.empty:
        return []

    return [TransactionRecord(data=row.to_dict()) for _, row in df.iterrows()]

@router.post("/agent/submit", response_model=TransactionRecord)
async def agent_submit(payload: AgentTransactionCreate):
    try:
        record = create_transaction(payload.sheet, payload.dict(by_alias=True))
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    event = {
        "type": "new_pending",
        "sheet": payload.sheet,
        "record": record,
    }
    await manager.broadcast(json.dumps(event))

    return TransactionRecord(data=record)


@router.get("/{sheet}/{record_id}", response_model=TransactionRecord)
def get_transaction(sheet: str, record_id: str):
    if sheet not in ("spectrum", "insurance"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sheet"
        )

    record = get_record_by_id(sheet, record_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Record not found"
        )

    return TransactionRecord(data=record)


@router.patch("/{sheet}/{record_id}/status")
async def update_status(sheet: str, record_id: str, payload: StatusUpdateRequest):
    if sheet not in ("spectrum", "insurance"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sheet"
        )

    try:
        update_status_by_record_id(sheet, record_id, payload.new_status)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    event = {
        "type": "status_update",
        "sheet": sheet,
        "record_id": record_id,
        "new_status": payload.new_status,
    }

    await manager.broadcast(json.dumps(event))

    return {"detail": "Status updated"}


@router.patch("/agent/{sheet}/{record_id}", response_model=TransactionRecord)
async def agent_update_transaction(
    sheet: str, record_id: str, payload: AgentTransactionUpdate
):
    """
    Allow agents to update basic lead fields (name, phone, address, email, charge, llc, provider).
    Card data and status are not changed here.
    """
    if sheet not in ("spectrum", "insurance"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sheet"
        )

    updates = payload.dict(exclude_unset=True, by_alias=True)
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided for update",
        )

    try:
        updated_record = update_transaction_fields(sheet, record_id, updates)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return TransactionRecord(data=updated_record)

@router.get("/recent", response_model=List[TransactionRecord])
def list_recent(
    sheet: str = Query(..., pattern="^(spectrum|insurance)$"),
    minutes: int = Query(20, ge=1, le=1440),
    agent_name: str | None = Query(None),
):
    try:
        df = get_recent_transactions(sheet, minutes, agent_name)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if df.empty:
        return []

    return [TransactionRecord(data=row.to_dict()) for _, row in df.iterrows()]


@router.get("/night_total")
def night_total(sheet: Optional[str] = Query(
    None,
    description="spectrum, insurance, or omit for both"
)):
    total = get_night_charged_total(sheet=sheet)
    return {"total": total}