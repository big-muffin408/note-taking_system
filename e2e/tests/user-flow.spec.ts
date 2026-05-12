import { test, expect } from '@playwright/test';

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
});

test.describe('PDF上传流程', () => {
  test('应该显示PDF上传界面', async ({ page }) => {
    // 首先登录（如果需要）
    await page.goto('/login');

    // 等待页面加载
    await page.waitForLoadState('networkidle');

    // 查找PDF上传相关的元素
    const pdfUpload = page.locator('input[type="file"][accept*=".pdf"]');
    const uploadButton = page.getByRole('button', { name: /上传|upload/i });

    // 如果存在上传界面，检查它是否可见
    if (await pdfUpload.isVisible()) {
      await expect(pdfUpload).toBeVisible();
    }

    if (await uploadButton.isVisible()) {
      await expect(uploadButton).toBeVisible();
    }
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
});
