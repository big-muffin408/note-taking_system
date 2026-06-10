// 按文档去抖的持久化调度器：每次 schedule 重置该文档的计时器，flush 立即落库并取消计时
export function createDebouncedPersister<T>(
  persistFn: (documentId: string, doc: T) => Promise<void>,
  delayMs: number,
) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    schedule(documentId: string, doc: T) {
      const existing = timers.get(documentId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        timers.delete(documentId);
        persistFn(documentId, doc).catch((error) => {
          console.error(`Failed to persist collaborative document ${documentId}:`, error);
        });
      }, delayMs);

      timers.set(documentId, timer);
    },

    async flush(documentId: string, doc: T) {
      const timer = timers.get(documentId);
      if (timer) {
        clearTimeout(timer);
        timers.delete(documentId);
      }

      await persistFn(documentId, doc);
    },

    cancelAll() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
