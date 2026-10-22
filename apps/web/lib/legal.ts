/**
 * Company data shown in /termos, /privacidade and the site footer.
 * DONO: preencha os campos entre colchetes e revise os textos com o jurídico antes de publicar.
 * While `draft` is true the pages show a "Rascunho — sujeito a revisão jurídica" banner.
 */
export const legal = {
  draft: true,
  brand: 'fusai',
  companyName: '[RAZÃO SOCIAL]',
  cnpj: '[CNPJ]',
  address: '[ENDEREÇO COMPLETO]',
  supportEmail: '[EMAIL DE SUPORTE]',
  dpoName: '[NOME DO ENCARREGADO]',
  dpoEmail: '[EMAIL DO ENCARREGADO]',
  forum: '[COMARCA DO FORO]',
  updatedAt: '22/10/2026',
  /**
   * Commercial answers for the landing FAQ. A question stays hidden while its answer is
   * "[DEFINIR]", so nothing is promised before the owner decides.
   */
  faq: {
    creditsExpire: '[DEFINIR]',
    refunds: '[DEFINIR]',
  },
} as const;

/** True once the owner replaced a "[...]" placeholder with real content. */
export const isFilled = (value: string) => !/^\[.*\]$/.test(value.trim());
