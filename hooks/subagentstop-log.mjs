#!/usr/bin/env node
// subagentstop-log.mjs — SubagentStop hook (port of subagentstop-log.ps1).
// One line per subagent stop; the log self-trims (512KB → last 200 lines).

import { join } from 'node:path';
import { appendTrimmed, claudeDir, run } from './_hooklib.mjs';

// Fields verified present on a real SubagentStop payload (P10 WS-A A7 phase 1,
// 11 captured payloads): session_id, agent_id, agent_type (empty string, not
// absent, for untyped dispatches — use `|| '?'`, never `??`), agent_transcript_path.
// `agent_name` and `subagent_type` do not exist on this payload; they never
// matched, which is why every prior line read `agent=?`.
run('subagentstop-log', (payload) => {
  const line =
    `${new Date().toISOString()} session=${payload?.session_id || '?'}` +
    ` agent_id=${payload?.agent_id || '?'}` +
    ` agent_type=${payload?.agent_type || '?'}` +
    ` transcript=${payload?.agent_transcript_path || '?'}`;
  appendTrimmed(join(claudeDir, 'subagent-stops.log'), line);
});
