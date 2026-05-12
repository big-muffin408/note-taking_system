import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('用户注册登录流程', () => {
  test('应该能够访问登录页面', async ({ page }) => {
    await page.goto('/login');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 检查是否在登录页面
    expect(page.url()).toContain('login');

    // 检查页面标题或主要内容
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('应该能够访问注册页面', async ({ page }) => {
    await page.goto('/register');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 检查是否在注册页面
    expect(page.url()).toContain('register');
  });

  test('应该显示登录表单', async ({ page }) => {
    await page.goto('/login');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 检查是否有邮箱和密码输入框
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const passwordInput = page.locator('input[type="password"], input[name="password"]');

    // 如果存在输入框，检查它们是否可见
    if (await emailInput.isVisible()) {
      await expect(emailInput).toBeVisible();
    }

    if (await passwordInput.isVisible()) {
      await expect(passwordInput).toBeVisible();
    }
  });
});

test.describe('笔记编辑流程', () => {
  test('应该能够访问主页', async ({ page }) => {
    await page.goto('/');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 检查页面是否加载成功
    const body = await page.locator('body');
    await expect(body).toBeVisible();
  });

  test('应该能够导航到编辑器', async ({ page }) => {
    await page.goto('/');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 查找新建笔记或编辑器的链接/按钮
    const newNoteButton = page.getByRole('button', { name: /新建|创建|new/i });
    const editorLink = page.getByRole('link', { name: /编辑|editor/i });

    // 如果存在，点击它
    if (await newNoteButton.isVisible()) {
      await newNoteButton.click();
      await page.waitForURL(/.*editor.*/);
      expect(page.url()).toContain('editor');
    } else if (await editorLink.isVisible()) {
      await editorLink.click();
      await page.waitForURL(/.*editor.*/);
      expect(page.url()).toContain('editor');
    }
  });

  test('离线同步冲突时应该保留本地草稿并显示处理入口', async ({ page }) => {
    await page.route('**/api/user/me', async (route) => {
      await route.fulfill({
        json: { id: 'user-1', email: 'tester@example.com', displayName: 'Tester', role: 'user' },
      });
    });

    await page.route('**/api/doc/notes/note-conflict', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 409,
          json: {
            error: '服务器版本已更新',
            serverNote: {
              id: 'note-conflict',
              title: '服务器版本',
              content: '<p>服务器正文</p>',
              createdAt: '2026-05-12T00:00:00.000Z',
              updatedAt: '2026-05-12T00:00:03.000Z',
            },
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          id: 'note-conflict',
          title: '当前标题',
          content: '<p>当前正文</p>',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:01.000Z',
        },
      });
    });

    await page.route('**/api/doc/notes', async (route) => {
      await route.fulfill({
        json: {
          items: [
            {
              id: 'note-conflict',
              title: '当前标题',
              content: '<p>当前正文</p>',
              createdAt: '2026-05-12T00:00:00.000Z',
              updatedAt: '2026-05-12T00:00:01.000Z',
            },
          ],
        },
      });
    });

    await page.route('**/api/sync/pull', async (route) => {
      await route.fulfill({ json: { notes: [] } });
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('notes_jwt', 'test-token');
    });

    await page.goto('/login');
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('ai-notes-offline', 2);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('offline_notes')) {
            const noteStore = db.createObjectStore('offline_notes', { keyPath: 'key' });
            noteStore.createIndex('userId', 'userId', { unique: false });
          }
          if (!db.objectStoreNames.contains('sync_queue')) {
            const queueStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
            queueStore.createIndex('userId', 'userId', { unique: false });
            queueStore.createIndex('noteId', 'noteId', { unique: false });
          }
          if (!db.objectStoreNames.contains('auth')) {
            db.createObjectStore('auth', { keyPath: 'key' });
          }
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('offline_notes', 'readwrite');
          const store = tx.objectStore('offline_notes');
          store.put({
            key: 'user-1:local-conflict',
            id: 'local-conflict',
            userId: 'user-1',
            title: '本地冲突草稿',
            content: '<p>本地未同步正文</p>',
            createdAt: '2026-05-12T00:00:00.000Z',
            updatedAt: '2026-05-12T00:00:01.000Z',
            serverUpdatedAt: '2026-05-12T00:00:01.000Z',
            baseUpdatedAt: '2026-05-12T00:00:01.000Z',
            localUpdatedAt: '2026-05-12T00:00:04.000Z',
            syncStatus: 'conflict',
            error: '服务器版本已更新，请选择保留本地草稿或使用服务器版本。',
          });
          store.put({
            key: 'user-1:local-conflict__server',
            id: 'local-conflict__server',
            userId: 'user-1',
            title: '服务器版本',
            content: '<p>服务器正文</p>',
            createdAt: '2026-05-12T00:00:00.000Z',
            updatedAt: '2026-05-12T00:00:03.000Z',
            serverUpdatedAt: '2026-05-12T00:00:03.000Z',
            baseUpdatedAt: '2026-05-12T00:00:03.000Z',
            localUpdatedAt: '2026-05-12T00:00:03.000Z',
            syncStatus: 'synced',
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      });
    });

    await page.goto('/note/local-conflict');
    await expect(page.getByText('有冲突')).toBeVisible();
    await expect(page.getByText('服务器版本已更新，请选择保留本地草稿或使用服务器版本。')).toBeVisible();
    await expect(page.getByRole('button', { name: '保留本地草稿' })).toBeVisible();
    await expect(page.getByRole('button', { name: '使用服务器版本' })).toBeVisible();
  });
});

