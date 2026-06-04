"""
Tab D – Champion / Challenger improvement log.
A challenger is only promoted when it beats the champion out-of-sample.
The hold-out set is permanently frozen and never used for training.
"""
import logging
from fastapi import APIRouter
from app.models.schemas import ImprovementLogResponse, ChallengerResult
from app.services.model_manager import get_model_card
from app.database import get_session, RetrainLogRecord, init_db

logger = logging.getLogger(__name__)
router = APIRouter()

HOLDOUT_START = "2024-07-01"
HOLDOUT_END = "2024-12-31"

HOLDOUT_NOTE = (
    "These dates are permanently reserved for hold-out validation. "
    "No model — champion or challenger — may train on data from this window. "
    "Performance here is the only truly uncontaminated out-of-sample estimate."
)

MULTIPLE_TESTING_NOTE = (
    "Each retrain attempt is a hypothesis test. Running many challengers increases "
    "the chance of a false positive by random chance. A challenger must beat the champion "
    "by a meaningful margin (ΔSharpe > 0.15) on the hold-out set to be promoted. "
    "Promotion is rare and expected to be rare."
)


@router.get("/log", response_model=ImprovementLogResponse)
def get_improvement_log() -> ImprovementLogResponse:
    champion = get_model_card()
    challengers: list = []
    retrain_log: list = []

    # Ensure DB is initialized (handles test environments where lifespan may not fire)
    try:
        init_db()
        with get_session() as session:
            records = session.query(RetrainLogRecord).order_by(RetrainLogRecord.id.desc()).all()
            for r in records:
                challengers.append(ChallengerResult(
                    model_id=str(r.id),
                    model_type=r.model_type,
                    trained_at=r.timestamp,
                    oos_sharpe=r.oos_sharpe,
                    oos_cagr=0.0,
                    oos_max_drawdown=0.0,
                    champion_sharpe=r.champion_sharpe,
                    promoted=bool(r.promoted),
                    notes=r.notes or "",
                ))
            retrain_log = [
                {
                    "id": c.model_id,
                    "timestamp": c.trained_at,
                    "promoted": c.promoted,
                    "delta_sharpe": round(c.oos_sharpe - c.champion_sharpe, 3),
                    "notes": c.notes,
                }
                for c in challengers
            ]
    except Exception as exc:
        logger.warning("Could not load retrain log: %s", exc)

    return ImprovementLogResponse(
        champion=champion,
        challengers=challengers,
        holdout_start=HOLDOUT_START,
        holdout_end=HOLDOUT_END,
        holdout_note=HOLDOUT_NOTE,
        multiple_testing_note=MULTIPLE_TESTING_NOTE,
        retrain_log=retrain_log,
    )
