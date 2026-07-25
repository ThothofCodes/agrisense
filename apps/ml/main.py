# AgriSense ML Service
# Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
# Author: Thoth of Codes
# Licensed under the MIT License — see LICENSE file in the project root.
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from routers.sfs import router as sfs_router
from routers.gdd import router as gdd_router
from routers.recommend import router as recommend_router
from routers.anomaly import router as anomaly_router
from routers.pest import router as pest_router
from routers.irrigation import router as irrigation_router
from services.model_registry import model_registry

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
logger = logging.getLogger("agrisense-ml")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Loading ML models…")
    model_registry.load_all()
    logger.info("All models loaded")
    yield
    logger.info("ML service shutting down")

app = FastAPI(
    title="AgriSense ML Service",
    version="1.0.0",
    description="Crop recommendations, GDD engine, soil scoring, anomaly detection",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sfs_router,       prefix="/sfs",        tags=["Soil Feasibility"])
app.include_router(gdd_router,       prefix="/gdd",        tags=["GDD Engine"])
app.include_router(recommend_router, prefix="/recommend",  tags=["Crop Recommendation"])
app.include_router(anomaly_router,   prefix="/anomaly",    tags=["Anomaly Detection"])
app.include_router(pest_router,      prefix="/pest-risk",  tags=["Pest Risk"])
app.include_router(irrigation_router,prefix="/irrigation", tags=["Irrigation"])

@app.get("/health")
def health():
    return {"status": "healthy", "models_loaded": model_registry.is_loaded(), "version": "1.0.0"}
