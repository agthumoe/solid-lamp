// AGENTS hard constraint 3: runtime endpoints stay on loopback or the Tailscale network.
const TAILSCALE_SUFFIX = '.ts.net';

const ipv4 = (host: string): number[] | undefined => {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : undefined;
};

export const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') return true;
  if (host.endsWith(TAILSCALE_SUFFIX) && host.length > TAILSCALE_SUFFIX.length) return true;
  const octets = ipv4(host);
  if (!octets) return false;
  const [first = -1, second = -1] = octets;
  // 127.0.0.0/8 loopback; 100.64.0.0/10 Tailscale CGNAT range.
  return first === 127 || (first === 100 && second >= 64 && second <= 127);
};

export const isPrivateHttpUrl = (value: string): boolean => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (url.protocol === 'http:' || url.protocol === 'https:') && isPrivateHost(url.hostname);
};
