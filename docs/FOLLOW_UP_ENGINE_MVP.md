# Follow-Up Engine MVP

## Purpose

Create internal follow-up tasks for stale active leads without sending email, SMS, or calendar events.

This replaces the obsolete Google Sheets-era workflow. Do not activate `crm-follow-up-engine.json`.

## Safety state

- Workflow export: inactive
- `Safety Configuration.write_enabled`: `false`
- External email: absent
- SMS: absent
- Calendar creation: absent
- Production data mutation: blocked until the safety switch is explicitly enabled

## MVP rules

| Lead | Stale threshold | Task priority | Due after creation |
|---|---:|---|---:|
| Hot | 2 hours | High | 2 hours |
| Warm | 24 hours | Medium | 24 hours |

The workflow:

1. Runs hourly in the `Asia/Manila` timezone.
2. Reads active Hot and Warm leads.
3. Uses the latest lead activity, falling back to the lead update/create time.
4. Excludes leads in Won or Lost stages.
5. Skips any lead with an existing open task.
6. Uses a daily deterministic marker in the task description to prevent same-day duplicates.
7. Creates an internal `lead_tasks` row only when writes are explicitly enabled.
8. Relies on the existing database trigger to add the task-created event to `lead_activities`.

## Import

1. Import `n8n/workflows/crm-follow-up-engine-mvp.json` into n8n.
2. Select the existing Smart CRM Supabase credential on all five Supabase nodes.
3. Confirm the imported workflow is inactive.
4. Confirm `Safety Configuration.write_enabled` is still `false`.
5. Save as an unpublished draft.

Do not copy keys, passwords, or tokens into the workflow JSON or GitHub.

## Dry-run verification

Run the workflow manually while `write_enabled=false`.

Expected result:

- All read nodes succeed.
- `Dry Run No-op Summary` reports zero or more eligible candidates.
- `Create Internal Follow-up Task` does not run.
- `lead_tasks` count does not change.
- No email, SMS, or calendar event is produced.

## Controlled write verification

Requires separate approval.

1. Use a dedicated QA lead in an open pipeline stage.
2. Ensure the QA lead has no open task.
3. Set its last activity old enough to satisfy the relevant threshold.
4. Set `write_enabled=true`.
5. Execute once manually.
6. Verify exactly one task is created with the expected priority and due date.
7. Verify the lead timeline contains the server-side `task_created` activity.
8. Execute again on the same Manila calendar day and verify no duplicate task is created.
9. Restore `write_enabled=false` before any further edits.

Do not archive or delete the QA lead without explicit approval.

## Acceptance criteria

- [ ] Import succeeds without embedded secrets.
- [ ] Dry-run identifies candidates without writes.
- [ ] Won and Lost leads are excluded.
- [ ] Leads with open tasks are skipped.
- [ ] A controlled run creates exactly one internal task.
- [ ] Task priority and due date match the routing rule.
- [ ] Task creation appears in the activity timeline.
- [ ] Same-day rerun does not create a duplicate.
- [ ] No external message or calendar event is sent.
