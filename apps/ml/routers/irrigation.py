# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone

router = APIRouter()

class IrrigationRequest(BaseModel):
    soil_moisture_pct:    float
    field_capacity_pct:   float = 80.0
    wilting_point_pct:    float = 30.0
    rainfall_forecast_mm: float = 0.0
    crop_name:            str   = "default"
    growth_stage:         str   = "VEGETATIVE"

class IrrigationResponse(BaseModel):
    irrigate_now:     bool
    volume_mm:        float
    next_irrigation:  str
    reason:           str

# Crop water demand factors by stage
STAGE_FACTORS = {
    "GERMINATION":   0.4,
    "EMERGENCE":     0.5,
    "VEGETATIVE":    0.7,
    "TILLERING":     0.8,
    "STEM_ELONGATION":0.9,
    "HEADING":       1.0,
    "FLOWERING":     1.15,
    "GRAIN_FILL":    1.0,
    "MATURITY":      0.7,
    "PRE_PLANTING":  0.2,
    "HARVEST":       0.1,
}

@router.post("/schedule", response_model=IrrigationResponse)
def get_schedule(req: IrrigationRequest):
    sm = req.soil_moisture_pct
    fc = req.field_capacity_pct
    wp = req.wilting_point_pct
    kc = STAGE_FACTORS.get(req.growth_stage, 0.7)

    deficit_pct = fc - sm
    available = sm - wp  # Plant-available water
    rain_covers = req.rainfall_forecast_mm > deficit_pct * 0.5

    # Trigger irrigation if deficit > 20% of FC and rain won't cover it
    irrigate = deficit_pct > 20 and not rain_covers and sm < (wp + (fc - wp) * 0.55)

    volume = max(0, round(deficit_pct * kc * 0.8, 1))

    if irrigate:
        next_dt = datetime.now(timezone.utc) + timedelta(hours=2)
        reason = (f"Soil moisture at {sm:.0f}% is below the {wp + (fc-wp)*0.55:.0f}% trigger threshold. "
                  f"Apply {volume}mm to restore field capacity. Stage factor (Kc): {kc}.")
    else:
        hours = max(12, int(available / max(kc * 0.5, 0.1)))
        next_dt = datetime.now(timezone.utc) + timedelta(hours=min(hours, 72))
        reason = (f"Soil moisture adequate at {sm:.0f}%. "
                  + (f"Forecast rain ({req.rainfall_forecast_mm}mm) will assist." if rain_covers else "Monitor daily."))

    return IrrigationResponse(
        irrigate_now=irrigate,
        volume_mm=volume,
        next_irrigation=next_dt.isoformat(),
        reason=reason,
    )
