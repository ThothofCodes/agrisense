# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import math

router = APIRouter()

class SFSRequest(BaseModel):
    inputs: dict
    crop_id: Optional[str] = None

class SFSResponse(BaseModel):
    ph_score: int
    nitrogen_score: int
    phosphorus_score: int
    potassium_score: int
    moisture_score: int
    organic_matter_score: int
    ec_score: int
    soil_temp_score: int
    total_score: int
    interpretation: str
    om_stale: bool = False
    computed_at: str

# ── Crop-specific pH optima ───────────────────────────────────────────────────
CROP_PH = {
    "maize":    (6.2, 6.5, 6.8),
    "wheat":    (6.0, 6.5, 7.5),
    "rice":     (5.5, 6.0, 6.5),
    "soybeans": (5.8, 6.5, 7.0),
    "tomatoes": (6.0, 6.4, 6.8),
    "potatoes": (5.0, 5.5, 6.0),
    "default":  (5.5, 6.5, 7.5),
}

def score_ph(ph: float, crop: str = "default") -> int:
    lo, opt, hi = CROP_PH.get(crop.lower(), CROP_PH["default"])
    if lo <= ph <= hi:
        # Gaussian peak at optimal
        return max(0, min(100, int(100 * math.exp(-0.5 * ((ph - opt) / 0.5) ** 2))))
    elif ph < lo:
        return max(0, int(100 * (1 - (lo - ph) / lo)))
    else:
        return max(0, int(100 * (1 - (ph - hi) / hi)))

def score_linear(value: float, low: float, high: float) -> int:
    """Linear score: 100 at high, 0 at low."""
    if value >= high: return 100
    if value <= 0:    return 0
    return max(0, int(100 * (value - low) / (high - low)))

def score_moisture(pct: float) -> int:
    """Gaussian peak at 70% FC, sharp penalty below 40% (wilting point)."""
    if pct < 30:  return 0
    if pct > 95:  return max(0, int(100 * (1 - (pct - 95) / 10)))
    return max(0, min(100, int(100 * math.exp(-0.5 * ((pct - 70) / 20) ** 2))))

def score_ec(ec: float) -> int:
    """Lower EC = better. 0 = 100, 1.0 = 80, 2.0 = 40, >3.0 = 0."""
    if ec <= 0:   return 100
    if ec >= 3.0: return 0
    return max(0, int(100 - ec * 33.3))

def score_soil_temp(temp: float, base_temp: float = 10.0) -> int:
    """Penalty below crop base temp. Optimal 15-28°C for most crops."""
    if temp < base_temp:   return max(0, int(50 * (temp / base_temp)))
    if temp > 35:          return max(0, int(100 - (temp - 35) * 10))
    return min(100, int(60 + (temp - base_temp) * (40 / (28 - base_temp))))

INTERPRETATION = {
    (80, 101): "EXCELLENT",
    (60, 80):  "GOOD",
    (40, 60):  "FAIR",
    (0,  40):  "POOR",
}

def interpret(score: int) -> str:
    for (lo, hi), label in INTERPRETATION.items():
        if lo <= score < hi:
            return label
    return "POOR"

# ── WEIGHTS (audit fix §I3: all 8 params included, sum = 100%) ────────────────
WEIGHTS = {
    "ph":             0.22,
    "nitrogen":       0.18,
    "phosphorus":     0.12,
    "potassium":      0.12,
    "moisture":       0.13,
    "organic_matter": 0.08,
    "ec":             0.08,
    "soil_temp":      0.07,
}

@router.post("/compute", response_model=SFSResponse)
def compute_sfs(req: SFSRequest):
    from datetime import datetime, timezone
    inp = req.inputs
    crop = req.crop_id or "default"

    scores = {
        "ph":             score_ph(float(inp.get("ph", 6.5)), crop),
        "nitrogen":       score_linear(float(inp.get("nitrogen", 20)), 0, 40),
        "phosphorus":     score_linear(float(inp.get("phosphorus", 12)), 0, 25),
        "potassium":      score_linear(float(inp.get("potassium", 120)), 0, 200),
        "moisture":       score_moisture(float(inp.get("moisture", 60))),
        "organic_matter": score_linear(float(inp.get("organic_matter", 2.5)), 0, 5),
        "ec":             score_ec(float(inp.get("ec", 0.5))),
        "soil_temp":      score_soil_temp(float(inp.get("soil_temp", 20))),
    }

    total = int(sum(scores[k] * WEIGHTS[k] for k in scores))

    return SFSResponse(
        ph_score=scores["ph"],
        nitrogen_score=scores["nitrogen"],
        phosphorus_score=scores["phosphorus"],
        potassium_score=scores["potassium"],
        moisture_score=scores["moisture"],
        organic_matter_score=scores["organic_matter"],
        ec_score=scores["ec"],
        soil_temp_score=scores["soil_temp"],
        total_score=total,
        interpretation=interpret(total),
        computed_at=datetime.now(timezone.utc).isoformat(),
    )
