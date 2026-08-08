// telemetry/test/otel-parse.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeValue, flattenAttrs, parseMetricsPayload, parseLogsPayload } from '../otel-parse.mjs';

const attr = (key, value) => ({ key, value });

const METRICS_FIXTURE = {
  resourceMetrics: [{
    resource: { attributes: [attr('service.name', { stringValue: 'claude-code' })] },
    scopeMetrics: [{
      metrics: [
        {
          name: 'claude_code.token.usage',
          sum: {
            aggregationTemporality: 1,
            dataPoints: [{
              timeUnixNano: '1754612400000000000',
              startTimeUnixNano: '1754612300000000000',
              asDouble: 1234,
              attributes: [
                attr('session.id', { stringValue: 'sess-1' }),
                attr('type', { stringValue: 'output' }),
                attr('model', { stringValue: 'claude-sonnet-5' }),
              ],
            }],
          },
        },
        {
          name: 'claude_code.lines_of_code.count', // not in kept set
          sum: { dataPoints: [{ timeUnixNano: '1754612400000000000', asInt: '7', attributes: [] }] },
        },
      ],
    }],
  }],
};

const LOGS_FIXTURE = {
  resourceLogs: [{
    scopeLogs: [{
      logRecords: [{
        timeUnixNano: '1754612405000000000',
        eventName: 'claude_code.skill_activated',
        attributes: [
          attr('session.id', { stringValue: 'sess-1' }),
          attr('skill.name', { stringValue: 'harness-editing' }),
          attr('invocation_trigger', { stringValue: 'claude' }),
        ],
      }],
    }],
  }],
};

test('decodeValue handles all OTLP value kinds', () => {
  assert.equal(decodeValue({ stringValue: 'x' }), 'x');
  assert.equal(decodeValue({ intValue: '42' }), 42);
  assert.equal(decodeValue({ doubleValue: 1.5 }), 1.5);
  assert.equal(decodeValue({ boolValue: true }), true);
  assert.equal(decodeValue(undefined), undefined);
  assert.equal(decodeValue({}), undefined);
});

test('flattenAttrs truncates long values and keeps unknown keys', () => {
  const flat = flattenAttrs([attr('a', { stringValue: 'y'.repeat(300) }), attr('mystery', { stringValue: 'kept' })]);
  assert.equal(flat.a.length, 256);
  assert.equal(flat.mystery, 'kept');
  assert.deepEqual(flattenAttrs(undefined), {});
});

test('parseMetricsPayload keeps only tracked metrics, one row per datapoint', () => {
  const rows = parseMetricsPayload(METRICS_FIXTURE);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.v, 1);
  assert.equal(row.kind, 'metric');
  assert.equal(row.name, 'claude_code.token.usage');
  assert.equal(row.val, 1234);
  assert.equal(row.sid, 'sess-1');
  assert.equal(row.ts, '2025-08-08T00:20:00.000Z');
  assert.equal(row.agg, 1);
  assert.equal(row.st, '2025-08-08T00:18:20.000Z');
  assert.equal(row.attrs.type, 'output');
  assert.equal(row.attrs.model, 'claude-sonnet-5');
});

test('parseLogsPayload keeps every event with val 1', () => {
  const rows = parseLogsPayload(LOGS_FIXTURE);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.kind, 'event');
  assert.equal(row.name, 'claude_code.skill_activated');
  assert.equal(row.val, 1);
  assert.equal(row.sid, 'sess-1');
  assert.equal(row.attrs['skill.name'], 'harness-editing');
});

test('parsers tolerate malformed elements without throwing', () => {
  assert.deepEqual(parseMetricsPayload({}), []);
  assert.deepEqual(parseLogsPayload({}), []);
  assert.deepEqual(parseMetricsPayload({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: 'claude_code.cost.usage' }] }] }] }), []);
  const noEventName = { resourceLogs: [{ scopeLogs: [{ logRecords: [{ timeUnixNano: '1754612405000000000', attributes: [] }] }] }] };
  assert.equal(parseLogsPayload(noEventName)[0].name, 'unknown_event');
});
