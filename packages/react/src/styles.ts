import type { CSSProperties } from 'react';

/**
 * Inline styles with CSS variables, so the components need no CSS framework. Override in your
 * app: `--fusai-accent`, `--fusai-fg`, `--fusai-muted`, `--fusai-border`, `--fusai-bg`, `--fusai-radius`.
 */
const v = (name: string, fallback: string) => `var(--fusai-${name}, ${fallback})`;

export const theme = {
  accent: v('accent', '#0066fe'),
  fg: v('fg', 'currentColor'),
  muted: v('muted', 'color-mix(in srgb, currentColor 65%, transparent)'),
  border: v('border', 'color-mix(in srgb, currentColor 18%, transparent)'),
  bg: v('bg', 'transparent'),
  radius: v('radius', '12px'),
  success: v('success', '#16a34a'),
  danger: v('danger', '#dc2626'),
};

export const s = {
  box: {
    display: 'grid',
    gap: 16,
    padding: 16,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radius,
    background: theme.bg,
    color: theme.fg,
    fontFamily: 'inherit',
    maxWidth: 420,
  },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  muted: { color: theme.muted, fontSize: 13, margin: 0 },
  title: { fontWeight: 600, fontSize: 18, margin: 0 },
  button: {
    appearance: 'none',
    border: 'none',
    borderRadius: theme.radius,
    background: theme.accent,
    color: '#fff',
    fontWeight: 600,
    fontSize: 15,
    padding: '12px 16px',
    cursor: 'pointer',
    minHeight: 44,
    font: 'inherit',
  },
  secondary: {
    appearance: 'none',
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radius,
    background: 'transparent',
    color: theme.fg,
    fontSize: 14,
    padding: '10px 14px',
    cursor: 'pointer',
    minHeight: 44,
    font: 'inherit',
  },
  input: {
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radius,
    background: 'transparent',
    color: theme.fg,
    padding: '10px 12px',
    fontSize: 16, // 16px avoids iOS zoom on focus
    font: 'inherit',
  },
  option: {
    display: 'grid',
    gap: 2,
    padding: 12,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radius,
    cursor: 'pointer',
  },
  code: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    wordBreak: 'break-all',
    padding: '8px 10px',
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radius,
  },
  qr: {
    width: 220,
    height: 220,
    background: '#fff',
    padding: 8,
    borderRadius: theme.radius,
    justifySelf: 'center',
  },
  alert: { color: theme.danger, fontSize: 14, margin: 0 },
} satisfies Record<string, CSSProperties>;
