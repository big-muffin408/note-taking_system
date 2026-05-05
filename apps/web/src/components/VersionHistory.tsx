import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface VersionItem {
  id: string;
  documentId: string;
  title: string;
  modifierId: string;
  label?: string;
  createdAt: string;
}

interface VersionDetail extends VersionItem {
  content: string;
  hasYjsUpdate?: boolean;
}

interface RestoreVersionResponse {
  content: string;
  title: string;
  restoredYjs?: boolean;
}

interface Props {
  documentId: string;
  onClose: () => void;
  onRestore: (result: RestoreVersionResponse) => void;
}

export default function VersionHistory({ documentId, onClose, onRestore }: Props) {
  const { token } = useAuth();
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<VersionDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const fetchVersions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.get<{ items: VersionItem[] }>(
        `/api/doc/notes/${documentId}/versions`,
        token,
      );
      setVersions(data.items);
    } catch (err) {
      console.error('Failed to fetch versions:', err);
    } finally {
      setLoading(false);
    }
  }, [documentId, token]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleSelect = useCallback(
    async (versionId: string) => {
      if (!token) return;
      setSelectedId(versionId);
      setPreviewLoading(true);
      try {
        const data = await api.get<VersionDetail>(
          `/api/doc/notes/${documentId}/versions/${versionId}`,
          token,
        );
        setPreview(data);
      } catch (err) {
        console.error('Failed to fetch version:', err);
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [documentId, token],
  );

  const handleRestore = useCallback(async () => {
    if (!token || !selectedId) return;
    setRestoring(true);
    try {
      const data = await api.post<RestoreVersionResponse>(
        `/api/doc/notes/${documentId}/versions/${selectedId}/restore`,
        {},
        token,
      );
      onRestore(data);
      onClose();
    } catch (err) {
      console.error('Failed to restore version:', err);
    } finally {
      setRestoring(false);
    }
  }, [documentId, selectedId, token, onRestore, onClose]);

  return (
    <div className="version-history-overlay" onClick={onClose}>
      <div className="version-history-panel" onClick={(e) => e.stopPropagation()}>
        <div className="version-history-header">
          <h2>版本历史</h2>
          <button type="button" className="version-history-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="version-history-body">
          <div className="version-list">
            {loading ? (
              <div className="version-empty">加载中…</div>
            ) : versions.length === 0 ? (
              <div className="version-empty">暂无历史版本</div>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`version-item${selectedId === v.id ? ' selected' : ''}`}
                  onClick={() => handleSelect(v.id)}
                >
                  <span className="version-item-title">{v.title || '未命名笔记'}</span>
                  <span className="version-item-time">
                    {new Date(v.createdAt).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  {v.label && <span className="version-item-label">{v.label}</span>}
                </button>
              ))
            )}
          </div>

          <div className="version-preview">
            {!selectedId ? (
              <div className="version-empty">选择一个版本查看预览</div>
            ) : previewLoading ? (
              <div className="version-empty">加载中…</div>
            ) : preview?.content ? (
              <div
                className="version-preview-content"
                dangerouslySetInnerHTML={{ __html: preview.content }}
              />
            ) : preview?.hasYjsUpdate ? (
              <div className="version-empty">这是协同编辑自动快照，可恢复后重新载入编辑器查看。</div>
            ) : (
              <div className="version-empty">无法加载版本内容</div>
            )}
          </div>
        </div>

        {selectedId && preview && (
          <div className="version-history-footer">
            <button
              type="button"
              className="btn-primary"
              onClick={handleRestore}
              disabled={restoring}
            >
              {restoring ? '恢复中…' : '恢复此版本'}
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
