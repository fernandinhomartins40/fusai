import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Fake Asaas v3 (only what fusai uses), following docs.asaas.com:
 * `access_token` auth header, /customers, /payments, /payments/:id/pixQrCode, refund, DELETE,
 * and webhook bodies `{ id: "evt_…", event, payment: { id, status, value, externalReference } }`.
 */
export type FakePayment = {
  id: string;
  customer: string;
  billingType: string;
  value: number;
  status: string;
  dueDate: string;
  externalReference: string | null;
  deleted: boolean;
};

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export async function startFakeAsaas(apiKey = '$aact_hmlg_test', listenPort = 0) {
  const customers: { id: string; name: string; cpfCnpj: string; externalReference?: string }[] = [];
  const payments = new Map<string, FakePayment>();
  const requests: {
    method: string;
    path: string;
    headers: IncomingMessage['headers'];
    body: unknown;
  }[] = [];
  let seq = 0;
  // Ids unique per run, like the real Asaas (a dev DB may keep payments from earlier runs).
  const run = Math.random().toString(36).slice(2, 8);
  const failNext = { createPayment: false };

  const server = createServer(async (req, res) => {
    const body = await readJson(req);
    const path = (req.url ?? '').replace(/^\/v3/, '');
    requests.push({ method: req.method ?? '', path, headers: req.headers, body });
    if (req.headers.access_token !== apiKey)
      return send(res, 401, {
        errors: [{ code: 'invalid_access_token', description: 'Chave inválida' }],
      });

    const m = path.match(/^\/payments\/([^/]+)(\/pixQrCode|\/refund)?$/);
    if (req.method === 'POST' && path === '/customers') {
      const b = body as { name?: string; cpfCnpj?: string; externalReference?: string };
      if (!b.name || !b.cpfCnpj)
        return send(res, 400, { errors: [{ description: 'name e cpfCnpj obrigatórios' }] });
      const c = {
        id: `cus_${run}${++seq}`,
        name: b.name,
        cpfCnpj: b.cpfCnpj,
        externalReference: b.externalReference,
      };
      customers.push(c);
      return send(res, 200, { object: 'customer', ...c });
    }
    if (req.method === 'POST' && path === '/payments') {
      if (failNext.createPayment) {
        failNext.createPayment = false;
        return send(res, 503, { errors: [{ description: 'indisponível' }] });
      }
      const b = body as {
        customer: string;
        billingType: string;
        value: number;
        dueDate: string;
        externalReference?: string;
      };
      const p: FakePayment = {
        id: `pay_${run}${++seq}`,
        customer: b.customer,
        billingType: b.billingType,
        value: b.value,
        status: 'PENDING',
        dueDate: b.dueDate,
        externalReference: b.externalReference ?? null,
        deleted: false,
      };
      payments.set(p.id, p);
      return send(res, 200, { object: 'payment', ...p });
    }
    if (m) {
      const p = payments.get(m[1] as string);
      if (!p) return send(res, 404, { errors: [{ description: 'não encontrada' }] });
      if (req.method === 'GET' && m[2] === '/pixQrCode') {
        return send(res, 200, {
          encodedImage: PNG_1x1,
          payload: `00020101021226820014br.gov.bcb.pix2560fake.asaas/qr/${p.id}5204000053039865406${p.value.toFixed(2)}5802BR6304ABCD`,
          expirationDate: '2027-10-15 23:59:59',
        });
      }
      if (req.method === 'GET' && !m[2]) return send(res, 200, { object: 'payment', ...p });
      if (req.method === 'POST' && m[2] === '/refund') {
        if (p.status !== 'RECEIVED' && p.status !== 'CONFIRMED')
          return send(res, 400, { errors: [{ description: 'não pode ser estornada' }] });
        p.status = 'REFUNDED';
        return send(res, 200, { object: 'payment', ...p });
      }
      if (req.method === 'DELETE' && !m[2]) {
        if (p.status !== 'PENDING')
          return send(res, 400, {
            errors: [{ description: 'cobrança paga não pode ser removida' }],
          });
        p.deleted = true;
        return send(res, 200, { deleted: true, id: p.id });
      }
    }
    return send(res, 404, { errors: [{ description: 'rota não encontrada' }] });
  });
  await new Promise<void>((resolve) => server.listen(listenPort, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v3`,
    customers,
    payments,
    requests,
    failNext,
    /** Simulates the payer paying the QR code ("Confirmar pagamento" in the sandbox UI). */
    pay(id: string) {
      const p = payments.get(id);
      if (p) p.status = 'RECEIVED';
    },
    webhookBody(event: string, id: string, eventId = `evt_${run}${++seq}`) {
      const p = payments.get(id);
      return {
        id: eventId,
        event,
        dateCreated: '2026-10-15 10:00:00',
        payment: { object: 'payment', ...p },
      };
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
