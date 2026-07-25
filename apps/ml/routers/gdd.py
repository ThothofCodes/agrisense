# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import math

router = APIRouter()

class GDDRequest(BaseModel):
    tmax: float
    tmin: float
    base_temp: float
    gdd_cumulative: float
    gdd_emergence: Optional[float] = None
    gdd_flowering: Optional[float] = None
    gdd_maturity: float
    planted_at: Optional[str] = None

class GDDResponse(BaseModel):
    gdd_daily: float
    gdd_cumulative: float
    current_stage: str
    days_to_harvest: Optional[int]
    pct_complete: float

# Audit fix §I7: null-safe stage lookup — cassava has no gdd_flowering
def infer_stage(gdd: float, req: GDDRequest) -> str:
    if gdd <= 0:
        return "PRE_PLANTING"

    emergence = req.gdd_emergence
    flowering  = req.gdd_flowering  # may be None (e.g. cassava)
    maturity   = req.gdd_maturity

    if emergence and gdd < emergence:
        return "GERMINATION"

    if emergence and gdd < emergence * 1.5:
        return "EMERGENCE"

    # If no flowering stage (root crops like cassava), go straight to VEGETATIVE → MATURITY
    if flowering is None:
        if gdd < maturity * 0.5:
            return "VEGETATIVE"
        if gdd < maturity * 0.85:
            return "GRAIN_FILL"
        if gdd < maturity:
            return "MATURITY"
        return "HARVEST"

    if gdd < flowering * 0.4:
        return "VEGETATIVE"
    if gdd < flowering * 0.7:
        return "TILLERING"
    if gdd < flowering * 0.9:
        return "STEM_ELONGATION"
    if gdd < flowering:
        return "HEADING"
    if gdd < flowering * 1.1:
        return "FLOWERING"
    if gdd < maturity * 0.9:
        return "GRAIN_FILL"
    if gdd < maturity:
        return "MATURITY"
    return "HARVEST"

@router.post("/compute", response_model=GDDResponse)
def compute_gdd(req: GDDRequest):
    # Standard GDD formula — capped at 0 on the cold side
    tavg = (req.tmax + req.tmin) / 2
    gdd_daily = max(0.0, tavg - req.base_temp)

    # Upper ceiling: cap Tmax at 30°C for some crops (configurable)
    gdd_cumulative = req.gdd_cumulative + gdd_daily
    pct = min(100.0, round((gdd_cumulative / req.gdd_maturity) * 100, 1)) if req.gdd_maturity > 0 else 0.0
    stage = infer_stage(gdd_cumulative, req)

    remaining_gdd = max(0, req.gdd_maturity - gdd_cumulative)
    days_to_harvest = int(math.ceil(remaining_gdd / gdd_daily)) if gdd_daily > 0 else None

    return GDDResponse(
        gdd_daily=round(gdd_daily, 2),
        gdd_cumulative=round(gdd_cumulative, 2),
        current_stage=stage,
        days_to_harvest=days_to_harvest,
        pct_complete=pct,
    )
