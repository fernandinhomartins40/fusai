/** Skeleton shown by loading.tsx while server pages fetch their data. */
export function PageLoading() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <span className="sr-only" role="status">
        Carregando…
      </span>
      <div className="grid gap-2" aria-hidden>
        <div className="h-7 w-48 animate-pulse rounded-lg bg-muted" />
        <div className="h-4 w-72 max-w-full animate-pulse rounded-lg bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-hidden />
    </div>
  );
}
