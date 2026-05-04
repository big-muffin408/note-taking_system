import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError) {
      setError(oauthError);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-header">
          <div className="auth-logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#4f46e5" />
              <path d="M9 10h14M9 16h10M9 22h12" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </div>
          <h1>登录</h1>
          <p className="auth-subtitle">欢迎回到 AI 协作笔记系统</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <label className="field">
          <span>邮箱</span>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>密码</span>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="输入密码"
            required
          />
        </label>

        <button id="login-submit" className="btn-primary" type="submit" disabled={submitting}>
          {submitting ? '登录中…' : '登录'}
        </button>

        <div className="auth-divider">
          <span>或</span>
        </div>

        <a className="btn-google" href="/api/user/google">
          <span className="google-mark" aria-hidden="true">G</span>
          使用 Google 登录
        </a>

        <p className="auth-footer">
          还没有账号？<Link to="/register">立即注册</Link>
        </p>
      </form>
    </div>
  );
}
