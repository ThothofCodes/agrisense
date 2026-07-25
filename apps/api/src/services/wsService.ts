/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { WsEvent, WsEventType, JwtPayload } from '../types';
import { logger } from '../utils/logger';

interface WsClient extends WebSocket {
  farmIds: Set<string>;
  userId?: string;
  isAlive: boolean;
}

let wss: WebSocketServer;
const clients = new Set<WsClient>();

export function initWebSocket(server: any) {
  wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat every 30s
  const interval = setInterval(() => {
    clients.forEach((ws) => {
      if (!ws.isAlive) { ws.terminate(); clients.delete(ws); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const client = ws as WsClient;
    client.farmIds = new Set();
    client.isAlive = true;

    // Authenticate via query param token
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    if (token) {
      try {
        const payload = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
        client.userId = payload.sub;
      } catch { /* anonymous connection */ }
    }

    clients.add(client);
    logger.debug('WS client connected', { userId: client.userId });

    client.on('pong', () => { client.isAlive = true; });

    client.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'SUBSCRIBE' && Array.isArray(msg.farm_ids)) {
          msg.farm_ids.forEach((id: string) => client.farmIds.add(id));
        }
        if (msg.type === 'UNSUBSCRIBE' && Array.isArray(msg.farm_ids)) {
          msg.farm_ids.forEach((id: string) => client.farmIds.delete(id));
        }
        if (msg.type === 'PING') {
          client.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
        }
      } catch { /* invalid message — ignore */ }
    });

    client.on('close', () => {
      clients.delete(client);
      logger.debug('WS client disconnected', { userId: client.userId });
    });

    client.on('error', (err) => {
      logger.error('WS client error', { error: err.message });
      clients.delete(client);
    });

    // Send welcome
    client.send(JSON.stringify({
      type: 'PONG',
      message: 'AgriSense WebSocket connected',
      timestamp: new Date().toISOString(),
    }));
  });

  wss.on('close', () => clearInterval(interval));
  logger.info('WebSocket server initialised');
  return wss;
}

export function wsBroadcast(farmId: string, type: WsEventType, payload: any) {
  const event: WsEvent = { type, farm_id: farmId, payload, timestamp: new Date().toISOString() };
  const msg = JSON.stringify(event);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.farmIds.has(farmId)) {
      client.send(msg);
    }
  });
}

export function wsClientCount(): number {
  return clients.size;
}
