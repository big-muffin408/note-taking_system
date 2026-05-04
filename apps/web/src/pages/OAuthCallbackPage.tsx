import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function OAuthCallbackPage() {
  const { completeOAuthLogin } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');

    if (!token) {
      setError('Google 登录回调缺少认证令牌');
      return;
    }

    completeOAuthLogin(token)
      .then(() => navigate('/', { replace: true }))
      .catch(() => setError('Google 登录完成失败，请重新登录'));
  }, [completeOAuthLogin, navigate]);

  return (
    <div className="auth-page">
      <div className="auth-card auth-callback">
        <div className="auth-loading">
          {error || '正在完成 Google 登录…'}
        </div>
      </div>
    </div>
  );
}
