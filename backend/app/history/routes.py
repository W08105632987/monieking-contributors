"""GET /api/v1/history — the single History feed."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import CustomerOrOfficer
from app.history import service as svc

router = APIRouter(prefix="/history", tags=["history"])


@router.get("")
async def history(user: CustomerOrOfficer, customer_id: uuid.UUID | None = Query(None),
                  limit: int = Query(80, ge=1, le=200), db: AsyncSession = Depends(get_db)):
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    if role == "officer":
        if not customer_id:
            raise HTTPException(status_code=400, detail="customer_id is required.")
        target = customer_id
    else:
        target = user.id
    return await svc.build_feed(db, actor_id=user.id, is_officer=role == "officer", customer_id=target, limit=limit)
