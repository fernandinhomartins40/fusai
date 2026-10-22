import { expect, test } from '@playwright/test';
import { waitForLink } from '../support/mail';

const PASSWORD = 'Senha-Forte-E2E-2026!';

test('cadastro → verificação → onboarding → chave → recarga', async ({ page }) => {
  const email = `e2e+${Date.now()}@example.test`;

  await test.step('cadastro', async () => {
    await page.goto('/cadastro');
    await page.getByLabel('Nome', { exact: true }).fill('Pessoa E2E');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirme a senha').fill(PASSWORD);
    await page.getByRole('button', { name: 'Criar conta' }).click();
  });

  await test.step('verificação pelo link do email', async () => {
    const verifyUrl = /https?:\/\/[^\s"<>]+\/api\/auth\/verify-email[^\s"<>]+/;
    await page.goto(await waitForLink(email, verifyUrl));
    await expect(page).toHaveURL(/verificar-email/);
  });

  await test.step('organização e projeto', async () => {
    await page.goto('/app/onboarding');
    await page.getByLabel('Nome da empresa ou organização').fill('Org E2E Ltda');
    await page.getByLabel('CPF ou CNPJ').fill('529.982.247-25');
    await page.getByLabel('Telefone').fill('(11) 99999-0000');
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByLabel('Nome do projeto').fill('App E2E');
    await page.getByRole('button', { name: 'Criar projeto' }).click();
  });

  await test.step('primeira chave aparece uma vez', async () => {
    await page.getByRole('button', { name: 'Gerar chave' }).click();
    await expect(page.getByRole('heading', { name: 'Tudo pronto!' })).toBeVisible();
    await expect(
      page.locator('code').filter({ hasText: /^fai_live_[0-9A-Za-z]{40}$/ }),
    ).toBeVisible();
  });

  await test.step('carteira abre o diálogo de recarga (sem criar Pix)', async () => {
    await page.goto('/app/carteira');
    await page.getByRole('button', { name: 'Adicionar créditos' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar créditos' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar' }).click();
    await expect(dialog).toBeHidden();
  });
});
