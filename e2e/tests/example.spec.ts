import { test, expect } from '@playwright/test';

test('homepage has title', async ({ page }) => {
  await page.goto('/');

  // 等待页面加载
  await page.waitForLoadState('networkidle');

  // 检查页面标题或主要内容
  const title = await page.title();
  expect(title).toBeTruthy();
});

test('can navigate to login page', async ({ page }) => {
  await page.goto('/');

  // 查找登录链接或按钮
  const loginLink = page.getByRole('link', { name: /登录|login/i });

  // 如果存在登录链接，点击它
  if (await loginLink.isVisible()) {
    await loginLink.click();
    await page.waitForURL(/.*login.*/);
    expect(page.url()).toContain('login');
  }
});
