"""
Market Simulator — Game management API.
Handles: create game, join game, list games, game details, user profiles.

Authentication: pass username in X-Username header.  No passwords for MVP.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from app.database import (
    get_session,
    MsGameRecord, MsParticipantRecord, SimUserRecord,
)

logger = logging.getLogger(__name__)
router = APIRouter()

_DISCLAIMER = "Virtual money only — not financial advice — educational simulator."


# ── Helpers ───────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _today() -> str:
    return date.today().isoformat()

def _game_status(g: MsGameRecord) -> str:
    today = _today()
    if today < g.start_date:   return "pending"
    if today > g.end_date:     return "ended"
    return "active"

def _require_user(username: str | None) -> str:
    if not username or not username.strip():
        raise HTTPException(401, detail="Provide your username in the X-Username header.")
    return username.strip()

def _upsert_user(username: str, sess) -> SimUserRecord:
    """Create user record if first time seen."""
    u = sess.get(SimUserRecord, username)
    if not u:
        u = SimUserRecord(username=username, display_name=username, created_at=_now())
        sess.add(u)
        sess.commit()
    return u

def _game_to_dict(g: MsGameRecord, participant_count: int = 0) -> dict:
    return {
        "id":               g.id,
        "name":             g.name,
        "description":      g.description,
        "creator":          g.creator,
        "is_public":        bool(g.is_public),
        "starting_cash":    g.starting_cash,
        "start_date":       g.start_date,
        "end_date":         g.end_date,
        "status":           _game_status(g),
        "allow_short":      bool(g.allow_short),
        "allow_margin":     bool(g.allow_margin),
        "allow_day_trading":bool(g.allow_day_trading),
        "commission":       g.commission,
        "max_position_pct": g.max_position_pct,
        "rank_by":          g.rank_by,
        "portfolio_public": bool(g.portfolio_public),
        "allowed_assets":   json.loads(g.allowed_assets or '["stocks","etfs"]'),
        "participant_count": participant_count,
        "created_at":       g.created_at,
    }


# ── Request models ────────────────────────────────────────────────────────

class CreateGameRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    name:             str
    description:      str = ""
    is_public:        bool = True
    join_code:        Optional[str] = None
    starting_cash:    float = 100_000.0
    start_date:       str   = ""         # ISO date; defaults to today
    end_date:         str   = ""         # ISO date; defaults to +30 days
    allow_short:      bool = False
    allow_margin:     bool = False
    allow_day_trading:bool = True
    commission:       float = 0.0
    max_position_pct: float = 1.0
    rank_by:          str   = "return_pct"
    portfolio_public: bool  = True
    allowed_assets:   List[str] = ["stocks", "etfs"]


class JoinGameRequest(BaseModel):
    join_code: Optional[str] = None


class SetUsernameRequest(BaseModel):
    display_name: Optional[str] = None


# ── User endpoints ────────────────────────────────────────────────────────

@router.post("/users/me")
def upsert_me(
    req: SetUsernameRequest = SetUsernameRequest(),
    x_username: Optional[str] = Header(None),
):
    username = _require_user(x_username)
    with get_session() as sess:
        u = sess.get(SimUserRecord, username)
        if not u:
            u = SimUserRecord(
                username=username,
                display_name=req.display_name or username,
                created_at=_now(),
            )
            sess.add(u)
        elif req.display_name:
            u.display_name = req.display_name
        sess.commit()
        return {"username": u.username, "display_name": u.display_name}


@router.get("/users/me")
def get_me(x_username: Optional[str] = Header(None)):
    username = _require_user(x_username)
    with get_session() as sess:
        u = _upsert_user(username, sess)
        return {"username": u.username, "display_name": u.display_name}


# ── Game list ─────────────────────────────────────────────────────────────

@router.get("/games")
def list_games(
    q:    str = Query("", description="Search query"),
    mine: bool = Query(False),
    x_username: Optional[str] = Header(None),
):
    """List public games (or all games I'm in if mine=true)."""
    with get_session() as sess:
        if mine:
            username = _require_user(x_username)
            _upsert_user(username, sess)
            my_game_ids = [
                p.game_id for p in
                sess.query(MsParticipantRecord).filter_by(username=username).all()
            ]
            games = sess.query(MsGameRecord).filter(
                MsGameRecord.id.in_(my_game_ids)
            ).all()
        else:
            games = sess.query(MsGameRecord).filter_by(is_public=1).all()

        if q:
            ql = q.lower()
            games = [g for g in games if ql in g.name.lower() or ql in (g.description or "").lower()]

        out = []
        for g in games:
            cnt = sess.query(MsParticipantRecord).filter_by(game_id=g.id).count()
            out.append(_game_to_dict(g, cnt))
        return {"games": out}


@router.get("/games/{game_id}")
def get_game(game_id: str, x_username: Optional[str] = Header(None)):
    with get_session() as sess:
        g = sess.get(MsGameRecord, game_id)
        if not g:
            raise HTTPException(404, detail="Game not found.")
        cnt = sess.query(MsParticipantRecord).filter_by(game_id=game_id).count()
        result = _game_to_dict(g, cnt)
        # Check if caller is a participant
        if x_username:
            p = sess.query(MsParticipantRecord).filter_by(
                game_id=game_id, username=x_username.strip()
            ).first()
            result["is_participant"] = p is not None
            result["my_cash"] = p.cash if p else None
        return result


# ── Create game ───────────────────────────────────────────────────────────

@router.post("/games")
def create_game(
    req: CreateGameRequest,
    x_username: Optional[str] = Header(None),
):
    username = _require_user(x_username)

    if not req.name.strip():
        raise HTTPException(400, detail="Game name is required.")
    if req.starting_cash < 1000:
        raise HTTPException(400, detail="Starting cash must be at least $1,000.")
    if not req.is_public and not req.join_code:
        raise HTTPException(400, detail="Private games require a join code.")

    today = _today()
    start = req.start_date or today
    # default end: 30 days from start
    if not req.end_date:
        from datetime import timedelta
        end = (date.fromisoformat(start) + timedelta(days=30)).isoformat()
    else:
        end = req.end_date

    if start > end:
        raise HTTPException(400, detail="Start date must be before end date.")

    game_id = str(uuid.uuid4())[:8].upper()  # short readable ID

    with get_session() as sess:
        _upsert_user(username, sess)

        # Ensure unique ID
        while sess.get(MsGameRecord, game_id):
            game_id = str(uuid.uuid4())[:8].upper()

        g = MsGameRecord(
            id=game_id,
            name=req.name.strip(),
            description=req.description.strip(),
            creator=username,
            is_public=1 if req.is_public else 0,
            join_code=req.join_code if not req.is_public else None,
            starting_cash=req.starting_cash,
            start_date=start,
            end_date=end,
            allow_short=1 if req.allow_short else 0,
            allow_margin=1 if req.allow_margin else 0,
            allow_day_trading=1 if req.allow_day_trading else 0,
            commission=req.commission,
            max_position_pct=req.max_position_pct,
            rank_by=req.rank_by,
            portfolio_public=1 if req.portfolio_public else 0,
            allowed_assets=json.dumps(req.allowed_assets),
            created_at=_now(),
        )
        sess.add(g)

        # Creator auto-joins
        p = MsParticipantRecord(
            game_id=game_id,
            username=username,
            cash=req.starting_cash,
            joined_at=_now(),
        )
        sess.add(p)
        sess.commit()

    logger.info("Game %s created by %s", game_id, username)
    return {"game_id": game_id, "message": "Game created.", "disclaimer": _DISCLAIMER}


# ── Join game ─────────────────────────────────────────────────────────────

@router.post("/games/{game_id}/join")
def join_game(
    game_id: str,
    req: JoinGameRequest = JoinGameRequest(),
    x_username: Optional[str] = Header(None),
):
    username = _require_user(x_username)

    with get_session() as sess:
        g = sess.get(MsGameRecord, game_id)
        if not g:
            raise HTTPException(404, detail="Game not found.")

        status = _game_status(g)
        if status == "ended":
            raise HTTPException(400, detail="This game has ended — you cannot join.")

        # Private game: validate join code
        if not g.is_public:
            if not req.join_code or req.join_code.strip() != (g.join_code or ""):
                raise HTTPException(403, detail="Invalid join code.")

        # Already a participant?
        existing = sess.query(MsParticipantRecord).filter_by(
            game_id=game_id, username=username
        ).first()
        if existing:
            return {"message": "Already in this game.", "game_id": game_id}

        _upsert_user(username, sess)
        p = MsParticipantRecord(
            game_id=game_id,
            username=username,
            cash=g.starting_cash,
            joined_at=_now(),
        )
        sess.add(p)
        sess.commit()

    return {"message": "Joined successfully.", "game_id": game_id, "disclaimer": _DISCLAIMER}


# ── Leave game ────────────────────────────────────────────────────────────

@router.delete("/games/{game_id}/join")
def leave_game(game_id: str, x_username: Optional[str] = Header(None)):
    username = _require_user(x_username)
    with get_session() as sess:
        p = sess.query(MsParticipantRecord).filter_by(
            game_id=game_id, username=username
        ).first()
        if not p:
            raise HTTPException(404, detail="You are not in this game.")
        sess.delete(p)
        sess.commit()
    return {"message": "Left game."}
