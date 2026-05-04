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
