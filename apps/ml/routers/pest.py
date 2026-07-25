# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

# ── Pest Risk ─────────────────────────────────────────────────────────────────
router = APIRouter()

class PestRequest(BaseModel):
    temp_avg:     float
    humidity_pct: float
    growth_stage: str
    crop_name:    str

class PestResponse(BaseModel):
    risk_index:   float
    risk_level:   str
    likely_pests: List[str]

PEST_MAP = {
    "Maize":    [("Armyworm",    lambda t, h: t > 20 and h > 70), ("Stalk borer", lambda t, h: t > 25)],
    "Wheat":    [("Aphids",      lambda t, h: t < 25 and h > 65), ("Rust",        lambda t, h: h > 80)],
    "Tomatoes": [("Whitefly",    lambda t, h: t > 28 and h < 60), ("Late blight", lambda t, h: h > 85)],
    "Beans":    [("Bean beetle", lambda t, h: t > 22),            ("Thrips",      lambda t, h: h < 50)],
    "default":  [("Aphids",      lambda t, h: h > 75)],
}

@router.post("", response_model=PestResponse)
def get_pest_risk(req: PestRequest):
    pests = PEST_MAP.get(req.crop_name, PEST_MAP["default"])
    active = [name for name, condition in pests if condition(req.temp_avg, req.humidity_pct)]

    # Risk index 0–10
    base = len(active) * 2.5
    humidity_penalty = max(0, (req.humidity_pct - 70) * 0.1)
    temp_penalty = max(0, (req.temp_avg - 28) * 0.2) if req.temp_avg > 28 else 0
    risk_index = min(10, round(base + humidity_penalty + temp_penalty, 1))

    if risk_index >= 7:    level = "CRITICAL"
    elif risk_index >= 5:  level = "HIGH"
    elif risk_index >= 3:  level = "MEDIUM"
    else:                  level = "LOW"

    return PestResponse(risk_index=risk_index, risk_level=level, likely_pests=active)
