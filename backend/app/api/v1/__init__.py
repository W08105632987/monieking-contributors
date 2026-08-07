from fastapi import APIRouter
from app.api.v1.routes import auth, users, wallets, cards, withdrawals, notifications, admin

api_router = APIRouter()

# Auth MUST be first — no conflicts
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(wallets.router)
api_router.include_router(cards.router)
api_router.include_router(withdrawals.router)
api_router.include_router(notifications.router)
api_router.include_router(admin.router)