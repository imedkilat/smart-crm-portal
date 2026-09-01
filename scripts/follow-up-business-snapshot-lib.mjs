import { createHash } from 'node:crypto'

export const SNAPSHOT_KIND = 'smart-crm-follow-up-business-snapshot'
export const SNAPSHOT_SCHEMA_VERSION = 1

export const PROTECTED_TABLES = Object.freeze({
  lead_tasks: [
    'id',
    'workspace_id',
    'lead_id',
    'public_id',
    'status',
    'priority',
    'due_at',
    'completed_at',
    'created_at',
    'updated_at',
    'automation_key',
  ],
  lead_activities: [
    'id',
    'workspace_id',
    'lead_id',
    'public_id',
    'activity_type',
    'actor_user_id',
    'occurred_at',
  ],
  lead_quotes: [
    'id',
    'workspace_id',
    'lead_id',
    'public_id',
    'quote_reference',
    'amount',
    'currency_code',
    'status',
    'sent_at',
    'receipt_confirmed_at',
    'expected_decision_at',
    'next_follow_up_at',
    'last_call_outcome',
    'supersedes_quote_id',
    'created_at',
    'updated_at',
  ],
  outbound_email_deliveries: [
    'id',
    'workspace_id',
    'lead_id',
    'public_id',
    'template_key',
    'idempotency_key',
    'mode',
    'provider',
    'status',
    'scheduled_for',
    'attempt_count',
    'last_attempt_at',
    'sent_at',
    'delivered_at',
    'bounced_at',
    'provider_message_id',
    'last_error_code',
    'created_at',
    'updated_at',
  ],
  outbound_email_attempts: [
    'id',
    'workspace_id',
    'delivery_id',
    'attempt_number',
    'mode',
    'provider',
    'status',
    'provider_message_id',
    'http_status',
    'error_code',
    'attempted_at',
  ],
})

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  )
}

export function fingerprintRows(rows) {
  const canonical = JSON.stringify(canonicalize(rows))
  return createHash('sha256').update(canonical).digest('hex')
}

async function captureTable(client, workspaceId, table, columns) {
  const pageSize = 1000
  const rows = []
  let expectedCount = null

  for (let from = 0; ; from += pageSize) {
    let query = client
      .from(table)
      .select(columns.join(','), from === 0 ? { count: 'exact' } : undefined)
      .eq('workspace_id', workspaceId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)

    const result = await query
    if (result.error) throw new Error(`Could not snapshot ${table}: ${result.error.message}`)
    if (from === 0) expectedCount = result.count

    const page = result.data || []
    for (const row of page) {
      if (row.workspace_id !== workspaceId) {
        throw new Error(`${table} returned foreign workspace ${row.workspace_id}`)
      }
    }
    rows.push(...page)
    if (page.length < pageSize) break
  }

  if (expectedCount !== null && expectedCount !== rows.length) {
    throw new Error(`${table} exact count ${expectedCount} did not match ${rows.length} fetched rows`)
  }

  return {
    count: rows.length,
    fingerprint_sha256: fingerprintRows(rows),
  }
}

export async function captureBusinessSnapshot({ client, workspaceId, workspaceName, actorUserId, capturedAt = new Date() }) {
  if (!workspaceId) throw new Error('workspaceId is required')
  const timestamp = capturedAt instanceof Date ? capturedAt : new Date(capturedAt)
  if (!Number.isFinite(timestamp.getTime())) throw new Error('capturedAt must be a valid date')

  const entries = await Promise.all(
    Object.entries(PROTECTED_TABLES).map(async ([table, columns]) => [
      table,
      await captureTable(client, workspaceId, table, columns),
    ]),
  )

  return {
    kind: SNAPSHOT_KIND,
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    captured_at: timestamp.toISOString(),
    workspace_id: workspaceId,
    workspace_name: workspaceName || null,
    actor_user_id: actorUserId || null,
    tables: Object.fromEntries(entries),
  }
}

function assertSnapshot(snapshot, label) {
  if (!snapshot || snapshot.kind !== SNAPSHOT_KIND) throw new Error(`${label} has an unexpected kind`)
  if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) throw new Error(`${label} has an unsupported schema version`)
  if (!snapshot.workspace_id) throw new Error(`${label} has no workspace_id`)

  for (const table of Object.keys(PROTECTED_TABLES)) {
    const value = snapshot.tables?.[table]
    if (!Number.isInteger(value?.count) || value.count < 0) throw new Error(`${label} has an invalid ${table} count`)
    if (!/^[a-f0-9]{64}$/.test(value?.fingerprint_sha256 || '')) {
      throw new Error(`${label} has an invalid ${table} fingerprint`)
    }
  }
}

export function compareBusinessSnapshots(baseline, current, comparedAt = new Date()) {
  assertSnapshot(baseline, 'Baseline snapshot')
  assertSnapshot(current, 'Current snapshot')
  if (baseline.workspace_id !== current.workspace_id) {
    throw new Error(`Workspace mismatch: baseline=${baseline.workspace_id}, current=${current.workspace_id}`)
  }

  const tables = Object.fromEntries(
    Object.keys(PROTECTED_TABLES).map((table) => {
      const before = baseline.tables[table]
      const after = current.tables[table]
      const countDelta = after.count - before.count
      const unchanged = countDelta === 0 && before.fingerprint_sha256 === after.fingerprint_sha256
      return [table, {
        unchanged,
        count_before: before.count,
        count_after: after.count,
        count_delta: countDelta,
        fingerprint_before: before.fingerprint_sha256,
        fingerprint_after: after.fingerprint_sha256,
      }]
    }),
  )

  return {
    ok: Object.values(tables).every((table) => table.unchanged),
    kind: 'smart-crm-follow-up-business-comparison',
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    compared_at: new Date(comparedAt).toISOString(),
    baseline_captured_at: baseline.captured_at,
    current_captured_at: current.captured_at,
    workspace_id: current.workspace_id,
    workspace_name: current.workspace_name,
    tables,
  }
}
