/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import axios from 'axios';
import { config } from '../config';
import { dbQuery } from '../db';
import { WeatherCurrent, WeatherForecast } from '../types';
import { logger } from '../utils/logger';
import { redisClient } from './redisService';

const CACHE_TTL = 1800; // 30 minutes

export const weatherService = {
  async getCurrentWeather(lat: number, lon: number, farmId: string): Promise<WeatherCurrent> {
    const cacheKey = `weather:current:${farmId}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const { data } = await axios.get(`${config.weather.owmUrl}/weather`, {
        params: { lat, lon, appid: config.weather.owmKey, units: 'metric' },
        timeout: 8000,
      });

      const result: WeatherCurrent = {
        temp_max:       data.main.temp_max,
        temp_min:       data.main.temp_min,
        temp_avg:       data.main.temp,
        humidity_pct:   data.main.humidity,
        rainfall_mm:    data.rain?.['1h'] ?? 0,
        wind_speed_kmh: (data.wind?.speed ?? 0) * 3.6,
        description:    data.weather[0]?.description ?? '',
        icon:           data.weather[0]?.icon ?? '',
      };

      await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(result));
      await this.persistWeatherReading(farmId, result, false);
      return result;
    } catch (err: any) {
      logger.error('OWM current weather failed', { error: err.message });
      throw new Error('Weather service unavailable');
    }
  },

  async getForecast(lat: number, lon: number, farmId: string, days = 7): Promise<WeatherForecast[]> {
    const cacheKey = `weather:forecast:${farmId}:${days}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // ── Insight from aWhere / Climate FieldView: no single weather API is
    // ground truth. Fetch every available source, compare day-by-day, and
    // flag disagreement rather than silently trusting whichever was called
    // first. A farmer deciding whether to delay planting around a forecast
    // frost deserves to know when the models disagree, not a false-precision
    // single number. Open-Meteo added as a third, no-API-key source per
    // FEASIBILITY_STUDY_GAP_ANALYSIS.md §2.2 — genuinely additive, doesn't
    // replace either existing paid-tier source. ─────────────────────────────
    const [tomorrowDays, owmDays, openMeteoDays] = await Promise.all([
      this.fetchTomorrowIo(lat, lon, days).catch(() => null),
      this.fetchOwmForecast(lat, lon, days).catch(() => null),
      this.fetchOpenMeteo(lat, lon, days).catch(() => null),
    ]);

    const available: { name: string; data: WeatherForecast[] }[] = [];
    if (tomorrowDays)   available.push({ name: 'tomorrow.io', data: tomorrowDays });
    if (owmDays)        available.push({ name: 'openweathermap', data: owmDays });
    if (openMeteoDays)  available.push({ name: 'open-meteo', data: openMeteoDays });

    if (available.length === 0) {
      throw new Error('Weather service unavailable — no source returned data');
    }

    const sourcesUsed = available.map(a => a.name);
    const forecasts = available.length === 1
      ? available[0].data.map(f => ({ ...f, low_confidence: true }))
      : this.mergeEnsemble(available.map(a => a.data));

    await redisClient.setEx(cacheKey, CACHE_TTL * 2, JSON.stringify(forecasts));
    for (const f of forecasts) await this.persistWeatherReading(farmId, f, true, sourcesUsed);
    return forecasts;
  },

  /**
   * N-way ensemble merge with explicit disagreement flagging. Generalized
   * from the original 2-source version to support however many sources are
   * actually reachable on a given call (2 or 3 today; designed not to need
   * another rewrite if a 4th source is ever added).
   */
  mergeEnsemble(sources: WeatherForecast[][]): WeatherForecast[] {
    const [first, ...rest] = sources;
    return first.map(day => {
      const matched = rest
        .map(src => src.find(d => d.date === day.date))
        .filter((d): d is WeatherForecast => !!d);
      const all = [day, ...matched];

      if (matched.length < rest.length) {
        // Not every source had data for this date — still merge what we have,
        // but never claim full confidence on partial coverage.
      }

      const avg = (key: keyof WeatherForecast) =>
        +(all.reduce((s, d) => s + (d[key] as number), 0) / all.length).toFixed(1);
      const maxOf = (key: keyof WeatherForecast) =>
        +Math.max(...all.map(d => d[key] as number)).toFixed(1);

      const temps = all.map(d => d.temp_max);
      const tempSpread = Math.max(...temps) - Math.min(...temps);
      const rains = all.map(d => d.rainfall_mm);
      const rainSpread = Math.max(...rains) - Math.min(...rains);

      // Thresholds: >3°C max-temp disagreement or >5mm rainfall disagreement
      // across any pair of reputable forecast APIs for the SAME day/location
      // is a real signal — typically means a frontal system's timing is
      // uncertain. Also low-confidence if any source lacked this date.
      const low_confidence = tempSpread > 3 || rainSpread > 5 || matched.length < rest.length;
      const spreadPct = Math.round((tempSpread / Math.max(Math.abs(day.temp_max), 1)) * 100);

      return {
        date: day.date,
        temp_max:       avg('temp_max'),
        temp_min:       avg('temp_min'),
        temp_avg:       avg('temp_avg'),
        humidity_pct:   avg('humidity_pct'),
        rainfall_mm:    maxOf('rainfall_mm'),   // food-security bias: don't under-warn on rain
        wind_speed_kmh: maxOf('wind_speed_kmh'),
        description:    all.find(d => d.description)?.description ?? '',
        icon:           all.find(d => d.icon)?.icon ?? '',
        is_forecast:    true,
        low_confidence,
        source_spread_pct: spreadPct,
      } as WeatherForecast;
    });
  },

  async fetchOpenMeteo(lat: number, lon: number, days: number): Promise<WeatherForecast[] | null> {
    const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: lat, longitude: lon,
        daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean,weather_code',
        forecast_days: Math.min(days, 16), // Open-Meteo's own ceiling
        timezone: 'auto',
      },
      timeout: 8000,
    });
    const d = data.daily;
    if (!d?.time) return null;
    return d.time.slice(0, days).map((date: string, i: number) => ({
      date,
      temp_max:       d.temperature_2m_max[i],
      temp_min:       d.temperature_2m_min[i],
      temp_avg:       +((d.temperature_2m_max[i] + d.temperature_2m_min[i]) / 2).toFixed(1),
      humidity_pct:   d.relative_humidity_2m_mean?.[i] ?? 60,
      rainfall_mm:    d.precipitation_sum[i] ?? 0,
      wind_speed_kmh: d.wind_speed_10m_max?.[i] ?? 0,
      description: '', icon: '', is_forecast: true,
    }));
  },

  async fetchTomorrowIo(lat: number, lon: number, days: number): Promise<WeatherForecast[] | null> {
    if (!config.weather.tomorrowKey) return null;
    const { data } = await axios.get(`${config.weather.tomorrowUrl}/timelines`, {
      params: {
        location: `${lat},${lon}`,
        fields:   'temperature,temperatureMax,temperatureMin,humidity,precipitationIntensity,windSpeed',
        timesteps:'1d', units: 'metric', apikey: config.weather.tomorrowKey,
      },
      timeout: 10000,
    });
    const timeline = data.data?.timelines?.[0]?.intervals ?? [];
    return timeline.slice(0, days).map((interval: any) => ({
      date:           interval.startTime.slice(0, 10),
      temp_max:       interval.values.temperatureMax,
      temp_min:       interval.values.temperatureMin,
      temp_avg:       interval.values.temperature,
      humidity_pct:   interval.values.humidity,
      rainfall_mm:    interval.values.precipitationIntensity * 24,
      wind_speed_kmh: interval.values.windSpeed * 3.6,
      description: '', icon: '', is_forecast: true,
    }));
  },

  async fetchOwmForecast(lat: number, lon: number, days: number): Promise<WeatherForecast[] | null> {
    if (!config.weather.owmKey) return null;
    const { data } = await axios.get(`${config.weather.owmUrl}/forecast`, {
      params: { lat, lon, appid: config.weather.owmKey, units: 'metric', cnt: days * 8 },
      timeout: 8000,
    });
    const byDay: Record<string, any[]> = {};
    for (const item of data.list) {
      const day = item.dt_txt.slice(0, 10);
      (byDay[day] = byDay[day] ?? []).push(item);
    }
    return Object.entries(byDay).slice(0, days).map(([date, items]) => ({
      date,
      temp_max:       Math.max(...items.map((i: any) => i.main.temp_max)),
      temp_min:       Math.min(...items.map((i: any) => i.main.temp_min)),
      temp_avg:       items.reduce((s: number, i: any) => s + i.main.temp, 0) / items.length,
      humidity_pct:   items.reduce((s: number, i: any) => s + i.main.humidity, 0) / items.length,
      rainfall_mm:    items.reduce((s: number, i: any) => s + (i.rain?.['3h'] ?? 0), 0),
      wind_speed_kmh: Math.max(...items.map((i: any) => i.wind.speed * 3.6)),
      description:    items[4]?.weather?.[0]?.description ?? '',
      icon:           items[4]?.weather?.[0]?.icon ?? '',
      is_forecast: true,
    }));
  },

  async getNasaPower(lat: number, lon: number, startDate: string, endDate: string) {
    const cacheKey = `nasa:${lat}:${lon}:${startDate}:${endDate}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const { data } = await axios.get(config.weather.nasaPowerUrl, {
        params: {
          parameters: 'T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN',
          community: 'AG',
          longitude: lon,
          latitude:  lat,
          start:     startDate.replace(/-/g, ''),
          end:       endDate.replace(/-/g, ''),
          format:    'JSON',
        },
        timeout: 15000,
      });

      const properties = data.properties?.parameter ?? {};
      await redisClient.setEx(cacheKey, 86400, JSON.stringify(properties));
      return properties;
    } catch (err: any) {
      logger.warn('NASA POWER unavailable', { error: err.message });
      return null;
    }
  },

  async persistWeatherReading(farmId: string, w: WeatherCurrent | WeatherForecast, isForecast: boolean, sources: string[] = []) {
    const date = (w as WeatherForecast).date ?? new Date().toISOString().slice(0, 10);
    const wf = w as WeatherForecast;
    await dbQuery(
      `INSERT INTO weather_readings (time, farm_id, temp_max, temp_min, temp_avg, humidity_pct, rainfall_mm, wind_speed_kmh, is_forecast, source, sources_used, source_spread_pct, low_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
      [new Date(date), farmId, w.temp_max, w.temp_min, w.temp_avg, w.humidity_pct,
       w.rainfall_mm, w.wind_speed_kmh, isForecast, sources.join('+') || (isForecast ? 'forecast' : 'openweather'),
       sources.length ? sources : null, wf.source_spread_pct ?? null, wf.low_confidence ?? false]
    ).catch(() => {}); // Non-fatal
  },

  async getHistoricalSummary(farmId: string, days = 30) {
    return dbQuery(
      `SELECT date_trunc('day', time) AS day, AVG(temp_avg) AS temp_avg,
              SUM(rainfall_mm) AS rainfall_total, AVG(humidity_pct) AS humidity_avg
       FROM weather_readings WHERE farm_id=$1 AND is_forecast=false AND time > NOW()-($2 || ' days')::INTERVAL
       GROUP BY day ORDER BY day`,
      [farmId, days]
    );
  },
};
