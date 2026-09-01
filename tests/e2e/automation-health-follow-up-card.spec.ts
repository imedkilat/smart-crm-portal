import { expect, test } from '@playwright/test'
import { deriveFollowUpHealth, FOLLOW_UP_HEARTBEAT_MS } from '../../src/lib/automationHealth'

const NOW = Date.parse('2026-09-02T00:00:00Z')

function run(status: 'running' | 'succeeded' | 'failed' | 'suppressed' | 'skipped', ageMs = 30 * 60 * 1000) {
  const at = new Date(NOW - ageMs).toISOString()
  return {
    status,
    started_at: at,
    finished_at: status === 'running' ? null : at,
    run_ref: '441',
    error_code: status === 'failed' ? 'FOLLOW_UP_QA' : null,
    error_message: status === 'failed' ? 'Controlled failure detail' : null,
  }
}

test.describe('Follow-Up Health Center heartbeat model', () => {
  test('suppressed terminal run is safe mode instead of a false healthy business-write signal', () => {
    const health = deriveFollowUpHealth({
      enabled: true,
      paused: false,
      latestRun: run('suppressed'),
      recentEventCount: 0,
      now: NOW,
    })

    expect(health.state).toBe('safe')
    expect(health.status).toBe('Writes suppressed by safety gate')
    expect(health.note).toContain('run 441')
    expect(health.metric).toBe('0 follow-up events / 24h')
  })

  test('fresh succeeded run is healthy', () => {
    const health = deriveFollowUpHealth({
      enabled: true,
      paused: false,
      latestRun: run('succeeded'),
      recentEventCount: 2,
      now: NOW,
    })

    expect(health.state).toBe('healthy')
    expect(health.status).toBe('Latest scheduled run succeeded')
    expect(health.metric).toBe('2 follow-up events / 24h')
  })

  test('fresh failed run needs attention and keeps the failure detail', () => {
    const health = deriveFollowUpHealth({
      enabled: true,
      paused: false,
      latestRun: run('failed'),
      recentEventCount: 0,
      now: NOW,
    })

    expect(health.state).toBe('attention')
    expect(health.status).toBe('Latest scheduled run failed')
    expect(health.note).toBe('Controlled failure detail')
  })

  test('stale heartbeat waits instead of reporting healthy or safe', () => {
    const health = deriveFollowUpHealth({
      enabled: true,
      paused: false,
      latestRun: run('succeeded', FOLLOW_UP_HEARTBEAT_MS + 1),
      recentEventCount: 0,
      now: NOW,
    })

    expect(health.state).toBe('waiting')
    expect(health.status).toBe('Scheduled heartbeat is stale')
  })

  test('workspace pause and disable take precedence over run telemetry', () => {
    const paused = deriveFollowUpHealth({
      enabled: true,
      paused: true,
      latestRun: run('succeeded'),
      recentEventCount: 1,
      now: NOW,
    })
    const disabled = deriveFollowUpHealth({
      enabled: false,
      paused: false,
      latestRun: run('succeeded'),
      recentEventCount: 1,
      now: NOW,
    })

    expect(paused.state).toBe('off')
    expect(paused.status).toBe('Paused by workspace')
    expect(disabled.state).toBe('off')
    expect(disabled.status).toBe('Disabled by workspace')
  })

  test('enabled workspace without normalized telemetry reports waiting', () => {
    const health = deriveFollowUpHealth({
      enabled: true,
      paused: false,
      latestRun: null,
      recentEventCount: 0,
      now: NOW,
    })

    expect(health.state).toBe('waiting')
    expect(health.status).toBe('Enabled; waiting for heartbeat')
    expect(health.lastAt).toBeNull()
  })
})
