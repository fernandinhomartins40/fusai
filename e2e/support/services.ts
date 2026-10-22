/**
 * Local stand-ins for the external services of the E2E stack:
 * - fake Asaas (the same one the API tests use), so no real charge is ever created;
 * - SMTP sink that appends every message to e2e/.tmp/mail.txt, so tests can read the links.
 * Run with tsx (the Playwright config does it).
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { startFakeAsaas } from '../../apps/api/test/fake-asaas';
import { MAIL_FILE, PORTS, stackEnv } from './env';

const mailPath = fileURLToPath(MAIL_FILE);
mkdirSync(fileURLToPath(new URL('.', MAIL_FILE)), { recursive: true });
writeFileSync(mailPath, '');

createServer((socket) => {
  let inData = false;
  let buffer = '';
  socket.write('220 fusai-e2e\r\n');
  socket.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    if (inData) {
      buffer += text;
      const end = buffer.indexOf('\r\n.\r\n');
      if (end >= 0) {
        appendFileSync(mailPath, `${buffer.slice(0, end)}\n=====END=====\n`);
        buffer = '';
        inData = false;
        socket.write('250 ok\r\n');
      }
      return;
    }
    for (const line of text.split('\r\n').filter(Boolean)) {
      const command = line.slice(0, 4).toUpperCase();
      if (command === 'EHLO') socket.write('250-fusai-e2e\r\n250 OK\r\n');
      else if (command === 'DATA') {
        inData = true;
        socket.write('354 go\r\n');
      } else if (command === 'QUIT') {
        socket.write('221 bye\r\n');
        socket.end();
      } else socket.write('250 ok\r\n');
    }
  });
}).listen(PORTS.smtp, '127.0.0.1');

await startFakeAsaas(stackEnv.ASAAS_API_KEY, PORTS.asaas);
console.log(`e2e services: fake Asaas :${PORTS.asaas}, SMTP sink :${PORTS.smtp}`);
