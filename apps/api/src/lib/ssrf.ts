import dns, { type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';

/**
 * Customer-provided URLs (webhooks) must not reach our private network.
 * In production: https only, and every resolved address must be public.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && ip.split('.')[2] === '0') ||
      a >= 224
    );
  }
  const h = ipv6Hextets(ip);
  if (!h) return true; // unparseable: deny
  const [h0 = 0, h1 = 0, , , , , h6 = 0, h7 = 0] = h;
  // IPv4 embedded in IPv6: mapped (::ffff:0:0/96), compatible (::/96) and NAT64 (64:ff9b::/96).
  const head = h.slice(0, 6);
  const embedsV4 =
    head.every((x, i) => x === (i === 5 ? 0xffff : 0)) ||
    head.every((x) => x === 0) ||
    (h0 === 0x64 && h1 === 0xff9b && head.slice(2).every((x) => x === 0));
  if (embedsV4) {
    if (head.every((x) => x === 0) && h6 === 0 && h7 <= 1) return true; // :: and ::1
    return isPrivateAddress(`${h6 >> 8}.${h6 & 0xff}.${h7 >> 8}.${h7 & 0xff}`);
  }
  return (
    (h0 & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (h0 & 0xffc0) === 0xfe80 || // fe80::/10 link local
    (h0 & 0xffc0) === 0xfec0 || // fec0::/10 site local (deprecated)
    (h0 & 0xff00) === 0xff00 || // ff00::/8 multicast
    (h0 === 0x2001 && h1 === 0x0db8) // documentation
  );
}

/** Expands an IPv6 address (with optional dotted IPv4 tail) into 8 numbers, or null. */
function ipv6Hextets(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0] ?? '';
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [p1 = 0, p2 = 0, p3 = 0, p4 = 0] = (dotted[2] ?? '').split('.').map(Number);
    s = `${dotted[1]}${((p1 << 8) | p2).toString(16)}:${((p3 << 8) | p4).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) => (part ? part.split(':') : []);
  const left = parse(halves[0]);
  const right = parse(halves[1]);
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...left, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...right];
  const nums = all.map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? Number.parseInt(x, 16) : Number.NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

export async function assertPublicUrl(url: string, production: boolean): Promise<void> {
  const parsed = new URL(url);
  if (!production) return;
  if (parsed.protocol !== 'https:') throw new Error('Use https');
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error('Endereço não permitido');
  }
}

type Resolver = (
  hostname: string,
  options: dns.LookupAllOptions,
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * DNS lookup for the socket itself: rejects private addresses at connect time, so a host
 * that resolved to a public IP during `assertPublicUrl` cannot rebind to an internal one.
 */
export function publicLookup(resolve: Resolver = dns.lookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const first = addresses[0];
      if (!first || addresses.some((a) => isPrivateAddress(a.address))) {
        const blocked = Object.assign(new Error('Endereço não permitido'), { code: 'EBLOCKED' });
        return callback(blocked, '', 0);
      }
      if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, addresses);
      callback(null, first.address, first.family);
    });
  };
}

/** POSTs without following redirects; with `guard`, every connection goes through `publicLookup`. */
export function postPublic(
  url: string,
  opts: {
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
    guard: boolean;
    resolve?: Resolver;
  },
): Promise<number> {
  const client = new URL(url).protocol === 'https:' ? https : http;
  return new Promise((resolvePromise, reject) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { ...opts.headers, 'content-length': Buffer.byteLength(opts.body) },
        signal: AbortSignal.timeout(opts.timeoutMs),
        ...(opts.guard ? { lookup: publicLookup(opts.resolve) } : {}),
      },
      (res) => {
        res.resume();
        resolvePromise(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}
