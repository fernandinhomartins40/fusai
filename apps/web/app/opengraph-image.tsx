import { ImageResponse } from 'next/og';

export const alt = 'fusai — Uma API. Os melhores modelos de IA. Pague com Pix.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Open Graph card generated at build time (PRD §11.2). */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 72,
        background: '#0a0e1a',
        color: '#f5f7fb',
      }}
    >
      <div
        style={{
          display: 'flex',
          height: 8,
          width: 220,
          borderRadius: 8,
          background: 'linear-gradient(90deg, #162a9e, #0066fe, #00d2ff)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>fusai</div>
        <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2 }}>
          Uma API. Os melhores modelos de IA. Pague com Pix.
        </div>
      </div>
      <div style={{ display: 'flex', fontSize: 30, color: '#9aa4b8' }}>
        DeepSeek · Kimi · GLM · Qwen · MiniMax — compatível com OpenAI
      </div>
    </div>,
    size,
  );
}
