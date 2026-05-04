import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  requestVerificationCode: (email: string) => Promise<void>;
  register: (email: string, displayName: string, password: string, verificationCode: string) => Promise<void>;
  completeOAuthLogin: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'notes_jwt';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(!!token);

  // Restore session on mount
  useEffect(() => {
    if (!token) return;

    api
      .get<User>('/api/user/me', token)
      .then((u) => setUser(u))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>(
      '/api/user/login',
      { email, password }
    );
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }, []);

  const requestVerificationCode = useCallback(async (email: string) => {
    await api.post<{ message: string }>(
      '/api/user/verification-code',
      { email }
    );
  }, []);

  const register = useCallback(
    async (email: string, displayName: string, password: string, verificationCode: string) => {
      const data = await api.post<{ token: string; user: User }>(
        '/api/user/register',
        { email, displayName, password, verificationCode }
      );
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser(data.user);
    },
    []
  );

  const completeOAuthLogin = useCallback(async (nextToken: string) => {
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    const currentUser = await api.get<User>('/api/user/me', nextToken);
    setUser(currentUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, requestVerificationCode, register, completeOAuthLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
