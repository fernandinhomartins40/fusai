'use client';

import { FusaiTopup } from '@fusai/react';
import Link from 'next/link';

/** Admin area of YOUR app: the organization's balance and Pix top-up, without leaving the app. */
export default function CreditosDaConta() {
  return (
    <main>
      <header style={{ display: 'grid', gap: 4 }}>
        <h1>Créditos da conta</h1>
        <p className="muted">
          Uso próprio: o saldo da sua organização na fusai. Recarregue com Pix aqui mesmo.
        </p>
      </header>
      <FusaiTopup endpoint="/api/fusai" />
      <Link href="/">Voltar</Link>
    </main>
  );
}
