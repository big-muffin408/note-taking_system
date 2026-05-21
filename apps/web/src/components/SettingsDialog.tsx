import React, { useEffect, useState } from 'react';
import { isElectron, updateElectronConfig } from '../lib/electronConfig';

interface Props {
  onClose: () => void;
}

export default function SettingsDialog({ onClose }: Props) {
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [wsBaseUrl, setWsBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.getConfig().then((cfg) => {
      setApiBaseUrl(cfg.apiBaseUrl);
      setWsBaseUrl(cfg.wsBaseUrl);
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await updateElectronConfig({ apiBaseUrl, wsBaseUrl });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!isElectron()) return null;

  return (
    <div className="share-dialog-overlay" onClick={onClose}>
      <div className="share-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="share-dialog-header">
          <h2>设置</h2>
          <button type="button" className="share-dialog-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <form onSubmit={handleSave} style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>
              后端 API 地址
            </label>
            <input
              type="url"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
              style={{
                width: '100%',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text)',
                padding: '8px 12px',
                fontSize: '0.9rem',
              }}
            />
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
              填写后端服务的基础地址，如 https://api.example.com。留空则使用默认地址。
            </p>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6, color: 'var(--color-text)' }}>
              WebSocket 地址
            </label>
            <input
              type="url"
              value={wsBaseUrl}
              onChange={(e) => setWsBaseUrl(e.target.value)}
              placeholder="wss://api.example.com/ws"
              style={{
                width: '100%',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text)',
                padding: '8px 12px',
                fontSize: '0.9rem',
              }}
            />
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
              协同编辑服务的 WebSocket 地址，如 wss://api.example.com/ws。
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '保存中…' : saved ? '已保存 ✓' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
