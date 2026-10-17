-- Owner's decision (D-121): top-ups and packages accept any amount from R$ 0,01.
UPDATE "Setting" SET value = '1'::jsonb, "updatedAt" = now() WHERE key = 'min_topup_cents';
