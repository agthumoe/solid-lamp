import assert from 'node:assert/strict';
import test from 'node:test';

import { isPrivateHost, isPrivateHttpUrl } from './private-host.ts';

await test('private hosts: loopback and Tailscale only', () => {
  for (const host of [
    'localhost',
    '127.0.0.1',
    '127.8.9.10',
    '[::1]',
    '100.64.0.1',
    '100.127.255.254',
    'box.tail1.ts.net',
  ])
    assert.equal(isPrivateHost(host), true, host);
  for (const host of [
    '0.0.0.0',
    '10.0.0.1',
    '192.168.0.2',
    '100.63.255.255',
    '100.128.0.1',
    'ts.net',
    'evil.ts.net.example.com',
    '127.0.0.256',
  ])
    assert.equal(isPrivateHost(host), false, host);
});

await test('private URLs require http(s)', () => {
  assert.equal(isPrivateHttpUrl('http://localhost:11434'), true);
  assert.equal(isPrivateHttpUrl('file://localhost/etc/passwd'), false);
  assert.equal(isPrivateHttpUrl('not a url'), false);
});
