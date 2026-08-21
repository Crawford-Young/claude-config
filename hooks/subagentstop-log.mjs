#!/usr/bin/env node
// subagentstop-log.mjs — SubagentStop hook (port of subagentstop-log.ps1).
// One line per subagent stop; the log self-trims (512KB → last 200 lines).

import { join } from 'node:path';
import { appendTrimmed, claudeDir, run } from './_hooklib.mjs';

run('subagentstop-log', (payload) => {
  const line = `${new Date().toISOString()} session=${payload?.session_id || '?'} agent=${payload?.agent_name || payload?.subagent_type || '?'}`;
  appendTrimmed(join(claudeDir, 'subagent-stops.log'), line);
});
