import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { verifySvix } from './svix';

const secretBytes = Buffer.from('a-test-signing-secret');
const secret = `whsec_${secretBytes.toString('base64')}`;
const body = '{"type":"email.received"}';
const sign = (id: string, ts: string, b: string) =>
  createHmac('sha256', secretBytes).update(`${id}.${ts}.${b}`).digest('base64');

describe('verifySvix', () => {
  const now = 1_790_000_000;
  const ts = String(now);

  it('accepts a correctly signed request', () => {
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts, signature: `v1,${sign('msg_1', ts, body)}` }, body, now)).toBe(true);
  });

  it('accepts when one of several signatures matches', () => {
    expect(
      verifySvix(secret, { id: 'msg_1', timestamp: ts, signature: `v1,bm9wZQ== v1,${sign('msg_1', ts, body)}` }, body, now),
    ).toBe(true);
  });

  it('rejects a changed body, a wrong secret, a stale timestamp and missing headers', () => {
    const sig = `v1,${sign('msg_1', ts, body)}`;
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts, signature: sig }, body + ' ', now)).toBe(false);
    expect(verifySvix('whsec_' + Buffer.from('other').toString('base64'), { id: 'msg_1', timestamp: ts, signature: sig }, body, now)).toBe(false);
    expect(verifySvix(secret, { id: 'msg_1', timestamp: ts, signature: sig }, body, now + 3600)).toBe(false);
    expect(verifySvix(secret, { id: null, timestamp: ts, signature: sig }, body, now)).toBe(false);
    expect(verifySvix('', { id: 'msg_1', timestamp: ts, signature: sig }, body, now)).toBe(false);
  });
});
