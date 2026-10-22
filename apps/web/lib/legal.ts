/**
 * Company data shown in /termos, /privacidade and the site footer.
 * DONO: preencha os campos entre colchetes e revise os textos com o jurídico antes de publicar.
 * While `draft` is true the pages show a "Rascunho — sujeito a revisão jurídica" banner.
 */
export const legal = {
  draft: true,
  brand: 'fusai',
  companyName: 'FUSE AGENCIA LTDA',
  cnpj: '42.761.086/0001-15',
  address: 'Rua Antonio Gregorio Ferreira, 298, Conradinho, Guarapuava/PR, CEP 85055-270',
  supportEmail: 'fernandinhomartins040@gmail.com',
  dpoName: 'Luiz Fernando Martins Oliveira',
  dpoEmail: 'fernandinhomartins040@gmail.com',
  forum: 'Guarapuava/PR',
  updatedAt: '23/10/2026',
  /**
   * Commercial answers for the landing FAQ. A question stays hidden while its answer is
   * "[DEFINIR]", so nothing is promised before the owner decides.
   */
  faq: {
    creditsExpire: 'Não. Os créditos ficam na sua conta até serem usados.',
    refunds:
      'Os créditos comprados não são reembolsáveis, exceto nos casos previstos em lei. Recarregue a partir de R$ 5,00 e acompanhe o consumo em tempo real no painel.',
  },
} as const;

/** True once the owner replaced a "[...]" placeholder with real content. */
export const isFilled = (value: string) => !/^\[.*\]$/.test(value.trim());
