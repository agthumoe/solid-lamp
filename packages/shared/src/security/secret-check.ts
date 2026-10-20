import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

// Hashing first gives equal-length buffers, so comparison time does not leak the secret length.
export const createSecretCheck = (secret: string) => {
  const expected = digest(secret);
  return (presented: string | string[] | undefined): boolean =>
    typeof presented === 'string' && timingSafeEqual(digest(presented), expected);
};
