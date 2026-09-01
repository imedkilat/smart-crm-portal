import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SNAPSHOT_KIND,
  SNAPSHOT_SCHEMA_VERSION,
  PROTECTED_TABLES,
  compareBusinessSnapshots,
  fingerprintRows,
} from './follow-up-business-snapshot-lib.mjs'

function snapshot(workspaceId = 'workspace-a') {
  const fingerprint = fingerprintRows([])
  return {
    kind: SNAPSHOT_KIND,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    captured_at: '2026-09-01T00:00:00.000Z',
    workspace_id: workspaceId,
    workspace_name: 'Smart CRM Starter QA',
    actor_user_id: 'user-a',
    tables: Object.fromEntries(
      Object.keys(PROTECTED_TABLES).map((table) => [table, { count: 0, fingerprint_sha256: fingerprint }]),
    ),
  }
}

test('fingerprints are stable across object key order', () => {
  assert.equal(
    fingerprintRows([{ id: '1', status: 'open' }]),
    fingerprintRows([{ status: 'open', id: '1' }]),
  )
})

test('comparison passes when every protected table is unchanged', () => {
  const baseline = snapshot()
  const result = compareBusinessSnapshots(baseline, structuredClone(baseline), '2026-09-01T01:00:00.000Z')
  assert.equal(result.ok, true)
  assert.ok(Object.values(result.tables).every((table) => table.unchanged))
})

test('comparison fails on same-count row changes', () => {
  const baseline = snapshot()
  const current = structuredClone(baseline)
  current.tables.lead_tasks.fingerprint_sha256 = fingerprintRows([{ id: 'changed' }])

  const result = compareBusinessSnapshots(baseline, current)
  assert.equal(result.ok, false)
  assert.equal(result.tables.lead_tasks.count_delta, 0)
  assert.equal(result.tables.lead_tasks.unchanged, false)
})

test('comparison reports count deltas', () => {
  const baseline = snapshot()
  const current = structuredClone(baseline)
  current.tables.lead_activities.count = 2
  current.tables.lead_activities.fingerprint_sha256 = fingerprintRows([{ id: '1' }, { id: '2' }])

  const result = compareBusinessSnapshots(baseline, current)
  assert.equal(result.ok, false)
  assert.equal(result.tables.lead_activities.count_delta, 2)
})

test('comparison rejects a different workspace', () => {
  assert.throws(
    () => compareBusinessSnapshots(snapshot('workspace-a'), snapshot('workspace-b')),
    /Workspace mismatch/,
  )
})
