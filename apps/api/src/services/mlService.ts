/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { SensorType, SFSResult, GDDResult, CropRecommendationItem, GrowthStage } from '../types';

interface AnomalyResult {
  is_anomaly: boolean;
  quality_score: number;
  z_score: number;
}

interface PestRiskResult {
  risk_index: number;   // 0-10
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  likely_pests: string[];
}

interface IrrigationSchedule {
  irrigate_now:   boolean;
  volume_mm:      number;
  next_irrigation: string;
  reason:         string;
}

class MLServiceClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.ml.url,
      timeout: config.ml.timeout,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async computeSFS(inputs: Record<string, number>, cropId?: string): Promise<SFSResult> {
    try {
      const { data } = await this.client.post('/sfs/compute', { inputs, crop_id: cropId });
      return data;
    } catch (err: any) {
      logger.warn('ML SFS unavailable — using fallback computation', { error: err.message });
      return fallbackSFS(inputs);
    }
  }

  async computeGDD(params: {
    tmax: number;
    tmin: number;
    base_temp: number;
    gdd_cumulative: number;
    gdd_emergence?: number;
    gdd_flowering?: number;
    gdd_maturity: number;
    planted_at?: string;
  }): Promise<GDDResult> {
    try {
      const { data } = await this.client.post('/gdd/compute', params);
      return data;
    } catch (err: any) {
      // Fallback: pure physics computation
      const gdd_daily = Math.max(0, (params.tmax + params.tmin) / 2 - params.base_temp);
      const gdd_cumulative = params.gdd_cumulative + gdd_daily;
      const pct_complete = params.gdd_maturity > 0
        ? Math.min(100, (gdd_cumulative / params.gdd_maturity) * 100)
        : 0;
      const stage = inferStage(gdd_cumulative, params);
      const days_remaining = params.gdd_maturity > gdd_cumulative
        ? Math.ceil((params.gdd_maturity - gdd_cumulative) / Math.max(gdd_daily, 1))
        : 0;
      return { gdd_daily, gdd_cumulative, current_stage: stage, days_to_harvest: days_remaining, pct_complete };
    }
  }

  async getCropRecommendations(inputs: {
    soil: Record<string, number>;
    climate: Record<string, number>;
    farm_context: Record<string, any>;
  }): Promise<CropRecommendationItem[]> {
    try {
      // BUG FIX (caught via live end-to-end testing, June 2026): the ML
      // service's /recommend/crops endpoint declares response_model=List[...]
      // and returns a bare JSON array — it was never wrapped in
      // {"recommendations": [...]}. This client was reading data.recommendations
      // (always undefined), silently returning undefined instead of throwing,
      // which then crashed downstream on .map(). Fixed to match the real
      // response shape; covered by a regression assertion in ml.test.ts.
      const { data } = await this.client.post('/recommend/crops', inputs);
      if (!Array.isArray(data)) throw new Error('Unexpected ML response shape for crop recommendations');
      return data;
    } catch (err: any) {
      logger.error('ML crop recommendation failed', { error: err.message });
      throw new Error('ML service unavailable for crop recommendations');
    }
  }

  async detectAnomaly(nodeId: string, sensorType: SensorType, value: number): Promise<AnomalyResult> {
    try {
      const { data } = await this.client.post('/anomaly/detect', { node_id: nodeId, sensor_type: sensorType, value });
      return data;
    } catch {
      return { is_anomaly: false, quality_score: 100, z_score: 0 };
    }
  }

  async getPestRisk(params: {
    temp_avg: number;
    humidity_pct: number;
    growth_stage: GrowthStage;
    crop_name: string;
  }): Promise<PestRiskResult> {
    try {
      const { data } = await this.client.post('/pest-risk', params);
      return data;
    } catch {
      return { risk_index: 0, risk_level: 'LOW', likely_pests: [] };
    }
  }

  async getIrrigationSchedule(params: {
    soil_moisture_pct: number;
    field_capacity_pct: number;
    wilting_point_pct: number;
    rainfall_forecast_mm: number;
    crop_name: string;
    growth_stage: GrowthStage;
  }): Promise<IrrigationSchedule> {
    try {
      const { data } = await this.client.post('/irrigation/schedule', params);
      return data;
    } catch {
      const deficit = params.field_capacity_pct - params.soil_moisture_pct;
      return {
        irrigate_now: deficit > 20 && params.rainfall_forecast_mm < 5,
        volume_mm: Math.max(0, deficit * 0.8),
        next_irrigation: new Date(Date.now() + 86400000).toISOString(),
        reason: 'Fallback computation — ML service unavailable',
      };
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.client.get('/health');
      return true;
    } catch {
      return false;
    }
  }
}

