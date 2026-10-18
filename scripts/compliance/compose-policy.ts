import { parse } from 'yaml';
import { z } from 'zod';

import { isPrivateHost } from '@aetherion/shared';

// Long-form or short-form port entries; only the host side matters for exposure.
const portSchema = z.union([
  z.string(),
  z.number(),
  z.object({
    host_ip: z.string().optional(),
    published: z.union([z.string(), z.number()]).optional(),
  }),
]);

const composeSchema = z.object({
  services: z.record(
    z.string(),
    z.object({
      image: z.string().optional(),
      ports: z.array(portSchema).optional(),
      network_mode: z.string().optional(),
      privileged: z.boolean().optional(),
    }),
  ),
});

const DIGEST = /@sha256:[0-9a-f]{64}$/;

// "127.0.0.1:6379:6379" → host 127.0.0.1; "6379:6379" or "6379" → no host (all interfaces).
const shortFormHost = (entry: string): string | undefined => {
  const bracketed = entry.match(/^\[([^\]]+)\]:/);
  if (bracketed) return bracketed[1];
  const parts = entry.split(':');
  return parts.length === 3 ? parts[0] : undefined;
};

/** Container exposure rules from specs/security-recovery.md, applied to a compose file. */
export function composeViolations(file: string, text: string): string[] {
  const parsed = composeSchema.safeParse(parse(text));
  if (!parsed.success) return [`${file}: not a compose file with services`];
  return Object.entries(parsed.data.services).flatMap(([name, service]) => {
    const problems: string[] = [];
    const where = `${file}: service ${name}`;
    if (service.image && !DIGEST.test(service.image))
      problems.push(`${where} image is not pinned by digest`);
    if (service.network_mode === 'host') problems.push(`${where} uses host networking`);
    if (service.privileged) problems.push(`${where} is privileged`);
    for (const port of service.ports ?? []) {
      const host =
        typeof port === 'object'
          ? port.host_ip
          : typeof port === 'number'
            ? undefined
            : shortFormHost(port);
      if (!host || !isPrivateHost(host))
        problems.push(`${where} publishes ${JSON.stringify(port)} beyond loopback/Tailscale`);
    }
    return problems;
  });
}
