# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

"""
AgriSense ML Service — pytest test suite
Run: cd apps/ml && python -m pytest tests/ -v
"""
import sys
sys.path.insert(0, '.')

import pytest
from routers.sfs import compute_sfs, SFSRequest
from routers.gdd import compute_gdd, GDDRequest
from routers.recommend import recommend_crops, RecommendRequest
from routers.anomaly import detect_anomaly, AnomalyRequest
from routers.pest import get_pest_risk, PestRequest
from routers.irrigation import get_schedule, IrrigationRequest


# ── SFS Tests ─────────────────────────────────────────────────────────────────
class TestSFS:
    def base_request(self, **overrides):
        inputs = {
            "ph": 6.5, "nitrogen": 22, "phosphorus": 14,
            "potassium": 130, "moisture": 65,
            "organic_matter": 2.8, "ec": 0.4, "soil_temp": 19,
        }
        inputs.update(overrides)
        return SFSRequest(inputs=inputs)

    def test_score_range(self):
        r = compute_sfs(self.base_request())
        assert 0 <= r.total_score <= 100

    def test_weights_sum(self):
        """Audit fix I1: all 8 params must be present and weighted."""
        r = compute_sfs(self.base_request())
        assert r.ph_score is not None
        assert r.nitrogen_score is not None
        assert r.phosphorus_score is not None
        assert r.potassium_score is not None
        assert r.moisture_score is not None
        assert r.organic_matter_score is not None
        assert r.ec_score is not None        # Was missing in v1.0
        assert r.soil_temp_score is not None  # Was missing in v1.0

    def test_excellent_soil(self):
        r = compute_sfs(self.base_request(ph=6.5, nitrogen=35, phosphorus=22, potassium=180, moisture=70))
        assert r.interpretation == "EXCELLENT"
        assert r.total_score >= 80

    def test_poor_acid_soil(self):
        r = compute_sfs(self.base_request(ph=4.2, nitrogen=5, phosphorus=3, moisture=20))
        assert r.total_score < 50
        assert r.interpretation in ("POOR", "FAIR")

    def test_high_ec_penalised(self):
        good = compute_sfs(self.base_request(ec=0.3))
        bad  = compute_sfs(self.base_request(ec=2.8))
        assert good.ec_score > bad.ec_score

    def test_extremes_dont_crash(self):
        r = compute_sfs(self.base_request(ph=0, nitrogen=0, moisture=0, soil_temp=-10))
        assert r.total_score >= 0


# ── GDD Tests ─────────────────────────────────────────────────────────────────
class TestGDD:
    def test_basic_accumulation(self):
        r = compute_gdd(GDDRequest(tmax=28, tmin=14, base_temp=10, gdd_cumulative=0, gdd_maturity=1450))
        assert r.gdd_daily == pytest.approx(11.0, abs=0.1)
        assert r.gdd_cumulative == pytest.approx(11.0, abs=0.1)

    def test_cold_day_no_negative(self):
        """GDD must never be negative."""
        r = compute_gdd(GDDRequest(tmax=8, tmin=2, base_temp=10, gdd_cumulative=400, gdd_maturity=1450))
        assert r.gdd_daily == 0.0
        assert r.gdd_cumulative == 400.0

    def test_stage_pre_planting(self):
        r = compute_gdd(GDDRequest(tmax=25, tmin=15, base_temp=10, gdd_cumulative=0, gdd_maturity=1450))
        assert r.current_stage in ("PRE_PLANTING", "GERMINATION", "VEGETATIVE")

    def test_stage_germination(self):
        r = compute_gdd(GDDRequest(tmax=25, tmin=15, base_temp=10, gdd_cumulative=30,
                                    gdd_emergence=65, gdd_maturity=1450))
        assert r.current_stage == "GERMINATION"

    def test_stage_harvest(self):
        r = compute_gdd(GDDRequest(tmax=25, tmin=15, base_temp=10, gdd_cumulative=1600, gdd_maturity=1450))
        assert r.current_stage == "HARVEST"
        assert r.days_to_harvest == 0

    def test_cassava_null_flowering_safe(self):
        """Audit fix I7: null gdd_flowering must not crash."""
        r = compute_gdd(GDDRequest(tmax=30, tmin=18, base_temp=12, gdd_cumulative=1000,
                                    gdd_flowering=None, gdd_maturity=2700))
        assert r.current_stage in ("VEGETATIVE", "GERMINATION", "GRAIN_FILL", "PRE_PLANTING")

    def test_pct_complete_bounded(self):
        r = compute_gdd(GDDRequest(tmax=35, tmin=20, base_temp=10, gdd_cumulative=2000, gdd_maturity=1450))
        assert r.pct_complete == 100.0


