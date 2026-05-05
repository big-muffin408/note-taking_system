import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

interface UserItem {
  id: string;
  email: string;
  displayName: string;
  role: string;
  oauthProvider?: string;
  failedLoginAttempts: number;
  lockedUntil?: string;
  createdAt: string;
}

interface ServiceStatus {
  name: string;
  status: 'ok' | 'error' | 'unreachable';
  data?: { status?: string; timestamp?: string; documents?: number; connections?: number };
}

export default function AdminPage() {
  const { token, user } = useAuth();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'users' | 'status'>('users');

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [usersRes, statusRes] = await Promise.allSettled([
        api.get<{ items: UserItem[] }>('/api/user/admin/users', token),
        api.get<{ services: ServiceStatus[] }>('/api/user/admin/system-status', token),
      ]);
      if (usersRes.status === 'fulfilled') setUsers(usersRes.value.items);
      if (statusRes.status === 'fulfilled') setServices(statusRes.value.services);
    } catch (err) {
      console.error('Failed to fetch admin data:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!token) return;
    try {
      await api.put(`/api/user/admin/users/${userId}/role`, { role: newRole }, token);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    } catch (err) {
      console.error('Failed to change role:', err);
    }
  };

  if (!user || user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>系统管理</h1>
        <div className="admin-tabs">
          <button
            className={`admin-tab${activeTab === 'users' ? ' active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            用户管理
          </button>
          <button
            className={`admin-tab${activeTab === 'status' ? ' active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            系统状态
          </button>
        </div>
      </header>

      {loading ? (
        <div className="admin-loading">加载中…</div>
      ) : activeTab === 'users' ? (
        <div className="admin-content">
          <table className="admin-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>登录方式</th>
                <th>失败次数</th>
                <th>注册时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`role-badge role-${u.role}`}>{u.role}</span>
                  </td>
                  <td>{u.oauthProvider || '邮箱'}</td>
                  <td>{u.failedLoginAttempts}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td>
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      disabled={u.id === user.id}
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-content">
          <div className="service-grid">
            {services.map((s) => (
              <div key={s.name} className={`service-card service-${s.status}`}>
                <div className="service-name">{s.name}</div>
                <div className="service-status">{s.status === 'ok' ? '正常' : s.status === 'error' ? '异常' : '不可达'}</div>
                {s.data?.documents !== undefined && (
                  <div className="service-detail">文档数: {s.data.documents}</div>
                )}
                {s.data?.connections !== undefined && (
                  <div className="service-detail">连接数: {s.data.connections}</div>
                )}
                {s.data?.timestamp && (
                  <div className="service-time">{new Date(s.data.timestamp).toLocaleTimeString('zh-CN')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
