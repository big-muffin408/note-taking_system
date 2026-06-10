import { createDebouncedPersister } from '../persistence.js';

describe('createDebouncedPersister', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not persist before the delay elapses', () => {
    const persistFn = jest.fn().mockResolvedValue(undefined);
    const persister = createDebouncedPersister<object>(persistFn, 1000);

    persister.schedule('doc1', {});
    jest.advanceTimersByTime(999);

    expect(persistFn).not.toHaveBeenCalled();
  });

  it('persists exactly once after the delay', () => {
    const persistFn = jest.fn().mockResolvedValue(undefined);
    const persister = createDebouncedPersister<object>(persistFn, 1000);

    persister.schedule('doc1', {});
    jest.advanceTimersByTime(1000);

    expect(persistFn).toHaveBeenCalledTimes(1);
    expect(persistFn).toHaveBeenCalledWith('doc1', {});
  });

  it('resets the timer when rescheduled', () => {
    const persistFn = jest.fn().mockResolvedValue(undefined);
    const persister = createDebouncedPersister<object>(persistFn, 1000);

    persister.schedule('doc1', {});
    jest.advanceTimersByTime(500);
    persister.schedule('doc1', {});
    jest.advanceTimersByTime(999);
    expect(persistFn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(persistFn).toHaveBeenCalledTimes(1);
  });

  it('tracks documents independently', () => {
    const persistFn = jest.fn().mockResolvedValue(undefined);
    const persister = createDebouncedPersister<object>(persistFn, 1000);

    persister.schedule('doc1', {});
    jest.advanceTimersByTime(500);
    persister.schedule('doc2', {});
    jest.advanceTimersByTime(500);

    expect(persistFn).toHaveBeenCalledTimes(1);
    expect(persistFn).toHaveBeenCalledWith('doc1', {});

    jest.advanceTimersByTime(500);
    expect(persistFn).toHaveBeenCalledTimes(2);
    expect(persistFn).toHaveBeenCalledWith('doc2', {});
  });

  it('flush persists immediately and cancels the pending timer', async () => {
    const persistFn = jest.fn().mockResolvedValue(undefined);
    const persister = createDebouncedPersister<object>(persistFn, 1000);

    persister.schedule('doc1', {});
    await persister.flush('doc1', {});

    expect(persistFn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2000);
    expect(persistFn).toHaveBeenCalledTimes(1);
  });

  it('cancelAll prevents all pending persists', () => {
    const persistFn = jest.fn().mockResolvedValue(undefined);
    const persister = createDebouncedPersister<object>(persistFn, 1000);

    persister.schedule('doc1', {});
    persister.schedule('doc2', {});
    persister.cancelAll();
    jest.advanceTimersByTime(2000);

    expect(persistFn).not.toHaveBeenCalled();
  });

  it('logs instead of throwing when persistence fails', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const persistFn = jest.fn().mockRejectedValue(new Error('mongo down'));
    const persister = createDebouncedPersister<object>(persistFn, 1000);

    persister.schedule('doc1', {});
    jest.advanceTimersByTime(1000);
    // 让被拒绝的 promise 走完 catch 分支
    await Promise.resolve();
    await Promise.resolve();

    expect(persistFn).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
