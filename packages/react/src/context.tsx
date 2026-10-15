import { FuseAI } from '@fuseai/sdk';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

export type FuseClientProps = {
  /** End-user session token `fai_st_…`, or a function that fetches a fresh one from your backend. */
  sessionToken?: string | (() => Promise<string>);
  /** Default: https://api.fusai.com.br/v1 */
  baseUrl?: string;
};

const FuseContext = createContext<FuseAI | null>(null);

function useClient(sessionToken: FuseClientProps['sessionToken'], baseUrl?: string) {
  return useMemo(
    () => (sessionToken ? new FuseAI({ sessionToken, baseUrl }) : null),
    [sessionToken, baseUrl],
  );
}

/** Shares one FuseAI client with every component below it. */
export function FuseProvider({
  children,
  sessionToken,
  baseUrl,
}: FuseClientProps & { children: ReactNode }) {
  const client = useClient(sessionToken, baseUrl);
  return <FuseContext.Provider value={client}>{children}</FuseContext.Provider>;
}

/** Client from props (when given) or from the nearest <FuseProvider>. */
export function useFuseClient(props: FuseClientProps = {}): FuseAI | null {
  const fromContext = useContext(FuseContext);
  const own = useClient(props.sessionToken, props.baseUrl);
  return own ?? fromContext;
}
