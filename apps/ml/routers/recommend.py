# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Dict, Any

router = APIRouter()

class RecommendRequest(BaseModel):
    soil:         Dict[str, float]
    climate:      Dict[str, float]
    farm_context: Dict[str, Any]

class ShapFactor(BaseModel):
    factor: str
    contribution: float

class CropRecommendation(BaseModel):
    rank:             int
    crop_id:          str
    crop_name:        str
    score:            float
    confidence:       str
    shap_drivers:     List[ShapFactor]
    shap_limiters:    List[ShapFactor]
    yield_est_t_ha:   float
    revenue_est_usd:  float
    explanation:      str

# ── Crop knowledge base (rule-based fallback) ─────────────────────────────────
CROPS = [
    {"id":"crop_maize",    "name":"Maize",    "ph":(6.2,6.8),"n":"HIGH",  "p":"MEDIUM","k":"HIGH",  "temp":(15,35),"rain":(500,800),  "yield":5.0, "price":220},
    {"id":"crop_wheat",    "name":"Wheat",    "ph":(6.0,7.5),"n":"HIGH",  "p":"MEDIUM","k":"MEDIUM","temp":(5,25), "rain":(450,650),  "yield":3.5, "price":280},
    {"id":"crop_rice",     "name":"Rice",     "ph":(5.5,6.5),"n":"HIGH",  "p":"MEDIUM","k":"HIGH",  "temp":(18,38),"rain":(1000,2000),"yield":4.5, "price":350},
    {"id":"crop_soybeans", "name":"Soybeans", "ph":(5.8,7.0),"n":"LOW",   "p":"HIGH",  "k":"MEDIUM","temp":(15,30),"rain":(450,700),  "yield":2.5, "price":480},
    {"id":"crop_tomatoes", "name":"Tomatoes", "ph":(6.0,6.8),"n":"HIGH",  "p":"HIGH",  "k":"HIGH",  "temp":(18,32),"rain":(400,600),  "yield":25.0,"price":600},
    {"id":"crop_potatoes", "name":"Potatoes", "ph":(5.0,6.0),"n":"HIGH",  "p":"HIGH",  "k":"HIGH",  "temp":(8,22), "rain":(500,700),  "yield":20.0,"price":300},
    {"id":"crop_sorghum",  "name":"Sorghum",  "ph":(5.5,7.5),"n":"MEDIUM","p":"LOW",   "k":"MEDIUM","temp":(12,38),"rain":(350,700),  "yield":3.0, "price":200},
    {"id":"crop_beans",    "name":"Beans",    "ph":(6.0,7.0),"n":"LOW",   "p":"HIGH",  "k":"MEDIUM","temp":(12,28),"rain":(300,500),  "yield":1.8, "price":700},
    {"id":"crop_cassava",  "name":"Cassava",  "ph":(5.5,7.0),"n":"LOW",   "p":"MEDIUM","k":"HIGH",  "temp":(18,35),"rain":(500,1500), "yield":15.0,"price":180},
    {"id":"crop_sunflower","name":"Sunflower","ph":(6.0,7.5),"n":"MEDIUM","p":"MEDIUM","k":"MEDIUM","temp":(10,32),"rain":(400,700),  "yield":2.0, "price":500},
    {"id":"crop_cabbage",  "name":"Cabbage",  "ph":(6.0,7.5),"n":"HIGH",  "p":"MEDIUM","k":"HIGH",  "temp":(4,20), "rain":(380,500),  "yield":30.0,"price":250},
]

N_REQ = {"HIGH": 30, "MEDIUM": 20, "LOW": 10}

