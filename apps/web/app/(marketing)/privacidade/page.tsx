import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';
import { legal } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Política de privacidade',
  description:
    'Como a fusai trata dados pessoais: o que coleta, para quê, com quem compartilha e seus direitos.',
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de privacidade">
      <section>
        <h2>1. Quem somos</h2>
        <p>
          A {legal.brand} é um gateway de inteligência artificial operado por {legal.companyName},
          CNPJ {legal.cnpj}, com sede em {legal.address}. Esta política explica como tratamos dados
          pessoais no site, no painel e na API.
        </p>
        <p>
          Encarregado pelo tratamento de dados (DPO): {legal.dpoName} —{' '}
          <a href={`mailto:${legal.dpoEmail}`}>{legal.dpoEmail}</a>.
        </p>
      </section>

      <section>
        <h2>2. Nosso papel em cada caso</h2>
        <ul>
          <li>
            <strong>Clientes e equipes</strong> (quem cria conta no painel): a {legal.brand} é{' '}
            <strong>controladora</strong> dos dados da conta.
          </li>
          <li>
            <strong>Usuários finais dos apps dos clientes</strong> (pessoas que usam o app de um
            cliente e compram créditos por Pix): o cliente é o controlador e a {legal.brand} atua
            como <strong>operadora</strong>, tratando os dados conforme as instruções do cliente.
            Pedidos desses titulares devem ser feitos primeiro ao app do cliente.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Dados que tratamos</h2>
        <ul>
          <li>
            <strong>Conta:</strong> nome, email, senha (guardada só como hash), foto de perfil
            quando o login é pelo Google, endereço IP e navegador das sessões.
          </li>
          <li>
            <strong>Organização:</strong> nome, CPF ou CNPJ e telefone, exigidos para emitir
            cobranças Pix.
          </li>
          <li>
            <strong>Equipe:</strong> email das pessoas convidadas.
          </li>
          <li>
            <strong>Usuários finais:</strong> identificador definido pelo cliente e, quando o
            cliente envia, nome, email e CPF (exigido para alguns pagamentos Pix); saldo, histórico
            de créditos e de consumo.
          </li>
          <li>
            <strong>Pagamentos:</strong> valor, status e datas; dados do pagador recebidos do
            provedor de pagamento.
          </li>
          <li>
            <strong>Uso da API:</strong> modelo usado, quantidade de tokens, custo, tempo de
            resposta e status de cada chamada.
          </li>
          <li>
            <strong>Segurança e auditoria:</strong> ações administrativas, com data e IP.
          </li>
        </ul>
        <p>
          <strong>Conteúdo das conversas:</strong> as mensagens enviadas à API (prompts) e as
          respostas da IA são repassadas ao provedor de IA escolhido para gerar a resposta. A{' '}
          {legal.brand} <strong>não grava</strong> esse conteúdo no banco de dados nem nos logs:
          guarda apenas os números de uso descritos acima. Evite enviar dados sensíveis nas
          mensagens.
        </p>
      </section>

      <section>
        <h2>4. Para que usamos e com qual base legal</h2>
        <ul>
          <li>
            Criar e manter a conta, autenticar, prestar o serviço e cobrar pelo uso — execução de
            contrato (LGPD, art. 7º, V).
          </li>
          <li>
            Emitir cobranças Pix, guardar registros financeiros e fiscais — cumprimento de obrigação
            legal ou regulatória (art. 7º, II).
          </li>
          <li>
            Prevenir fraude e abuso, proteger contas (limites de tentativas, registros de acesso e
            auditoria) — legítimo interesse (art. 7º, IX) e obrigação legal de guarda de registros
            de acesso (Marco Civil da Internet, art. 15).
          </li>
          <li>
            Enviar emails de serviço (confirmação de email, redefinição de senha, convites,
            pagamentos e avisos de saldo) — execução de contrato.
          </li>
        </ul>
        <p>
          Não vendemos dados pessoais e não usamos o conteúdo das conversas para treinar modelos.
        </p>
      </section>

      <section>
        <h2>5. Com quem compartilhamos</h2>
        <ul>
          <li>
            <strong>Asaas</strong> (instituição de pagamento): nome, CPF/CNPJ e email do pagador
            para gerar e confirmar o Pix.
          </li>
          <li>
            <strong>Provedores de IA</strong> (por exemplo DeepSeek, Moonshot/Kimi, Zhipu/GLM,
            Alibaba/Qwen, MiniMax e OpenRouter): recebem o conteúdo das mensagens de cada chamada.
            Vários deles ficam{' '}
            <strong>fora do Brasil, inclusive na China e nos Estados Unidos</strong>, o que
            caracteriza transferência internacional de dados (LGPD, art. 33). Cada provedor tem suas
            próprias regras de retenção.
          </li>
          <li>
            <strong>Envio de email</strong> (VeloMail ou servidor SMTP): nome e email para entregar
            mensagens de serviço.
          </li>
          <li>
            <strong>Hospedagem</strong> (Hostinger, servidores da aplicação e banco de dados).
          </li>
          <li>
            <strong>Google</strong>, apenas se você escolher entrar com a conta Google.
          </li>
          <li>Autoridades públicas, quando houver obrigação legal ou ordem judicial.</li>
        </ul>
      </section>

      <section>
        <h2>6. Por quanto tempo guardamos</h2>
        <p>
          Dados da conta ficam guardados enquanto a conta existir. Registros de pagamento e de
          movimentação de créditos são mantidos pelo prazo exigido pela legislação fiscal e
          contábil, mesmo após a exclusão da conta, mas desvinculados do seu nome e email. Registros
          de acesso são mantidos por no mínimo 6 meses (Marco Civil da Internet). Os demais prazos
          de retenção de logs estão em definição.
        </p>
      </section>

      <section>
        <h2>7. Seus direitos</h2>
        <p>
          Você pode pedir confirmação do tratamento, acesso, correção, portabilidade, anonimização
          ou exclusão, informações sobre compartilhamento e revisão de decisões automatizadas (LGPD,
          art. 18). No painel, em <Link href="/app/configuracoes">Configurações → Privacidade</Link>
          , você pode:
        </p>
        <ul>
          <li>
            <strong>Exportar seus dados</strong> em um arquivo JSON;
          </li>
          <li>
            <strong>Excluir sua conta</strong>: a exclusão acontece 7 dias depois do pedido, prazo
            em que você pode cancelar. Se você for o único dono de uma organização com saldo ou Pix
            pendente, é preciso resolver isso antes.
          </li>
        </ul>
        <p>
          Outros pedidos: <a href={`mailto:${legal.dpoEmail}`}>{legal.dpoEmail}</a>. Você também
          pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </section>

      <section>
        <h2>8. Cookies e armazenamento no navegador</h2>
        <ul>
          <li>Cookie de sessão, necessário para manter você conectado (até 30 dias).</li>
          <li>Cookie com a organização escolhida no painel.</li>
          <li>
            Armazenamento local do navegador para o tema (claro/escuro) e, se você marcar, o email
            usado no login.
          </li>
        </ul>
        <p>Não usamos cookies de publicidade nem ferramentas de rastreamento de terceiros.</p>
      </section>

      <section>
        <h2>9. Segurança</h2>
        <p>
          Usamos conexão criptografada (HTTPS), senhas guardadas como hash, chaves de API guardadas
          apenas como hash, chaves dos provedores criptografadas, limites de tentativas de login e
          registros de auditoria. Nenhum sistema é totalmente imune a incidentes; se ocorrer um
          incidente relevante, comunicaremos os titulares afetados e a ANPD conforme a lei.
        </p>
      </section>

      <section>
        <h2>10. Mudanças e contato</h2>
        <p>
          Podemos atualizar esta política; a data no topo indica a última versão. Dúvidas:{' '}
          <a href={`mailto:${legal.supportEmail}`}>{legal.supportEmail}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
