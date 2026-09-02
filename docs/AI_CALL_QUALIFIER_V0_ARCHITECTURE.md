# AI Call Qualifier V0 Architecture

Status: architecture spike / no-live-call design

## Goal

Add a cross-industry outbound AI call qualifier to Smart CRM Portal that can:

1. call an eligible lead,
2. determine whether the lead is interested enough for human follow-up,
3. if qualified, privately contact the lead's assigned rep,
4. brief the rep while the lead remains on hold,
5. wait for the rep to accept or decline,
6. bridge the lead only after the rep accepts,
7. create a CRM callback task when the rep is unavailable, declines, or transfer fails,
8. write the entire call lifecycle back to the same CRM record.

The AI qualifies and hands off. It does not conduct the human sales conversation after a successful bridge.

## V0 product decision

Use **Retell AI Conversation Flow + agentic warm transfer** as the primary V0 voice/transfer platform.

Use **Retell telephony for the first controlled US-only QA path** unless a later implementation constraint requires importing a Twilio number or custom SIP telephony.

Do not introduce a separate Twilio/Telnyx transfer controller in V0. Retell's current agentic warm-transfer flow already supports the key requirement: the lead is held while a transfer agent has a private two-way conversation with the destination rep and can then bridge or cancel the transfer.

### Why Retell for V0

Retell currently provides:

- outbound phone-call API,
- Conversation Flow agents,
- cold, warm, and agentic warm transfer,
- private transfer-target conversation before bridge,
- human detection and transfer dial timeout,
- dynamic variables in prompts, transfer numbers, and warm-transfer instructions,
- transfer lifecycle webhooks,
- call-ended and call-analyzed webhooks,
- signed webhook verification,
- call transcripts and post-call analysis,
- pay-as-you-go pricing suitable for a controlled prototype.

The strongest architectural advantage is that qualification and private rep confirmation can live in one provider call graph for V0. That removes an extra telephony orchestration layer and reduces the number of partial-failure states we need to own.

### Vapi as fallback / second implementation candidate

Vapi is a valid alternative and has both traditional and assistant-based warm transfer. It is attractive when Smart CRM needs more explicit component choice across STT/LLM/TTS or deeper Twilio-specific call-leg control.

For V0, however, Vapi introduces more provider-cost composition and a broader telephony surface than we need for the first controlled implementation.

### Bland not selected for V0

Bland remains a possible future provider, but its current self-serve pricing/feature matrix is less compelling for this prototype. We should not create a multi-provider abstraction before real usage proves that we need one.

## Existing Smart CRM state verified during the spike

### Existing activity/task primitives we can reuse

`public.crm_activities`

- workspace-scoped generic CRM activity stream
- supports `activity_type`, `title`, JSON `metadata`, optional actor, and `occurred_at`

`public.lead_activities`

- workspace + lead scoped activity stream
- supports the same activity/metadata pattern

`public.lead_tasks`

- workspace + lead scoped tasks
- supports `assigned_to`, status, priority, due date, description, and `automation_key`

These are sufficient for V0 call outcome logging and callback-task fallback. We do not need a disconnected call-history product surface.

### Blocking data gaps

The current `public.leads` row has **no phone field**.

The current `public.leads` row also has **no canonical assigned rep / owner field**.

`public.contacts` has `phone` and `owner_user_id`, but the AI Call Qualifier is expected to operate on leads before conversion, so converted-contact fields cannot be treated as the source of truth.

`lead_tasks.assigned_to` is task ownership, not a safe canonical lead-owner source. V0 must not infer the transfer destination from whichever task happens to exist.

Therefore no real outbound-call implementation should ship until the lead call-readiness foundation exists.

## Required call-readiness foundation

The next implementation PR should introduce explicit, workspace-scoped call readiness rather than hide telephony data inside provider metadata.

### Lead phone

Add a canonical lead phone value normalized to E.164 before provider dispatch.

Recommended V0 field:

- `leads.phone_e164 text null`

Do not dispatch a call from a free-form phone value. Normalize/validate before the call request becomes eligible.

### Assigned rep

Add an explicit lead owner/rep reference.

Recommended V0 field:

- `leads.owner_user_id uuid null`

The owner must resolve to a current member of the same workspace before a transfer-capable call can start.

Longer term, lead/contact/deal ownership should share one consistent CRM ownership model.

### Rep transfer phone

Do not use Supabase Auth user metadata as the operational telephony source of truth.

Recommended V0 table:

`workspace_member_call_profiles`

- `workspace_id uuid`
- `user_id uuid`
- `phone_e164 text`
- `is_call_transfer_enabled boolean default false`
- timestamps
- unique `(workspace_id, user_id)`

