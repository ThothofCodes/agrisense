/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import mqtt, { MqttClient } from 'mqtt';
import { config } from '../config';
import { logger } from '../utils/logger';
import { dbQuery, dbQueryOne } from '../db';
import { alertService } from './alertService';
import { wsBroadcast } from './wsService';
import { SensorType } from '../types';

// Topic pattern: agrisense/{farm_id}/sensors/{node_id}/{type}
// Also handles ChirpStack LoRaWAN uplink: application/{app_id}/device/{dev_eui}/event/up
const TOPIC_AGRISENSE = 'agrisense/+/sensors/+/+';
const TOPIC_CHIRPSTACK = 'application/+/device/+/event/up';

let client: MqttClient | null = null;

export function initMqtt() {
  client = mqtt.connect({
    host:     config.mqtt.host,
    port:     config.mqtt.port,
    username: config.mqtt.username,
    password: config.mqtt.password,
    clientId: config.mqtt.clientId,
    clean:    true,
    reconnectPeriod: 5000,
    connectTimeout:  30000,
  });

  client.on('connect', () => {
    logger.info('MQTT connected');
    client!.subscribe([TOPIC_AGRISENSE, TOPIC_CHIRPSTACK], (err) => {
      if (err) logger.error('MQTT subscribe error', { error: err.message });
      else logger.info('MQTT subscribed', { topics: [TOPIC_AGRISENSE, TOPIC_CHIRPSTACK] });
    });
  });

  client.on('message', async (topic: string, payload: Buffer) => {
    try {
      if (topic.includes('/sensors/')) {
        await handleAgriSenseTopic(topic, payload);
      } else if (topic.includes('/event/up')) {
        await handleChirpStackUplink(topic, payload);
      }
    } catch (err: any) {
      logger.error('MQTT message error', { topic, error: err.message });
    }
  });

  client.on('error', (err) => logger.error('MQTT error', { error: err.message }));
  client.on('offline', () => logger.warn('MQTT offline'));
  client.on('reconnect', () => logger.info('MQTT reconnecting'));

  return client;
}

async function handleAgriSenseTopic(topic: string, payload: Buffer) {
  // agrisense/{farm_id}/sensors/{node_id}/{sensor_type}
  const parts = topic.split('/');
  if (parts.length < 5) return;
  const [, farmId, , nodeId, sensorType] = parts;

  let value: number;
  try {
    const msg = JSON.parse(payload.toString());
    value = typeof msg === 'number' ? msg : msg.value ?? msg.v;
    if (value === undefined || isNaN(value)) return;
  } catch { return; }

  await persistReading(nodeId, farmId, sensorType as SensorType, value);
}

async function handleChirpStackUplink(topic: string, payload: Buffer) {
  // ChirpStack LoRaWAN uplink — decode base64 data
  try {
    const msg = JSON.parse(payload.toString());
    const devEUI = msg.deviceInfo?.devEui;
    if (!devEUI) return;

    const node = await dbQueryOne(
      'SELECT id, farm_id FROM sensor_nodes WHERE device_id = $1',
      [devEUI]
    );
    if (!node) {
      logger.warn('MQTT uplink from unknown device', { devEUI });
      return;
    }

    // Decode base64 payload (device-specific codec)
    const raw = Buffer.from(msg.data || msg.b64, 'base64');
    const readings = decodeSensorPayload(raw);
    for (const r of readings) {
      await persistReading(node.id, node.farm_id, r.type, r.value);
    }

    // Update battery from metadata
    if (msg.rxInfo?.[0]?.snr !== undefined) {
      await dbQuery(
        'UPDATE sensor_nodes SET last_seen_at=NOW(), status=$1 WHERE id=$2',
        ['ONLINE', node.id]
      );
    }
  } catch (err: any) {
    logger.error('ChirpStack decode error', { error: err.message });
  }
}

async function persistReading(nodeId: string, farmId: string, sensorType: SensorType, value: number) {
  await dbQuery(
    `INSERT INTO sensor_readings (time, node_id, farm_id, sensor_type, value)
     VALUES (NOW(), $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [nodeId, farmId, sensorType, value]
  );
  await dbQuery(
    'UPDATE sensor_nodes SET last_seen_at=NOW(), status=$1 WHERE id=$2',
    ['ONLINE', nodeId]
  );
  wsBroadcast(farmId, 'SENSOR_UPDATE', { node_id: nodeId, sensor_type: sensorType, value, time: new Date().toISOString() });
  await alertService.checkSensorReading(farmId, sensorType, value, nodeId);
}

// Generic 2-byte-per-channel decoder (AgriSense custom protocol)
// Byte layout: [channel][type][value_hi][value_lo] × N
function decodeSensorPayload(buf: Buffer): Array<{ type: SensorType; value: number }> {
  const typeMap: Record<number, SensorType> = {
    0x01: 'SOIL_PH',
    0x02: 'SOIL_MOISTURE',
    0x03: 'NITROGEN',
    0x04: 'PHOSPHORUS',
    0x05: 'POTASSIUM',
    0x06: 'SOIL_TEMP',
    0x07: 'ELECTRICAL_CONDUCTIVITY',
    0x08: 'AMBIENT_TEMP',
    0x09: 'HUMIDITY',
    0x0A: 'RAINFALL',
  };
  const results: Array<{ type: SensorType; value: number }> = [];
  let i = 0;
  while (i + 3 < buf.length) {
    const typeCode = buf[i + 1];
    const rawValue = (buf[i + 2] << 8) | buf[i + 3];
    const sensorType = typeMap[typeCode];
    if (sensorType) {
      // Scale: pH * 100, moisture * 10, temp * 10
      const scale = [0x01, 0x06, 0x08].includes(typeCode) ? 100
                  : [0x02, 0x09].includes(typeCode) ? 10 : 1;
      results.push({ type: sensorType, value: rawValue / scale });
    }
    i += 4;
  }
  return results;
}

export function publishToFarm(farmId: string, nodeId: string, command: string, data: any) {
  if (!client) return;
  const topic = `agrisense/${farmId}/commands/${nodeId}`;
  client.publish(topic, JSON.stringify({ command, data, ts: Date.now() }), { qos: 1 });
}
