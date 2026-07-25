# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

from fastapi import APIRouter
from pydantic import BaseModel
import math

# ── Anomaly Detection ──────────────────────────────────────────────────────────
router = APIRouter()

# Rolling stats cache (production: use Redis)
_stats: dict = {}

class AnomalyRequest(BaseModel):
    node_id:     str
    sensor_type: str
    value:       float

class AnomalyResponse(BaseModel):
    is_anomaly:    bool
    quality_score: int
    z_score:       float

@router.post("", response_model=AnomalyResponse)
@router.post("/detect", response_model=AnomalyResponse)
def detect_anomaly(req: AnomalyRequest):
    key = f"{req.node_id}:{req.sensor_type}"
    stats = _stats.get(key, {"n": 0, "mean": req.value, "m2": 0.0})

    # Welford online algorithm for running mean/variance
    n, mean, m2 = stats["n"] + 1, stats["mean"], stats["m2"]
    delta = req.value - mean
    mean += delta / n
    m2 += delta * (req.value - mean)
    _stats[key] = {"n": n, "mean": mean, "m2": m2}

    if n < 10:
        return AnomalyResponse(is_anomaly=False, quality_score=100, z_score=0.0)

    std = math.sqrt(m2 / n)
    z = abs(req.value - mean) / std if std > 0 else 0.0
    is_anomaly = z > 3.0
    quality_score = max(0, min(100, int(100 - (z - 1) * 15))) if z > 1 else 100

    return AnomalyResponse(is_anomaly=is_anomaly, quality_score=quality_score, z_score=round(z, 2))
