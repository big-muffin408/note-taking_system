import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface ShareItem {
  id: string;
  documentId: string;
  shareeId: string;
  shareeEmail: string;
  shareeName: string;
  permission: 'read' | 'write';
  createdAt: string;
}

interface Props {
  documentId: string;
  onClose: () => void;
}

export default function ShareDialog({ documentId, onClose }: Props) {
  const { token } = useAuth();
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('write');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');

  const fetchShares = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.get<{ items: ShareItem[] }>(
        `/api/user/shares?documentId=${encodeURIComponent(documentId)}`,
        token,
      );
      setShares(data.items);
    } catch (err) {
      console.error('Failed to fetch shares:', err);
    } finally {
      setLoading(false);
    }
  }, [documentId, token]);

  useEffect(() => {
    fetchShares();
  }, [fetchShares]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !email.trim()) return;
    setInviting(true);
    setError('');
    try {
      await api.post('/api/user/shares', { documentId, email: email.trim(), permission }, token);
      setEmail('');
      await fetchShares();
    } catch (err) {
      setError(err instanceof Error ? err.message : '邀请失败');
    } finally {
      setInviting(false);
    }
  };

  const handleRevoke = async (shareId: string) => {
    if (!token) return;
    try {
      await api.del(`/api/user/shares/${shareId}`, token);
      await fetchShares();
    } catch (err) {
      console.error('Failed to revoke share:', err);
    }
  };

  return (
    <div className="share-dialog-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="share-dialog-header">
          <h2>分享笔记</h2>
          <button type="button" className="share-dialog-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <form className="share-invite-form" onSubmit={handleInvite}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="输入邮箱地址邀请…"
            required
          />
          <select value={permission} onChange={(e) => setPermission(e.target.value as 'read' | 'write')}>
            <option value="write">可编辑</option>
            <option value="read">只读</option>
          </select>
          <button type="submit" className="btn-primary" disabled={inviting}>
            {inviting ? '邀请中…' : '邀请'}
          </button>
        </form>
        {error && <p className="share-error">{error}</p>}

        <div className="share-list">
          {loading ? (
            <div className="share-empty">加载中…</div>
          ) : shares.length === 0 ? (
            <div className="share-empty">暂无协作者</div>
          ) : (
            shares.map((s) => (
              <div key={s.id} className="share-item">
                <div className="share-item-info">
                  <span className="share-item-name">{s.shareeName || s.shareeEmail}</span>
                  <span className="share-item-email">{s.shareeEmail}</span>
                  <span className={`share-item-perm share-item-perm-${s.permission}`}>
                    {s.permission === 'write' ? '可编辑' : '只读'}
                  </span>
                </div>
                <button
                  type="button"
                  className="share-item-revoke"
                  onClick={() => handleRevoke(s.id)}
                  title="撤销分享"
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
