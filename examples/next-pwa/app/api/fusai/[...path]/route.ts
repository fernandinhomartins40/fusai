import { fusaiAccountHandler } from '@fusai/sdk/server';
import { fuseServer } from '@/lib/fuse-server';

/**
 * "Uso próprio": credits of YOUR organization inside your app (balance, usage, Pix top-up).
 * The secret key stays here. In a real app, `authorize` must check your logged-in admin.
 */
const handler = (req: Request) =>
  fusaiAccountHandler(fuseServer(), {
    basePath: '/api/fusai',
    // Demo: open to anyone running the example locally. NEVER do this in production.
    authorize: () => process.env.NODE_ENV !== 'production',
  })(req);

export { handler as GET, handler as POST };
