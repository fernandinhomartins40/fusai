/** Public API base URL (browser). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** API base URL for server-side calls; INTERNAL_API_URL lets containers use the internal network. */
export const SERVER_API_URL = process.env.INTERNAL_API_URL ?? API_URL;

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