Only workspace owner/admin should manage these values through the product. Backend dispatch must verify the user is still a member of the same workspace.

### Consent / opt-out state

Outbound AI calling must not be enabled merely because a lead has a phone number.

Consent and suppression should be modeled independently of call outcome. At minimum the future compliance foundation needs to represent:

- whether AI/outbound calling consent is present,
- when/how consent was captured,
- source/evidence,
- opt-out timestamp,
- internal suppression state,
- DNC screening state + last checked time.

The final legal/compliance design must be reviewed before US outbound calling goes live. The architecture spike does not claim that a specific schema alone satisfies TCPA/DNC obligations.

## V0 runtime topology

```text
Smart CRM UI / automation eligibility
        |
        v
Trusted call-dispatch boundary
  - workspace authorization
  - lead/workspace match
  - normalized phone
  - explicit assigned rep
  - rep transfer phone enabled
  - consent/suppression gate
  - plan/usage gate (before commercial launch)
  - idempotency + rate limit
        |
        v
Retell Create Phone Call
  metadata:
    workspace_public_id
    lead_public_id
    smart_crm_call_request_id
  dynamic variables:
    lead_name
    lead_summary
    qualification context
    assigned_rep_name
    assigned_rep_phone
        |
        v
Retell Conversation Flow
  qualify lead
        |
        +--> not qualified / no answer / voicemail / opt-out
        |        |
        |        v
        |    webhook -> CRM activity/outcome
        |
        +--> qualified
                 |
                 v
          Agentic warm transfer
          - lead on hold
          - call assigned rep privately
          - brief rep with compact lead summary
          - rep accepts / declines
                 |
        +--------+---------+
        |                  |
     accepts           decline/no answer/
        |              timeout/transfer failure
        v                  |
     bridge                v
        |            create CRM callback task
        v                  |
 transfer events           v
        +------------> CRM activity stream
```

## Qualification contract

V0 should use a deliberately small outcome vocabulary.

Primary qualification result:

- `qualified`
- `not_qualified`
- `needs_follow_up`
- `opted_out`
- `no_answer`
- `voicemail`
- `failed`

Transfer result, when qualification is `qualified`:

- `transferred`
- `rep_declined`
- `rep_no_answer`
- `transfer_timeout`
- `transfer_failed`

Do not overload lead category (`Hot/Warm/Cold`) as the phone-call outcome. Category can inform the prompt, but the call result is its own event.

## Retell event contract

Subscribe only to events Smart CRM needs for deterministic state:

- `call_started`
- `transfer_started`
- `transfer_bridged`
- `transfer_cancelled`
- `transfer_ended`
- `call_ended`
- `call_analyzed`

Webhook handling requirements:

1. verify `X-Retell-Signature` against the raw request body,
2. reject events whose embedded Smart CRM tenant identifiers cannot be resolved safely,
3. never trust provider metadata alone to cross workspace boundaries,
4. use provider `call_id` + event type as an idempotency key,
5. tolerate retries and out-of-order `call_ended` / `call_analyzed` arrival,
6. treat Retell analysis as evidence for a CRM activity, not as authorization to mutate unrelated tenant data,
7. preserve enough provider IDs in metadata for support reconciliation without exposing API secrets in the browser.

## CRM write contract

For every meaningful lifecycle result, write both the generic CRM stream and lead-specific stream using one trusted server-side operation.

Recommended activity type family:

- `ai_call.started`
- `ai_call.qualified`
- `ai_call.not_qualified`
- `ai_call.opted_out`
- `ai_call.no_answer`
- `ai_call.transfer_started`
- `ai_call.transferred`
- `ai_call.transfer_failed`
- `ai_call.completed`

Recommended metadata:

- Smart CRM call request ID
- Retell call ID
- provider name/version
- qualification result
- transfer result
- duration seconds
- billed/usage seconds when available
- assigned rep user ID
- transcript/recording references only when retention policy allows them
- post-call summary / extracted fields where appropriate

### Callback task fallback

When a qualified lead cannot be bridged to the assigned rep, create one idempotent `lead_tasks` row.

Recommended automation key pattern:

`ai-call-callback:<retell_call_id>`

Suggested task:

- title: `Call back qualified lead`
- assigned_to: canonical lead owner
- priority: high
- description: concise AI qualification + reason transfer did not complete
- due_at: product-defined short follow-up SLA

Webhook retries must not create duplicate callback tasks.

## V0 provider prompt boundary

The call agent may:

- identify the business clearly,
- explain the purpose of the call,
- ask the minimal qualification questions needed by the workspace's configured use case,
- honor opt-out immediately,
- summarize the lead for the rep,
- ask the assigned rep whether they are ready to take the lead,
- bridge only after acceptance.

