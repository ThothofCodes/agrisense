# AgriSense Smart Farming System
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.

"""
Model Registry — loads all AgriSense ML models at startup.
Models are trained offline and serialised to /models/*.joblib.
If no trained model exists, the registry substitutes a calibrated
rule-based fallback so the API remains functional during development.
"""
import logging
import joblib
from pathlib import Path

logger = logging.getLogger(__name__)
MODELS_DIR = Path(__file__).parent.parent / "models"

class ModelRegistry:
    def __init__(self):
        self._loaded = False
        self.crop_recommender = None
        self.anomaly_detector = None
        self.pest_risk_model  = None
        self.irrigation_model = None

    def load_all(self):
        self._try_load("crop_recommender", "crop_recommender.joblib")
        self._try_load("anomaly_detector", "anomaly_detector.joblib")
        self._try_load("pest_risk_model",  "pest_risk.joblib")
        self._try_load("irrigation_model", "irrigation.joblib")
        self._loaded = True
        logger.info("Model registry ready (missing models use rule-based fallback)")

    def _try_load(self, attr: str, filename: str):
        path = MODELS_DIR / filename
        if path.exists():
            try:
                setattr(self, attr, joblib.load(path))
                logger.info(f"Loaded model: {filename}")
            except Exception as e:
                logger.warning(f"Failed to load {filename}: {e} — using fallback")
        else:
            logger.info(f"Model not found: {filename} — using rule-based fallback")

    def is_loaded(self) -> bool:
        return self._loaded

model_registry = ModelRegistry()
