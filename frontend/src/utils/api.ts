import { env } from '../config/env';

const API_BASE = env.apiUrl;
const DEFAULT_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

interface ApiFetchOptions extends Omit<RequestInit, 'signal'> {
  timeoutMs?: number;
  retries?: number;
  authToken?: string | null;
}

async function readError(res: Response): Promise<unknown> {
  try {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return await res.json();
    return await res.text();
  } catch {
    return null;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, authToken, headers, ...init }: ApiFetchOptions = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const finalHeaders: Record<string, string> = {
    ...(headers as Record<string, string> | undefined),
  };
  if (authToken) finalHeaders.Authorization = `Bearer ${authToken}`;

  try {
    const res = await fetch(url, { ...init, headers: finalHeaders, signal: controller.signal });
    if (!res.ok) {
      const body = await readError(res);
      throw new ApiError(res.status, `HTTP ${res.status} em ${url}`, body);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (res.status === 204 || !ct) return undefined as T;
    if (ct.includes('application/json')) return (await res.json()) as T;
    return (await res.text()) as unknown as T;
  } catch (err) {
    if (retries > 0 && !(err instanceof ApiError && err.status < 500)) {
      return apiFetch<T>(path, { timeoutMs, retries: retries - 1, authToken, headers, ...init });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export interface ChatbotMessageRequest {
  text: string;
  userId?: string;
}
export interface ChatbotMessageResponse {
  reply: string;
}

export const api = {
  cloneVoice: (audioFile: File, userId: string) => {
    const form = new FormData();
    form.append('file', audioFile);
    form.append('user_id', userId);
    return apiFetch<{ task_id: string }>('/voice/clone', { method: 'POST', body: form });
  },

  voiceStatus: (taskId: string) =>
    apiFetch<{ status: 'pending' | 'ready' | 'error'; voice_profile_id?: string }>(
      `/voice/status/${taskId}`
    ),

  synthesize: (text: string, voiceProfileId?: string) =>
    apiFetch<Blob | { url: string }>('/voice/synthesize', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ text, voice_profile_id: voiceProfileId }),
    }),

  sendHelpAlert: (userId: string) =>
    apiFetch<{ ok: boolean }>('/alerts/help', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        user_id: userId,
        timestamp: new Date().toISOString(),
        priority: 'high',
      }),
    }),

  smartHomeAction: (device: string, action: string) =>
    apiFetch<{ ok: boolean }>('/smart-home/action', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ device, action }),
    }),

  chatbotMessage: (body: ChatbotMessageRequest) =>
    apiFetch<ChatbotMessageResponse>('/chatbot/message', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
      timeoutMs: 20_000,
    }),

  sendIAmOk: (userId: string) =>
    apiFetch<{ ok: boolean }>('/alerts/iamok', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ user_id: userId, timestamp: new Date().toISOString() }),
    }),
};
