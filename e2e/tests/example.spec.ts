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
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  expect(page.url()).toContain('login');
  await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
});