# ── Crop Recommendation Tests ─────────────────────────────────────────────────
class TestRecommend:
    def base_req(self):
        return RecommendRequest(
            soil={"ph": 6.5, "nitrogen": 22, "phosphorus": 14, "potassium": 130,
                  "moisture": 65, "ec": 0.4, "organic_matter": 2.8, "soil_temp": 19},
            climate={"temp_avg": 22, "rainfall_mm": 550, "humidity_pct": 65},
            farm_context={"elevation_m": 1200, "season_zone": "EAF"},
        )

    def test_returns_five_recommendations(self):
        recs = recommend_crops(self.base_req())
        assert len(recs) == 5

    def test_scores_bounded(self):
        recs = recommend_crops(self.base_req())
        for r in recs:
            assert 0 <= r["score"] <= 100

    def test_rank_ordered(self):
        recs = recommend_crops(self.base_req())
        scores = [r["score"] for r in recs]
        assert scores == sorted(scores, reverse=True)

    def test_has_shap_fields(self):
        recs = recommend_crops(self.base_req())
        assert "shap_drivers" in recs[0]
        assert "shap_limiters" in recs[0]
        assert "explanation" in recs[0]

    def test_has_economic_estimates(self):
        recs = recommend_crops(self.base_req())
        assert recs[0]["yield_est_t_ha"] > 0
        assert recs[0]["revenue_est_usd"] > 0

    def test_acid_soil_favours_acid_tolerant(self):
        """Low pH should rank potato-like crops higher."""
        acid_req = RecommendRequest(
            soil={"ph": 5.2, "nitrogen": 18, "phosphorus": 10, "potassium": 100,
                  "moisture": 60, "ec": 0.3, "organic_matter": 2.0, "soil_temp": 14},
            climate={"temp_avg": 16, "rainfall_mm": 600, "humidity_pct": 70},
            farm_context={"elevation_m": 2000},
        )
        recs = recommend_crops(acid_req)
        top_names = [r["crop_name"] for r in recs[:3]]
        acid_tolerant = {"Potatoes", "Soybeans", "Beans", "Rice"}
        assert any(n in acid_tolerant for n in top_names)


# ── Anomaly Detection Tests ────────────────────────────────────────────────────
class TestAnomaly:
    def test_normal_values_not_anomaly(self):
        """Feed 15 normal readings, last should not be anomaly."""
        for v in [6.4, 6.5, 6.3, 6.6, 6.4, 6.5, 6.4, 6.3, 6.6, 6.5, 6.4, 6.5, 6.3, 6.4, 6.5]:
            r = detect_anomaly(AnomalyRequest(node_id="test_n1", sensor_type="SOIL_PH", value=v))
        assert not r.is_anomaly

    def test_spike_detected(self):
        """After normal baseline, extreme spike should be flagged."""
        node_id = "spike_test_node"
        for v in [6.4, 6.5, 6.3, 6.6, 6.4, 6.5, 6.4, 6.3, 6.6, 6.5]:
            detect_anomaly(AnomalyRequest(node_id=node_id, sensor_type="SOIL_PH", value=v))
        r = detect_anomaly(AnomalyRequest(node_id=node_id, sensor_type="SOIL_PH", value=12.0))
        assert r.is_anomaly
        assert r.z_score > 3.0

    def test_quality_score_range(self):
        r = detect_anomaly(AnomalyRequest(node_id="q_test", sensor_type="NITROGEN", value=20))
        assert 0 <= r.quality_score <= 100

    def test_independent_per_node(self):
        """Different node IDs must have independent stats."""
        detect_anomaly(AnomalyRequest(node_id="node_X", sensor_type="SOIL_PH", value=6.5))
        detect_anomaly(AnomalyRequest(node_id="node_Y", sensor_type="SOIL_PH", value=4.0))
        r = detect_anomaly(AnomalyRequest(node_id="node_X", sensor_type="SOIL_PH", value=6.4))
        assert r.z_score < 2  # node_X has normal baseline