The call agent must not:

- invent pricing or contractual terms,
- negotiate or close the sale after handoff criteria are met,
- continue persuasion after a clear opt-out,
- call another workspace's rep,
- select a transfer number from model-generated text,
- bypass consent, suppression, usage, or entitlement gates.

Transfer destinations must be supplied by trusted backend data as dynamic variables/tool configuration, never generated by the model.

## Failure behavior

### Lead does not answer

Log `no_answer` or voicemail outcome. Do not create a human callback task by default unless the product policy later requires one.

### Lead opts out

End the qualifying flow promptly, log `opted_out`, and write the suppression state through the future compliance boundary. Never retry through ordinary follow-up automation.

### Qualified but rep does not answer

Do not bridge. Create the idempotent callback task for the assigned rep.

### Rep declines

Do not bridge. Create callback task with `rep_declined` context unless the rep explicitly indicates the lead should not be contacted.

### Transfer failure

Keep provider/network failure distinct from rep rejection. Log the provider failure reason and create callback task if the lead was already qualified.

### Webhook failure

Retell retries signed webhook delivery. Handler must be idempotent. A periodic reconciliation job should later compare incomplete Smart CRM call requests against Retell call state.

## Billing / usage boundary

The current AI Call Qualifier usage-metering tracker item remains dependent on the Stripe commercialization runtime.

Before customer-facing outbound calling is enabled:

- track connected AI call seconds/minutes per workspace and billing period,
- enforce plan limits before dispatch,
- reserve enough usage capacity to prevent concurrent overspend,
- reconcile actual provider duration after completion,
- distinguish AI-active time from post-transfer telephony time if commercial pricing treats them differently,
- define hard global and per-workspace call caps.

Retell currently stops the AI-agent fee after a transfer while telephony can continue, so Smart CRM should preserve both pre-transfer AI duration and total telephony duration if exposed by the provider.

## Compliance launch boundary

No live US outbound AI calling until the dedicated consent/TCPA/DNC work item is complete and reviewed.

Architecture requirements already assumed by V0:

- explicit call eligibility, not "phone exists = callable",
- durable opt-out/suppression,
- DNC screening state,
- configurable calling windows/time-zone policy,
- clear business identification,
- retention controls for transcript/recording data,
- auditable reason why each call was eligible.

This document is an engineering design, not legal advice.

## V0 test strategy before a real lead call

### Phase A — source-only / no provider credentials

- validate schema and authorization design,
- build call-request state machine and webhook parser tests with signed fixture payloads,
- verify cross-workspace rejection,
- verify webhook replay idempotency,
- verify duplicate callback-task prevention,
- verify no provider call can be initiated when live calling flag is false.

### Phase B — Retell playground / simulated agent

- qualification prompt simulation,
- qualified vs not-qualified paths,
- opt-out path,
- rep briefing language,
- rep accept/decline behavior,
- transfer timeout behavior.

No production CRM lead phone is called in this phase.

### Phase C — controlled phone E2E

Only after consent/suppression and usage gates exist:

- one QA workspace,
- explicit QA lead phone allowlist,
- explicit QA rep phone allowlist,
- one call at a time,
- low global call cap,
- Retell test/pay-as-you-go environment only,
- verify signed webhook lifecycle,
- verify CRM activity rows,
- verify callback task fallback,
- verify bridge only after rep confirmation,
- verify usage accounting.

## Implementation sequence

1. **Architecture decision** — this document.
2. **Call-readiness CRM foundation** — lead E.164 phone, canonical lead owner, rep transfer profile, RLS/authorization.
3. **Compliance foundation** — consent evidence, suppression/opt-out, DNC screening state, launch controls.
4. **Provider ingress/egress skeleton** — Retell dispatch Edge Function + signed webhook, live calls disabled.
5. **CRM outcome logging** — `crm_activities`, `lead_activities`, idempotent callback task.
6. **Retell agent configuration** — Conversation Flow + agentic warm transfer in playground/simulation.
7. **Usage metering/plan gate** — integrate call seconds/minutes with commercialization runtime.
8. **Controlled QA allowlist E2E** — one workspace, one lead, one assigned rep.
9. **Commercial launch review** — compliance, cost caps, rate limits, observability, retention, support reconciliation.

## Explicit V0 non-goals

- multiple backup reps,
- rep availability toggle,
- round-robin transfer routing,
- multi-provider abstraction,
- autonomous AI sales closing,
- production US outbound dialing before compliance gates,
- live Stripe or real telephony rollout as part of this architecture PR.
