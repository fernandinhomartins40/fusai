/** Small CSS confetti burst in the brand colors (disabled by prefers-reduced-motion in the theme). */
const COLORS = ['var(--fusai-navy)', 'var(--fusai-blue)', 'var(--fusai-cyan)'];

export function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 28 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static decorative pieces
          key={i}
          className="absolute top-0 block h-2.5 w-1.5 rounded-sm motion-safe:animate-[confetti_1.6s_ease-in_forwards]"
          style={{
            left: `${(i * 37) % 100}%`,
            background: COLORS[i % 3],
            animationDelay: `${(i % 7) * 70}ms`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
      <style>{`@keyframes confetti { 0% { transform: translateY(-10px) rotate(0); opacity: 1 } 100% { transform: translateY(320px) rotate(540deg); opacity: 0 } }`}</style>
    </div>
  );
}
