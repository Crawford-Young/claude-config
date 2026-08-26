// node --test scripts/test/cleanup-port.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { listenerPidFromNetstat } from '../lib.mjs';

// Real `netstat -ano` shape: proto, local address, foreign address, state, PID.
const NETSTAT = [
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:30001          0.0.0.0:0              LISTENING       4321',
  '  TCP    127.0.0.1:3000         0.0.0.0:0              LISTENING       1234',
  '  TCP    127.0.0.1:52001        127.0.0.1:3000         ESTABLISHED     9999',
  '  TCP    [::1]:3001             [::]:0                 LISTENING       5678',
].join('\r\n');

test('picks the listener on the exact port, not a longer one that shares the prefix', () => {
  // The bug this guards: `line.includes(":3000")` matches `:30001` first and
  // cleanup.mjs then taskkills PID 4321 — an unrelated process.
  assert.equal(listenerPidFromNetstat(NETSTAT, 3000), '1234');
  assert.equal(listenerPidFromNetstat(NETSTAT, 30001), '4321');
});

test('ignores non-LISTENING rows that mention the port as a foreign address', () => {
  const onlyEstablished = '  TCP    127.0.0.1:52001        127.0.0.1:3000         ESTABLISHED     9999';
  assert.equal(listenerPidFromNetstat(onlyEstablished, 3000), null);
});

test('handles IPv6 local addresses and absent listeners', () => {
  assert.equal(listenerPidFromNetstat(NETSTAT, 3001), '5678');
  assert.equal(listenerPidFromNetstat(NETSTAT, 9999), null);
  assert.equal(listenerPidFromNetstat('', 3000), null);
  assert.equal(listenerPidFromNetstat(undefined, 3000), null);
});
