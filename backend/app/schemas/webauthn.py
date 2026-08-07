from datetime import datetime
from pydantic import BaseModel
import uuid


class RegistrationVerifyRequest(BaseModel):
    credential: dict
    nickname: str = "Biometric login"


class CredentialResponse(BaseModel):
    id: uuid.UUID
    nickname: str
    created_at: datetime
    last_used_at: datetime | None

    class Config:
        from_attributes = True


class LoginOptionsRequest(BaseModel):
    phone_number: str


class LoginVerifyRequest(BaseModel):
    phone_number: str
    credential: dict
