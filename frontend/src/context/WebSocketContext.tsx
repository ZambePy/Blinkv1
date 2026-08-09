import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { env } from '../config/env';

type GazeData = { x: number; y: number };

export type WebSocketActionPayload = Record<string, unknown>;

interface WebSocketContextData {
  gaze: GazeData | null;
  isConnected: boolean;
  sendAction: (action: string, payload?: WebSocketActionPayload) => void;
}

const WebSocketContext = createContext<WebSocketContextData>({
  gaze: null,
  isConnected: false,
  sendAction: () => {},
});

export const useWebSocket = () => useContext(WebSocketContext);

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;

export const WebSocketProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [gaze, setGaze] = useState<GazeData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(INITIAL_BACKOFF_MS);
  const shouldReconnectRef = useRef(true);

  useEffect(() => {
    shouldReconnectRef.current = true;

    const connect = () => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(env.wsUrl);
      } catch (e) {
        console.error('Falha ao criar WebSocket:', e);
        scheduleReconnect();
        return;
      }
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        backoffRef.current = INITIAL_BACKOFF_MS;
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'gaze') {
            // Plano B (docs/ACHADOS.md — 2026-08-09): o modelo satura
            // o eixo Y para este usuário/câmera. Enquanto isso não for
            // resolvido por retreino, forçamos o cursor à faixa
            // horizontal central para que a demo tenha uma UX
            // utilizável (fila única de botões grandes).
            const LOCK_Y_TO_CENTER = true;
            setGaze({
              x: data.nx * window.innerWidth,
              y: LOCK_Y_TO_CENTER
                ? window.innerHeight * 0.5
                : data.ny * window.innerHeight,
            });
          }
        } catch (e) {
          console.error('Erro ao parsear mensagem do WS:', e);
        }
      };

      socket.onerror = () => {
        // onclose será chamado em seguida
      };

      socket.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        if (shouldReconnectRef.current) scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const delay = backoffRef.current;
      reconnectTimer.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
        connect();
      }, delay);
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const sendAction = (action: string, payload: WebSocketActionPayload = {}) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: action, ...payload }));
    }
  };

  return (
    <WebSocketContext.Provider value={{ gaze, isConnected, sendAction }}>
      {children}
      {gaze && (
        <div
          aria-hidden="true"
          className="fixed pointer-events-none z-50 rounded-full bg-red-500 opacity-60"
          style={{
            left: gaze.x,
            top: gaze.y,
            width: '48px',
            height: '48px',
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 16px rgba(255, 0, 0, 0.9)',
            willChange: 'transform, left, top',
          }}
        />
      )}
    </WebSocketContext.Provider>
  );
};
