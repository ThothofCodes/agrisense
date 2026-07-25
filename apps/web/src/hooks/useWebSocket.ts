/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../store';

type WsHandler = (payload: any) => void;

export function useWebSocket(farmId: string | null, handlers: Record<string, WsHandler>) {
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const { accessToken } = useAuthStore();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (!farmId || !accessToken) return;
    const url = `${import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001/ws'}?token=${accessToken}`;
    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'SUBSCRIBE', farm_ids: [farmId] }));
    };

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        handlersRef.current[msg.type]?.(msg.payload);
      } catch { /* malformed frame */ }
    };

    socket.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 5000);
    };

    socket.onerror = () => socket.close();
  }, [farmId, accessToken]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      ws.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: object) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send };
}
