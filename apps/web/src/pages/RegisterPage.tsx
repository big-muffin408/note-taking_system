import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../lib/api';

export default function RegisterPage() {
  const { register, requestVerificationCode } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function handleSendCode() {
    setError('');
    setMessage('');

    if (!email) {
      setError('请先填写邮箱');
      return;
    }

    setSendingCode(true);

    try {
      await requestVerificationCode(email);
      setMessage('验证码已发送，请查看邮箱');
      setCooldown(60);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '验证码发送失败，请稍后重试');
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    if (password.length < 6) {
      setError('密码长度至少为 6 位');
      return;
    }

    if (!verificationCode.trim()) {
      setError('请输入邮箱验证码');
      return;
    }

    setSubmitting(true);

    try {
      await register(email, displayName, password, verificationCode);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div className="brand-name">Notebook <em>by Muffin</em></div>
        </div>
        <div className="quote">
          好的笔记系统，<br />
          是思维的<em>外延</em>。
        </div>
        <div className="attrib">协作 · AI 增强 · 离线优先</div>
      </div>

      <div className="auth-form-wrap">
      <form className="auth-form" onSubmit={handleSubmit}>
        <div>
          <h1>注册</h1>
          <p className="sub">创建你的 AI 协作笔记账号</p>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {message && <div className="auth-success">{message}</div>}

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
          <span>邮箱验证码</span>
          <div className="verification-row">
            <input
              id="register-code"
              type="text"
              inputMode="numeric"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              placeholder="6 位验证码"
              required
              maxLength={6}
            />
            <button
              className="btn-secondary"
              type="button"
              onClick={handleSendCode}
              disabled={sendingCode || cooldown > 0}
            >
              {sendingCode ? '发送中…' : cooldown > 0 ? `${cooldown}s` : '发送验证码'}
            </button>
          </div>
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

        <button id="register-submit" className="btn-primary-lg" type="submit" disabled={submitting}>
          {submitting ? '注册中…' : '注册'}
        </button>

        <p className="auth-footer">
          已有账号？<Link to="/login">登录</Link>
        </p>
      </form>
      </div>
    </div>
  );
}
