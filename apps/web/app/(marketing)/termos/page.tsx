import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';
import { legal } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Termos de uso',
  description:
    'Regras de uso da fusai: conta, créditos pré-pagos via Pix, API, revenda e responsabilidades.',
};

export default function TermsPage() {
  return (
    <LegalPage title="Termos de uso">
      <section>
        <h2>1. Sobre estes termos</h2>
        <p>
          Estes termos regem o uso da {legal.brand}, serviço de {legal.companyName}, CNPJ{' '}
          {legal.cnpj}. Ao criar uma conta ou usar a API você concorda com eles e com a{' '}
          <Link href="/privacidade">Política de privacidade</Link>. Se usar em nome de uma empresa,
          você declara ter poderes para aceitar em nome dela.
        </p>
      </section>

      <section>
        <h2>2. O serviço</h2>
        <p>
          A {legal.brand} oferece uma API compatível com OpenAI que encaminha cada chamada a
          provedores de IA de terceiros, cobrando por token a partir de créditos pré-pagos. Também
          oferece painel, chaves de API, integração por MCP e ferramentas para que os usuários dos
          apps dos clientes comprem créditos via Pix. A disponibilidade, os modelos e os provedores
          podem mudar; quando um provedor falha, podemos encaminhar a chamada para outro.
        </p>
      </section>

      <section>
        <h2>3. Conta e segurança</h2>
        <ul>
          <li>Informe dados verdadeiros, incluindo CPF ou CNPJ, exigidos para o Pix.</li>
          <li>
            Você é responsável pelas chaves de API e por tudo o que for feito com elas. Guarde-as em
            segredo e revogue no painel qualquer chave exposta.
          </li>
          <li>
            Podemos suspender contas em caso de fraude, inadimplência, risco à segurança ou violação
            destes termos.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Créditos, preços e pagamentos</h2>
        <ul>
          <li>
            O serviço é <strong>pré-pago</strong>: o consumo é debitado dos créditos em reais e o
            saldo nunca fica negativo. Sem saldo, as chamadas são recusadas.
          </li>
          <li>
            Os preços por modelo aparecem no painel e podem mudar; a mudança vale para chamadas
            feitas depois dela. Cada chamada é cobrada pelos tokens efetivamente usados,
            arredondando para cima.
          </li>
          <li>
            Os pagamentos são feitos por Pix, processados pelo Asaas. O valor mínimo de recarga é o
            exibido no painel.
          </li>
          <li>
            Estornos e contestações de pagamento podem remover os créditos correspondentes; se os
            créditos já tiverem sido usados, a conta pode ser suspensa até a regularização.
          </li>
          <li>[Regra de validade dos créditos e de reembolso de saldo não usado — definir.]</li>
        </ul>
      </section>

      <section>
        <h2>5. Revenda para os usuários do seu app</h2>
        <p>
          Se você vende créditos aos usuários do seu app usando a {legal.brand}, você é o
          responsável perante eles: pelo preço que cobra, pelo atendimento, pelas informações sobre
          privacidade e pela base legal para tratar os dados deles. A {legal.brand} trata esses
          dados como operadora, conforme a <Link href="/privacidade">Política de privacidade</Link>.
        </p>
      </section>

      <section>
        <h2>6. Uso aceitável</h2>
        <p>É proibido usar o serviço para:</p>
        <ul>
          <li>atividades ilegais, fraude, spam ou golpes;</li>
          <li>gerar conteúdo de abuso sexual infantil, violência extrema ou discurso de ódio;</li>
          <li>
            violar direitos de terceiros ou as políticas de uso dos provedores de IA para onde as
            chamadas são encaminhadas;
          </li>
          <li>tentar burlar limites, cobranças, autenticação ou a segurança da plataforma.</li>
        </ul>
      </section>

      <section>
        <h2>7. Respostas da IA</h2>
        <p>
          As respostas são geradas por modelos de terceiros e podem conter erros. Revise antes de
          usar em decisões importantes. Você é responsável pelo uso que faz das respostas e pelo
          conteúdo que envia.
        </p>
      </section>

      <section>
        <h2>8. Limitação de responsabilidade</h2>
        <p>
          O serviço é fornecido como está. Na medida permitida em lei, a responsabilidade da{' '}
          {legal.brand} fica limitada ao valor pago pelo cliente nos [12] meses anteriores ao fato.
          [Cláusula a revisar pelo jurídico, observando o Código de Defesa do Consumidor quando
          aplicável.]
        </p>
      </section>

      <section>
        <h2>9. Encerramento</h2>
        <p>
          Você pode excluir sua conta em Configurações → Privacidade. Registros financeiros são
          mantidos pelo prazo legal. [Regra de devolução de saldo restante no encerramento —
          definir.]
        </p>
      </section>

      <section>
        <h2>10. Mudanças, lei e foro</h2>
        <p>
          Podemos alterar estes termos e avisaremos com antecedência razoável sobre mudanças
          relevantes. Aplica-se a lei brasileira; fica eleito o foro de {legal.forum}, ressalvados
          os direitos do consumidor. Contato:{' '}
          <a href={`mailto:${legal.supportEmail}`}>{legal.supportEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
