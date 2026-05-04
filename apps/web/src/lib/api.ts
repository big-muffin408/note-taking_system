const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>)
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `请求失败 (${res.status})`, res.status);
  }

  return res.json();
}

export const api = {
  get<T>(path: string, token?: string | null) {
    return request<T>(path, { method: 'GET' }, token);
  },

  post<T>(path: string, body: unknown, token?: string | null) {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) }, token);
  },

  put<T>(path: string, body: unknown, token?: string | null) {
    return request<T>(path, { method: 'PUT', body: JSON.stringify(body) }, token);
  },

  del<T>(path: string, token?: string | null) {
    return request<T>(path, { method: 'DELETE' }, token);
  },

  postForm<T>(path: string, body: FormData, token?: string | null) {
    return request<T>(path, { method: 'POST', body }, token);
  }
};

export interface SseCallbacks {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMeta?: (meta: Record<string, any>) => void;
  onChunk: (chunk: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDone: (result: Record<string, any>) => void;
  onError?: (err: Error) => void;
}

/**
 * Stream an AI request as SSE.
 * The server should accept ?stream=true and respond with SSE events:
 *   event: meta  → metadata JSON
 *   event: chunk → { chunk: "..." }
 *   event: done  → { content: "..." }
 */
export async function streamAI(
  path: string,
  body: unknown,
  callbacks: SseCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}?stream=true`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!res.ok || !res.body) {
    callbacks.onError?.(new ApiError(`AI 请求失败 (${res.status})`, res.status));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      let currentEvent = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          try {
            const parsed = JSON.parse(data);
            if (currentEvent === 'meta') {
              callbacks.onMeta?.(parsed);
            } else if (currentEvent === 'chunk') {
              callbacks.onChunk(parsed.chunk ?? '');
            } else if (currentEvent === 'done') {
              callbacks.onDone(parsed);
            }
          } catch {
            // ignore malformed JSON
          }
          currentEvent = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
