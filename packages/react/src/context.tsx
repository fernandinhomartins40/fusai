import { Fusai } from '@fusai/sdk';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export type FusaiClientProps = {
  /** End-user session token `fai_st_…`, or a function that fetches a fresh one from your backend. */
  sessionToken?: string | (() => Promise<string>);
  /** Default: https://api.fusai.com.br/v1 */
  baseUrl?: string;
};

const FusaiContext = createContext<Fusai | null>(null);

function useClient(sessionToken: FusaiClientProps['sessionToken'], baseUrl?: string) {
  return useMemo(
    () => (sessionToken ? new Fusai({ sessionToken, baseUrl }) : null),
    [sessionToken, baseUrl],
  );
}

/** Shares one fusai client with every component below it. */
export function FusaiProvider({
  children,
  sessionToken,
  baseUrl,
}: FusaiClientProps & { children: ReactNode }) {
  const client = useClient(sessionToken, baseUrl);
  return <FusaiContext.Provider value={client}>{children}</FusaiContext.Provider>;
}

/** Client from props (when given) or from the nearest <FusaiProvider>. */
export function useFusaiClient(props: FusaiClientProps = {}): Fusai | null {
  const fromContext = useContext(FusaiContext);
  const own = useClient(props.sessionToken, props.baseUrl);
  return own ?? fromContext;
}
