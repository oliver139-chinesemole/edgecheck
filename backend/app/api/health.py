from fastapi import APIRouter
from app.config import get_settings
from app.models.schemas import HealthResponse
from app.services.seed_loader import seed_data_present
from app.services.model_manager import model_ready
from app.database import get_engine
from sqlalchemy import text

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()

    db_ok = False
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass

    return HealthResponse(
        status="ok",
        version="0.1.0",
        has_alpaca=settings.has_alpaca,
        has_fmp=settings.has_fmp,
        model_ready=model_ready(),
        seed_data_present=seed_data_present(),
        db_initialized=db_ok,
    )
