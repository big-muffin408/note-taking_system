import type { IncomingMessage } from 'node:http';
import { ObjectId, type Db } from 'mongodb';

export function getDocumentId(request: IncomingMessage) {
  const url = new URL(request.url ?? '/ws/collab/default', 'http://localhost');
  const match = url.pathname.match(/^\/ws\/collab\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export interface DocumentAccessDeps {
  getDb: () => Promise<Db>;
  userServiceUrl: string;
  internalSecret?: string;
  fetchImpl?: typeof fetch;
}

export async function checkDocumentAccess(
  userId: string,
  documentId: string,
  deps: DocumentAccessDeps,
): Promise<boolean> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const db = await deps.getDb();
    let objectId;
    try {
      objectId = new ObjectId(documentId);
    } catch {
      return false;
    }
    const doc = await db.collection('documents').findOne({ _id: objectId });
    if (!doc) return false;
    if (doc.ownerId === userId) return true;

    // Check share via user-service
    const internalHeaders: Record<string, string> = {};
    if (deps.internalSecret) internalHeaders['X-Internal-Secret'] = deps.internalSecret;
    const res = await fetchImpl(
      `${deps.userServiceUrl}/internal/check-access?userId=${encodeURIComponent(userId)}&documentId=${encodeURIComponent(documentId)}`,
      { headers: internalHeaders },
    );
    if (!res.ok) return false;
    const data = await res.json() as { access: string };
    return data.access === 'read' || data.access === 'write';
  } catch {
    return false;
  }
}
