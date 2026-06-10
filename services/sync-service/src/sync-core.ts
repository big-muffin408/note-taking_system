import type { ObjectId } from 'mongodb';

export interface SyncChange {
  id: string;
  noteId: string;
  type: 'create' | 'update' | 'delete';
  title?: string;
  content?: string;
  createdAt?: string;
  baseUpdatedAt?: string;
}

export function serializeNote(note: Record<string, unknown>) {
  return {
    id: (note._id as ObjectId).toHexString(),
    title: note.title,
    content: note.content,
    ownerId: note.ownerId,
    sourcePdfId: note.sourcePdfId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function hasConflict(serverUpdatedAt: unknown, baseUpdatedAt: unknown) {
  if (typeof baseUpdatedAt !== 'string' || !(serverUpdatedAt instanceof Date)) {
    // Cannot determine conflict — conservatively assume conflict to prevent data loss
    return typeof baseUpdatedAt === 'string';
  }

  const baseDate = new Date(baseUpdatedAt);
  if (Number.isNaN(baseDate.getTime())) return true; // malformed baseUpdatedAt = conflict
  return serverUpdatedAt.toISOString() !== baseDate.toISOString();
}
