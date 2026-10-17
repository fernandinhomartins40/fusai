-- The Asaas does not create Pix charges below R$ 5,00 (D-122): raise a lower minimum.
UPDATE "Setting" SET value = '500'::jsonb, "updatedAt" = now()
 WHERE key = 'min_topup_cents' AND (value #>> '{}')::int < 500;
