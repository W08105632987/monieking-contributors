"""Director-controlled seasonal themes (Christmas / New Year / Easter).

Stored as JSON under system_config `seasonal_theme`. Public read so the app
can theme itself before login; director-only write. Only one theme shows at
a time: Easter wins if on, else Christmas. The New Year sub-setting swaps
Christmas decoration for New Year decoration from 1 January (the client
decides by date, so no scheduled job is needed)."""
import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import DirectorOnly
from app.services.settings_service import get_config_value, set_config_value

router = APIRouter(prefix="/seasonal", tags=["seasonal"])
KEY = "seasonal_theme"
DEFAULT = {"christmas": False, "new_year": False, "easter": False}


class SeasonalPatch(BaseModel):
    christmas: bool | None = None
    new_year: bool | None = None
    easter: bool | None = None


async def _load(db: AsyncSession) -> dict:
    cfg = dict(DEFAULT)
    raw = await get_config_value(db, KEY)
    if raw:
        try:
            cfg.update({k: bool(v) for k, v in json.loads(raw).items() if k in DEFAULT})
        except ValueError:
            pass
    return cfg


@router.get("")
async def get_seasonal(db: AsyncSession = Depends(get_db)):
    return await _load(db)


@router.put("")
async def put_seasonal(body: SeasonalPatch, user: DirectorOnly, db: AsyncSession = Depends(get_db)):
    cfg = await _load(db)
    cfg.update(body.model_dump(exclude_none=True))
    await set_config_value(db, key=KEY, value=json.dumps(cfg), updated_by=user.id)
    await db.commit()
    return cfg
