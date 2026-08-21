#!/usr/bin/env node
// otel-receiver-spawn.mjs — SessionStart hook (port of otel-receiver-spawn.ps1).
// Lazy-spawns the local usage-telemetry receiver (telemetry/otel-receiver.mjs,
// port 4318) when nothing is listening. Detached; survives session end. A
// false-negative double-spawn is harmless — the loser exits on EADDRINUSE.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { run } from './_hooklib.mjs';

const PORT = 4318;

run('otel-receiver-spawn', async () => {
  const receiver = join(dirname(fileURLToPath(import.meta.url)), '..', 'telemetry', 'otel-receiver.mjs');
  if (!existsSync(receiver)) return;

  const listening = await new Promise((res) => {
    const sock = net.connect({ port: PORT, host: '127.0.0.1' });
    sock.once('connect', () => {
      sock.destroy();
      res(true);
    });
    sock.once('error', () => res(false));
    sock.setTimeout(200, () => {
      sock.destroy();
      res(false);
    });
  });
  if (!listening) {
    const child = spawn(process.execPath, [receiver], { detached: true, stdio: 'ignore' });
    child.unref();
  }
});
