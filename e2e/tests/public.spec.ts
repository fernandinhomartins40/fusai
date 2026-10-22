import { expect, test } from '@playwright/test';

test('landing leva à documentação', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/fusai/i);
  await page.locator('a[href="/docs"]').first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Documentação' })).toBeVisible();
});

test('página da documentação abre', async ({ page }) => {
  await page.goto('/docs/chat');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main')).toContainText('/chat/completions');
});

test('termos e privacidade existem como rascunho', async ({ page }) => {
  for (const path of ['/termos', '/privacidade']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByText('Rascunho — sujeito a revisão jurídica.')).toBeVisible();
  }
});

test('rota inexistente mostra o 404 da marca', async ({ page }) => {
  const response = await page.goto('/rota-que-nao-existe-e2e');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
});

test('painel exige login', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/entrar/);
});
