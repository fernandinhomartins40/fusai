import { SectionNav } from '@/components/section-nav';

export function AdminNav() {
  return (
    <SectionNav
      label="Seções do admin"
      items={[
        { href: '/admin', label: 'Visão geral', exact: true },
        { href: '/admin/clientes', label: 'Clientes' },
        { href: '/admin/provedores', label: 'Provedores' },
        { href: '/admin/modelos', label: 'Modelos' },
        { href: '/admin/precos', label: 'Preços' },
      ]}
    />
  );
}