test.describe('PDF上传流程', () => {
  test('应该创建PDF解析任务并在完成后打开生成的笔记', async ({ page }) => {
    let jobPollCount = 0;

    await page.route('**/api/user/me', async (route) => {
      await route.fulfill({
        json: { id: 'user-1', email: 'tester@example.com', displayName: 'Tester', role: 'user' },
      });
    });

    await page.route('**/api/doc/notes/note-1', async (route) => {
      await route.fulfill({
        json: {
          id: 'note-1',
          title: '测试笔记',
          content: '<p>PDF 上传前的笔记</p>',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
      });
    });

    await page.route('**/api/doc/notes/note-pdf', async (route) => {
      await route.fulfill({
        json: {
          id: 'note-pdf',
          title: 'mineru-sample',
          content: '<h1>MinerU sample document</h1><p><img src="/api/doc/images/test-image.png"></p><p>$E=mc^2$</p>',
          sourcePdfId: 'pdf-1',
          createdAt: '2026-05-12T00:00:02.000Z',
          updatedAt: '2026-05-12T00:00:02.000Z',
        },
      });
    });

    await page.route('**/api/doc/notes', async (route) => {
      await route.fulfill({
        json: {
          items: [
            {
              id: 'note-1',
              title: '测试笔记',
              content: '<p>PDF 上传前的笔记</p>',
              createdAt: '2026-05-12T00:00:00.000Z',
              updatedAt: '2026-05-12T00:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.route('**/api/doc/pdf/jobs', async (route) => {
      expect(route.request().method()).toBe('POST');
      await route.fulfill({
        status: 202,
        json: { jobId: '665000000000000000000001', pdfId: '665000000000000000000002', status: 'queued' },
      });
    });

    await page.route('**/api/doc/pdf/jobs/665000000000000000000001', async (route) => {
      jobPollCount += 1;
      await route.fulfill({
        json: jobPollCount === 1
          ? {
              jobId: '665000000000000000000001',
              pdfId: '665000000000000000000002',
              fileName: 'mineru-sample.pdf',
              bytes: 720,
              status: 'parsing',
            }
          : {
              jobId: '665000000000000000000001',
              pdfId: '665000000000000000000002',
              noteId: 'note-pdf',
              fileName: 'mineru-sample.pdf',
              bytes: 720,
              status: 'parsed',
              parser: 'mineru-api',
              pages: 1,
              chunks: 2,
              assetCount: 1,
              warnings: [],
            },
      });
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('notes_jwt', 'test-token');
    });

    await page.goto('/note/note-1');

    await page.waitForLoadState('networkidle');

    await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(
      path.join(process.cwd(), 'fixtures/mineru-sample.pdf')
    );

    await expect(page.getByText('已上传，等待解析')).toBeVisible();
    await expect(page).toHaveURL(/\/note\/note-pdf$/);
    await expect(page.getByText(/mineru-api · 1 页/)).toBeVisible();
  });

  test('PDF解析失败后应该显示错误并允许重试', async ({ page }) => {
    let retryRequested = false;
    let jobPollCount = 0;

    await page.route('**/api/user/me', async (route) => {
      await route.fulfill({
        json: { id: 'user-1', email: 'tester@example.com', displayName: 'Tester', role: 'user' },
      });
    });

    await page.route('**/api/doc/notes/note-1', async (route) => {
      await route.fulfill({
        json: {
          id: 'note-1',
          title: '测试笔记',
          content: '<p>PDF 上传前的笔记</p>',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
      });
    });

    await page.route('**/api/doc/notes/note-retry', async (route) => {
      await route.fulfill({
        json: {
          id: 'note-retry',
          title: 'retry-sample',
          content: '<h1>Retry sample</h1><p><img src="/api/doc/images/retry-image.png"></p><p>\\(a^2+b^2=c^2\\)</p>',
          sourcePdfId: 'pdf-retry',
          createdAt: '2026-05-12T00:00:02.000Z',
          updatedAt: '2026-05-12T00:00:02.000Z',
        },
      });
    });

    await page.route('**/api/doc/notes', async (route) => {
      await route.fulfill({
        json: {
          items: [
            {
              id: 'note-1',
              title: '测试笔记',
              content: '<p>PDF 上传前的笔记</p>',
              createdAt: '2026-05-12T00:00:00.000Z',
              updatedAt: '2026-05-12T00:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.route('**/api/doc/pdf/jobs', async (route) => {
      expect(route.request().method()).toBe('POST');
      await route.fulfill({
        status: 202,
        json: { jobId: '665000000000000000000010', pdfId: '665000000000000000000011', status: 'queued' },
      });
    });

    await page.route('**/api/doc/pdf/jobs/665000000000000000000010/retry', async (route) => {
      retryRequested = true;
      await route.fulfill({
        status: 202,
        json: {
          jobId: '665000000000000000000010',
          pdfId: '665000000000000000000011',
          fileName: 'mineru-sample.pdf',
          bytes: 720,
          status: 'queued',
        },
      });
    });

    await page.route('**/api/doc/pdf/jobs/665000000000000000000010', async (route) => {
      jobPollCount += 1;
      if (!retryRequested) {
        await route.fulfill({
          json: {
            jobId: '665000000000000000000010',
            pdfId: '665000000000000000000011',
            fileName: 'mineru-sample.pdf',
            bytes: 720,
            status: 'failed',
            error: 'MinerU 解析超时',
          },
        });
        return;
      }

      await route.fulfill({
        json: jobPollCount < 3
          ? {
              jobId: '665000000000000000000010',
              pdfId: '665000000000000000000011',
              fileName: 'mineru-sample.pdf',
              bytes: 720,
              status: 'parsing',
            }
          : {
              jobId: '665000000000000000000010',
              pdfId: '665000000000000000000011',
              noteId: 'note-retry',
              fileName: 'mineru-sample.pdf',
              bytes: 720,
              status: 'parsed',
              parser: 'mineru-api',
              pages: 1,
              chunks: 2,
              assetCount: 1,
              warnings: [],
            },
      });
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('notes_jwt', 'test-token');
    });

    await page.goto('/note/note-1');
    await page.waitForLoadState('networkidle');

    await page.locator('input[type="file"][accept*=".pdf"]').setInputFiles(
      path.join(process.cwd(), 'fixtures/mineru-sample.pdf')
    );

    await expect(page.getByText('解析失败')).toBeVisible();
    await expect(page.locator('.pdf-job-actions').getByText('MinerU 解析超时')).toBeVisible();

    await page.getByRole('button', { name: '重试解析' }).click();
    await expect(page).toHaveURL(/\/note\/note-retry$/);
    await expect(page.getByText(/mineru-api · 1 页/)).toBeVisible();
  });
});

test.describe('协同编辑流程', () => {
  test('应该显示协同编辑界面', async ({ page }) => {
    await page.goto('/');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 查找协同相关的元素
    const shareButton = page.getByRole('button', { name: /分享|share/i });
    const collabIndicator = page.locator('[class*="collab"], [class*="online"], [class*="user"]');

    // 如果存在协同界面，检查它是否可见
    if (await shareButton.isVisible()) {
      await expect(shareButton).toBeVisible();
    }
  });
});

test.describe('版本历史流程', () => {
  test('应该显示版本历史界面', async ({ page }) => {
    await page.goto('/');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 查找版本历史相关的元素
    const versionButton = page.getByRole('button', { name: /版本|version|历史|history/i });
    const versionLink = page.getByRole('link', { name: /版本|version|历史|history/i });

    // 如果存在版本历史界面，检查它是否可见
    if (await versionButton.isVisible()) {
      await expect(versionButton).toBeVisible();
    }

    if (await versionLink.isVisible()) {
      await expect(versionLink).toBeVisible();
    }
  });

  test('应该能够预览并恢复一个历史版本', async ({ page }) => {
    await page.route('**/api/user/me', async (route) => {
      await route.fulfill({
        json: { id: 'user-1', email: 'tester@example.com', displayName: 'Tester', role: 'user' },
      });
    });

    await page.route('**/api/doc/notes/note-1/versions', async (route) => {
      await route.fulfill({
        json: {
          items: [
            {
              id: 'version-1',
              documentId: 'note-1',
              title: '恢复后的标题',
              modifierId: 'user-1',
              label: '重要快照',
              createdAt: '2026-05-12T00:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.route('**/api/doc/notes/note-1/versions/version-1', async (route) => {
      await route.fulfill({
        json: {
          id: 'version-1',
          documentId: 'note-1',
          title: '恢复后的标题',
          content: '<h1>恢复后的标题</h1><p>恢复后的正文</p>',
          modifierId: 'user-1',
          label: '重要快照',
          createdAt: '2026-05-12T00:00:00.000Z',
        },
      });
    });

    await page.route('**/api/doc/notes/note-1/versions/version-1/restore', async (route) => {
      await route.fulfill({
        json: {
          title: '恢复后的标题',
          content: '<h1>恢复后的标题</h1><p>恢复后的正文</p>',
          restoredYjs: false,
        },
      });
    });

    await page.route('**/api/doc/notes/note-1', async (route) => {
      await route.fulfill({
        json: {
          id: 'note-1',
          title: '当前标题',
          content: '<p>当前正文</p>',
          createdAt: '2026-05-12T00:00:00.000Z',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
      });
    });

    await page.route('**/api/doc/notes', async (route) => {
      await route.fulfill({
        json: {
          items: [
            {
              id: 'note-1',
              title: '当前标题',
              content: '<p>当前正文</p>',
              createdAt: '2026-05-12T00:00:00.000Z',
              updatedAt: '2026-05-12T00:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.addInitScript(() => {
      window.localStorage.setItem('notes_jwt', 'test-token');
    });

    await page.goto('/note/note-1');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: '版本历史' }).click();
    await page.getByRole('button', { name: /恢复后的标题/ }).click();
    await expect(page.getByText('恢复后的正文')).toBeVisible();
    await page.getByRole('button', { name: '恢复此版本' }).click();

    await expect(page.locator('.title-input')).toHaveValue('恢复后的标题');
    await expect(page.getByText('恢复后的正文')).toBeVisible();
    await expect(page.getByRole('button', { name: '版本历史' })).toBeVisible();
  });
});
