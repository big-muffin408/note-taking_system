import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../lib/api';
import { isElectron } from '../lib/electronConfig';

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
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (isElectron()) {
        setError('无法连接到后端服务，请在「文件 → 设置」中检查后端地址配置');
      } else {
        setError('登录失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      {/* Left art panel */}
      <div className="auth-art">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div className="brand-name">Notebook <em>by Muffin</em></div>
        </div>
        <div className="quote">
          写作是思考的副产物。<br />
          笔记是知识的<em>复利</em>。
        </div>
        <div className="attrib">协作 · AI 增强 · 离线优先</div>
      </div>

      {/* Right form panel */}
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={handleSubmit}>
          <h1>登录</h1>
          <p className="sub">欢迎回来。继续你的笔记。</p>

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

          <button id="login-submit" className="btn-primary-lg" type="submit" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </button>

          <div className="divider-or"><span>或</span></div>

          <a className="btn-google" href="/api/user/google">
            <svg width="16" height="16" viewBox="0 0 18 18">
              <path d="M17.64 9.2a8 8 0 00-.13-1.5H9v2.84h4.84a4.14 4.14 0 01-1.8 2.71v2.26h2.92a8.8 8.8 0 002.68-6.31z" fill="#4285F4"/>
              <path d="M9 18a8.6 8.6 0 005.96-2.18l-2.92-2.26a5.4 5.4 0 01-8.04-2.83H.96v2.33A9 9 0 009 18z" fill="#34A853"/>
              <path d="M3.96 10.71a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.11l3-2.35z" fill="#FBBC05"/>
              <path d="M9 3.58a4.86 4.86 0 013.44 1.35l2.58-2.59A8.6 8.6 0 009 0 9 9 0 00.96 4.95l3 2.34A5.4 5.4 0 019 3.58z" fill="#EA4335"/>
            </svg>
            使用 Google 登录
          </a>

          <p className="auth-foot">
            还没有账号？<Link to="/register">立即注册</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