function inferStage(gdd: number, params: any): GrowthStage {
  if (gdd === 0) return 'PRE_PLANTING';
  if (!params.gdd_emergence || gdd < params.gdd_emergence) return 'GERMINATION';
  if (!params.gdd_flowering || gdd < params.gdd_flowering * 0.5) return 'VEGETATIVE';
  if (gdd < (params.gdd_flowering ?? params.gdd_maturity * 0.6)) return 'FLOWERING';
  if (gdd < params.gdd_maturity * 0.85) return 'GRAIN_FILL';
  if (gdd < params.gdd_maturity) return 'MATURITY';
  return 'HARVEST';
}

// ── Fallback SFS computation (mirrors Python logic in routers/sfs.py) ─────
function fallbackSFS(inputs: Record<string, number>): SFSResult {
  const ph       = inputs.ph ?? 6.5;
  const nitrogen = inputs.nitrogen ?? 20;
  const phos     = inputs.phosphorus ?? 12;
  const pot      = inputs.potassium ?? 120;
  const moisture = inputs.moisture ?? 60;
  const om       = inputs.organic_matter ?? 2.5;
  const ec       = inputs.ec ?? 0.5;
  const soilTemp = inputs.soil_temp ?? 20;

  // pH score: Gaussian peak at 6.5
  const phScore = Math.max(0, Math.min(100, Math.round(100 * Math.exp(-0.5 * ((ph - 6.5) / 0.5) ** 2))));

  // Linear scores
  const nScore = Math.max(0, Math.min(100, Math.round(100 * Math.min(1, nitrogen / 40))));
  const pScore = Math.max(0, Math.min(100, Math.round(100 * Math.min(1, phos / 25))));
  const kScore = Math.max(0, Math.min(100, Math.round(100 * Math.min(1, pot / 200))));
  const omScore = Math.max(0, Math.min(100, Math.round(100 * Math.min(1, om / 5))));

  // Moisture: Gaussian peak at 70%
  const moistScore = moisture < 30 ? 0 : moisture > 95
    ? Math.max(0, Math.round(100 * (1 - (moisture - 95) / 10)))
    : Math.max(0, Math.min(100, Math.round(100 * Math.exp(-0.5 * ((moisture - 70) / 20) ** 2))));

  // EC: lower is better
  const ecScore = ec <= 0 ? 100 : ec >= 3 ? 0 : Math.round(100 - ec * 33.3);

  // Soil temp
  const tempScore = soilTemp < 10
    ? Math.max(0, Math.round(50 * (soilTemp / 10)))
    : soilTemp > 35
      ? Math.max(0, Math.round(100 - (soilTemp - 35) * 10))
      : Math.min(100, Math.round(60 + (soilTemp - 10) * (40 / 18)));

  const weights = { ph: 0.22, n: 0.18, p: 0.12, k: 0.12, m: 0.13, om: 0.08, ec: 0.08, temp: 0.07 };

  const total = Math.round(
    phScore * weights.ph + nScore * weights.n + pScore * weights.p +
    kScore * weights.k + moistScore * weights.m + omScore * weights.om +
    ecScore * weights.ec + tempScore * weights.temp
  );

  const interpretation = total >= 80 ? 'EXCELLENT' as const : total >= 60 ? 'GOOD' as const : total >= 40 ? 'FAIR' as const : 'POOR' as const;

  return {
    ph_score: phScore, nitrogen_score: nScore, phosphorus_score: pScore,
    potassium_score: kScore, moisture_score: moistScore,
    organic_matter_score: omScore, ec_score: ecScore, soil_temp_score: tempScore,
    total_score: total, interpretation, om_stale: false,
    computed_at: new Date().toISOString(),
  };
}

export const mlService = new MLServiceClient();