# ── Pest Risk Tests ────────────────────────────────────────────────────────────
class TestPest:
    def test_low_risk_conditions(self):
        r = get_pest_risk(PestRequest(temp_avg=20, humidity_pct=50,
                                      growth_stage="VEGETATIVE", crop_name="Maize"))
        assert r.risk_level in ("LOW", "MEDIUM")
        assert 0 <= r.risk_index <= 10

    def test_high_humidity_increases_risk(self):
        low  = get_pest_risk(PestRequest(temp_avg=22, humidity_pct=50, growth_stage="VEGETATIVE", crop_name="Maize"))
        high = get_pest_risk(PestRequest(temp_avg=22, humidity_pct=88, growth_stage="VEGETATIVE", crop_name="Maize"))
        assert high.risk_index >= low.risk_index

    def test_armyworm_detected_maize(self):
        r = get_pest_risk(PestRequest(temp_avg=25, humidity_pct=80,
                                      growth_stage="VEGETATIVE", crop_name="Maize"))
        assert "Armyworm" in r.likely_pests

    def test_unknown_crop_does_not_crash(self):
        r = get_pest_risk(PestRequest(temp_avg=22, humidity_pct=65,
                                      growth_stage="FLOWERING", crop_name="UnknownCrop999"))
        assert r.risk_index >= 0


# ── Irrigation Tests ──────────────────────────────────────────────────────────
class TestIrrigation:
    def test_dry_soil_triggers_irrigation(self):
        r = get_schedule(IrrigationRequest(
            soil_moisture_pct=32, field_capacity_pct=80, wilting_point_pct=30,
            rainfall_forecast_mm=0, crop_name="Maize", growth_stage="FLOWERING"))
        assert r.irrigate_now is True
        assert r.volume_mm > 0

    def test_wet_soil_no_irrigation(self):
        r = get_schedule(IrrigationRequest(
            soil_moisture_pct=78, field_capacity_pct=80, wilting_point_pct=30,
            rainfall_forecast_mm=0, crop_name="Maize", growth_stage="VEGETATIVE"))
        assert r.irrigate_now is False

    def test_rain_forecast_suppresses_irrigation(self):
        r = get_schedule(IrrigationRequest(
            soil_moisture_pct=45, field_capacity_pct=80, wilting_point_pct=30,
            rainfall_forecast_mm=40, crop_name="Beans", growth_stage="VEGETATIVE"))
        assert r.irrigate_now is False

    def test_kc_applied_at_flowering(self):
        """Flowering stage should generate higher volume than pre-planting."""
        flower = get_schedule(IrrigationRequest(
            soil_moisture_pct=50, field_capacity_pct=80, wilting_point_pct=30,
            rainfall_forecast_mm=0, crop_name="Tomatoes", growth_stage="FLOWERING"))
        preplant = get_schedule(IrrigationRequest(
            soil_moisture_pct=50, field_capacity_pct=80, wilting_point_pct=30,
            rainfall_forecast_mm=0, crop_name="Tomatoes", growth_stage="PRE_PLANTING"))
        assert flower.volume_mm >= preplant.volume_mm

    def test_schedule_returns_iso_datetime(self):
        from datetime import datetime
        r = get_schedule(IrrigationRequest(
            soil_moisture_pct=70, field_capacity_pct=80, wilting_point_pct=30,
            rainfall_forecast_mm=0, crop_name="Wheat", growth_stage="GRAIN_FILL"))
        datetime.fromisoformat(r.next_irrigation)  # Raises if invalid
