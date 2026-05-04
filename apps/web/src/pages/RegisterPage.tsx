import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../lib/api';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码长度至少为 6 位');
      return;
    }

    setSubmitting(true);

    try {
      await register(email, displayName, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后重试');
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
          <h1>注册</h1>
          <p className="auth-subtitle">创建你的 AI 协作笔记账号</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <label className="field">
          <span>用户名</span>
          <input
            id="register-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="你的名字"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>邮箱</span>
          <input
            id="register-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
        </label>

        <label className="field">
          <span>密码</span>
          <input
            id="register-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="至少 6 位"
            required
            minLength={6}
          />
        </label>

        <label className="field">
          <span>确认密码</span>
          <input
            id="register-confirm"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次输入密码"
            required
          />
        </label>

        <button id="register-submit" className="btn-primary" type="submit" disabled={submitting}>
          {submitting ? '注册中…' : '注册'}
        </button>

        <p className="auth-footer">
          已有账号？<Link to="/login">登录</Link>
        </p>
      </form>
    </div>
  );
}
