# n8n Orchestration in Smart CRM

n8n is a first-class orchestration layer in Smart CRM, not a hidden one-off automation.

## Production trust boundary

The browser never calls private n8n webhooks directly.

```text
Authenticated CRM UI
        ↓
Supabase Edge Function
  - JWT verification
  - workspace authorization
  - record-scope validation
  - payload validation
  - size limits
  - rate limiting
  - idempotency
        ↓
Private Header Auth
        ↓
n8n workflow
        ↓
Gemini / Supabase / external integrations
```

The Edge Function injects trusted workspace identity. Client-supplied workspace context is never sufficient by itself.

## Lead Intake

Commercial Lead Intake is deliberately stateless at the AI layer.

```text
Manual / Excel source
        ↓
Trusted source fields ───────────────┐
        ↓                            │
Gemini classification               │
(category, intent, summary only)     │
        ↓                            │
Merge source + classification ←─────┘
        ↓
Normalize
        ↓
Supabase
        ↓
Airtable mirror / downstream automation
```

This prevents an LLM from mutating authoritative business fields.

## AI Copilot query workflow

```text
Secure AI webhook
    ↓
Validate trusted request
    ↓
Create ai_interactions row
    ↓
Workspace AI snapshot
    ↓
Recent interaction context
    ↓
Optional record context
    ↓
Smart CRM Copilot Agent
    ├─ Gemini chat model
    ├─ short-term Window Buffer Memory
    └─ Supabase Vector Store memory tool
    ↓
Complete interaction row
    ↓
Return answer

Parallel after answer:
Copilot output + question
    ↓
Memory Candidate Extractor
    ↓
Normalize candidates
    ↓
ai_memories (candidate)
```

## AI Memory Indexer

The indexer is separate from the query workflow.

```text
Schedule / manual trigger
       ↓
Get active + candidate ai_memories
       ↓
Compare with indexed vector documents
       ↓
Only unindexed memories
       ↓
Default Data Loader
       ↓
Gemini 768-dimensional embeddings
       ↓
Supabase Vector Store
```

Vector document metadata includes workspace and memory provenance so retrieval can be tenant-scoped and explainable.

## Why separate workflows

Lead classification, AI querying, and vector ingestion have different failure modes and scaling needs.

Separating them means:

- a memory-indexing failure cannot block lead intake
- conversational memory cannot contaminate lead classification
- the AI query path can be rate-limited independently
- vector ingestion can be batched or scheduled
- workflows can be retried and observed independently
- future queues/workers can replace synchronous sections without redesigning the CRM model

## Current protection layers

### Lead Intake Edge gateway

- JWT required
- workspace membership resolved server-side
- USD-only input
- JSON and multipart validation
- payload limits
- per workspace + user rate limit
- idempotency
- private n8n Header Auth

### Status Routing Edge gateway

- JWT required
- lead is resolved from database
- caller must belong to lead workspace
- routing enum validation
- duplicate event protection
- per workspace + user rate limit
- private n8n Header Auth

### AI Copilot Edge gateway

- JWT required
- workspace membership resolution
- lead/contact/company/deal scope validation
- 48KB payload limit
- 15 requests per minute per workspace + user
- idempotency
- 60-second upstream timeout
- trusted workspace/user injection

## Next orchestration layer: durable outbox

The next reliability upgrade is to move expensive side effects to a durable event model:

```text
CRM transaction
   ↓
automation_outbox
   ↓
worker / n8n
   ↓
automation_execution
   ├─ success
   ├─ retry with backoff
   └─ dead letter
```

This will ensure a third-party outage cannot make a CRM write disappear or falsely appear successful.

## Future n8n use

The product roadmap intentionally keeps n8n central for:

- stage-change automation rules
- stale lead/deal detection
- email and messaging actions
- follow-up reminders
- webhook/API ingestion
- reporting generation
- memory consolidation
- AI next-best-action workflows
- integration marketplace connectors
- scheduled executive briefs
- usage/health monitoring

Smart CRM is therefore not simply a React frontend with an n8n demo behind it. n8n is the workflow runtime connecting trusted CRM state, AI reasoning, external systems, and future durable automation execution.