def score_crop(crop: dict, soil: dict, climate: dict) -> tuple[float, list, list]:
    """Returns (score 0-100, drivers, limiters) using rule-based approach."""
    ph     = float(soil.get("ph", 6.5))
    nitro  = float(soil.get("nitrogen", 20))
    rain   = float(climate.get("rainfall_mm", 500))
    temp   = float(climate.get("temp_avg", 22))

    factors = {}

    # pH match
    ph_lo, ph_hi = crop["ph"]
    if ph_lo <= ph <= ph_hi:
        factors["pH match"] = 30.0
    else:
        gap = min(abs(ph - ph_lo), abs(ph - ph_hi))
        factors["pH match"] = max(0, 30 - gap * 10)

    # Temperature match
    t_lo, t_hi = crop["temp"]
    if t_lo <= temp <= t_hi:
        factors["temperature"] = 25.0
    else:
        gap = min(abs(temp - t_lo), abs(temp - t_hi))
        factors["temperature"] = max(0, 25 - gap * 2)

    # Rainfall match
    r_lo, r_hi = crop["rain"]
    if r_lo <= rain <= r_hi:
        factors["rainfall"] = 20.0
    else:
        gap = min(abs(rain - r_lo), abs(rain - r_hi))
        factors["rainfall"] = max(0, 20 - gap * 0.02)

    # Nitrogen
    n_need = N_REQ.get(crop["n"], 20)
    if nitro >= n_need:
        factors["nitrogen"] = 15.0
    else:
        factors["nitrogen"] = max(0, 15 * (nitro / n_need))

    # Bonus for well-adapted crops
    factors["base_suitability"] = 10.0

    total = min(100, sum(factors.values()))

    sorted_f = sorted(factors.items(), key=lambda x: -x[1])
    drivers  = [{"factor": k, "contribution": round(v, 1)} for k, v in sorted_f[:3] if v > 0]
    limiters = [{"factor": k, "contribution": round(30 - v, 1)} for k, v in sorted_f[-3:] if v < 25]

    return round(total, 1), drivers, limiters

def confidence_label(score: float) -> str:
    if score >= 80: return "HIGH"
    if score >= 60: return "MEDIUM"
    return "LOW"

def build_explanation(crop_name: str, score: float, drivers: list, limiters: list) -> str:
    driver_str = drivers[0]["factor"] if drivers else "overall conditions"
    suitability = "well-suited" if score >= 70 else "moderately suited"
    limiter_note = "No major limiting factors." if not limiters else f"Key concern: {limiters[0]['factor']}."
    return f"{crop_name} is {suitability} to your field. Strongest factor: {driver_str}. {limiter_note}"

@router.post("/crops", response_model=List[CropRecommendation])
def recommend_crops(req: RecommendRequest):
    from services.model_registry import model_registry

    results = []

    if model_registry.crop_recommender:
        # Use trained XGBoost model
        try:
            feature_vector = _build_feature_vector(req)
            probas = model_registry.crop_recommender.predict_proba([feature_vector])[0]
            for i, crop in enumerate(CROPS[:len(probas)]):
                score = round(float(probas[i]) * 100, 1)
                _, drivers, limiters = score_crop(crop, req.soil, req.climate)
                results.append(_build_rec(i + 1, crop, score, drivers, limiters))
            results.sort(key=lambda x: -x["score"])
        except Exception:
            results = _rule_based(req)
    else:
        results = _rule_based(req)

    # Return top 5
    top5 = results[:5]
    for i, r in enumerate(top5):
        r["rank"] = i + 1
    return top5

def _rule_based(req: RecommendRequest) -> list:
    scored = []
    for crop in CROPS:
        score, drivers, limiters = score_crop(crop, req.soil, req.climate)
        scored.append(_build_rec(0, crop, score, drivers, limiters))
    return sorted(scored, key=lambda x: -x["score"])

def _build_rec(rank: int, crop: dict, score: float, drivers: list, limiters: list) -> dict:
    confidence = confidence_label(score)
    explanation = build_explanation(crop["name"], score, drivers, limiters)
    yield_est = round(crop["yield"] * (score / 100) * 1.2, 1)
    revenue_est = round(yield_est * crop["price"], 0)
    return {
        "rank": rank,
        "crop_id": crop["id"],
        "crop_name": crop["name"],
        "score": score,
        "confidence": confidence,
        "shap_drivers": drivers,
        "shap_limiters": limiters,
        "yield_est_t_ha": yield_est,
        "revenue_est_usd": revenue_est,
        "explanation": explanation,
    }

def _build_feature_vector(req: RecommendRequest) -> list:
    s, c = req.soil, req.climate
    return [
        s.get("ph",0), s.get("nitrogen",0), s.get("phosphorus",0),
        s.get("potassium",0), s.get("moisture",0), s.get("ec",0),
        s.get("organic_matter",0), s.get("soil_temp",0),
        c.get("temp_avg",0), c.get("rainfall_mm",0), c.get("humidity_pct",0),
        req.farm_context.get("elevation_m", 1000),
    ]
