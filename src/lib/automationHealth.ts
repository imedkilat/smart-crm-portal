export type FollowUpHealthState = 'healthy' | 'attention' | 'off' | 'waiting' | 'safe'

export type FollowUpRunSignal = {
  status: 'running' | 'succeeded' | 'failed' | 'suppressed' | 'skipped'
  started_at: string
  finished_at: string | null
  run_ref: string | null
  error_code?: string | null
  error_message?: string | null
}

type FollowUpHealthInput = {
  enabled: boolean
  paused: boolean
  latestRun: FollowUpRunSignal | null
  recentEventCount: number
  now?: number
  heartbeatMs?: number
}

type FollowUpHealth = {
  state: FollowUpHealthState
  status: string
  metric: string
  note: string
  lastAt: string | null
}

export const FOLLOW_UP_HEARTBEAT_MS = 150 * 60 * 1000

function runAt(run: FollowUpRunSignal) {
  return run.finished_at || run.started_at
}

function runLabel(run: FollowUpRunSignal) {
  return run.run_ref ? `run ${run.run_ref}` : 'latest run'
}

function isFresh(value: string, now: number, heartbeatMs: number) {
  const timestamp = new Date(value).getTime()
  const age = now - timestamp
  return Number.isFinite(timestamp) && age >= 0 && age <= heartbeatMs
}

export function deriveFollowUpHealth({
  enabled,
  paused,
  latestRun,
  recentEventCount,
  now = Date.now(),
  heartbeatMs = FOLLOW_UP_HEARTBEAT_MS,
}: FollowUpHealthInput): FollowUpHealth {
  const metric = `${recentEventCount} follow-up event${recentEventCount === 1 ? '' : 's'} / 24h`

  if (paused) {
    return {
      state: 'off',
      status: 'Paused by workspace',
      metric,
      note: 'Scheduled follow-up selection is paused for this workspace.',
      lastAt: latestRun ? runAt(latestRun) : null,
    }
  }

  if (!enabled) {
    return {
      state: 'off',
      status: 'Disabled by workspace',
      metric,
      note: 'Follow-Up Engine is disabled in workspace settings.',
      lastAt: latestRun ? runAt(latestRun) : null,
    }
  }

  if (!latestRun) {
    return {
      state: 'waiting',
      status: 'Enabled; waiting for heartbeat',
      metric,
      note: 'No normalized Follow-Up execution heartbeat has been recorded yet.',
      lastAt: null,
    }
  }

  const lastAt = runAt(latestRun)
  if (!isFresh(lastAt, now, heartbeatMs)) {
    return {
      state: 'waiting',
      status: 'Scheduled heartbeat is stale',
      metric,
      note: `Latest Follow-Up ${runLabel(latestRun)} is older than the expected heartbeat window.`,
      lastAt,
    }
  }

  if (latestRun.status === 'failed') {
    return {
      state: 'attention',
      status: 'Latest scheduled run failed',
      metric,
      note: latestRun.error_message || latestRun.error_code || `Follow-Up ${runLabel(latestRun)} needs review.`,
      lastAt,
    }
  }

  if (latestRun.status === 'running') {
    return {
      state: 'waiting',
      status: 'Scheduled run in progress',
      metric,
      note: `Follow-Up ${runLabel(latestRun)} has started and has not reached a terminal state yet.`,
      lastAt,
    }
  }

  if (latestRun.status === 'suppressed') {
    return {
      state: 'safe',
      status: 'Writes suppressed by safety gate',
      metric,
      note: `Follow-Up ${runLabel(latestRun)} completed its selection pass without authorizing business writes.`,
      lastAt,
    }
  }

  if (latestRun.status === 'skipped') {
    return {
      state: 'safe',
      status: 'Latest scheduled run skipped safely',
      metric,
      note: `Follow-Up ${runLabel(latestRun)} recorded a deliberate no-op outcome.`,
      lastAt,
    }
  }

  return {
    state: 'healthy',
    status: 'Latest scheduled run succeeded',
    metric,
    note: `Follow-Up ${runLabel(latestRun)} completed successfully.`,
    lastAt,
  }
}
