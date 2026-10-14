export const billingTypeLabel = {
  PREPAID: 'Pré-pago',
  POSTPAID: 'Pós-pago',
  INTERNAL: 'Interno',
} as const;

export const orgRoleLabel = {
  OWNER: 'Dono',
  ADMIN: 'Admin',
  DEVELOPER: 'Dev',
  BILLING: 'Financeiro',
} as const;

export const billingModeLabel: Record<string, string> = {
  ORG_WALLET: 'Carteira da organização',
  END_USER_WALLET: 'Carteira do usuário final',
  HYBRID: 'Híbrido',
};
