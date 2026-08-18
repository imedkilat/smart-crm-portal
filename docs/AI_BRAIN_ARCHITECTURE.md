# Smart CRM AI Brain Architecture

Smart CRM does not pretend that an LLM retrains its model weights after every question. The commercial learning model is a layered memory and retrieval system that keeps business truth separate from AI-generated context.

## Goal

The AI Brain should become more useful as a workspace accumulates CRM activity, questions, explicit corrections, preferences, and commercial outcomes — without allowing hallucinated answers or one tenant's data to contaminate another tenant.

## Responsibility boundaries

### Supabase is durable business truth

Supabase owns authoritative state such as:

- workspace membership and permissions
- leads, contacts, companies, and deals
- pipeline and stage state
- task completion
- monetary values and currency
- explicit user corrections
- durable AI interaction history
- durable memory records and their provenance
- vector documents and metadata

AI must not invent or override these fields.

### n8n is the AI and automation orchestration layer

n8n owns orchestration such as:

- collecting trusted CRM context
- calling Gemini
- short-term conversation continuity
- semantic memory retrieval through Supabase pgvector
- candidate-memory extraction
- vector indexing
- automation routing
- future durable event processing, retry, and dead-letter flows

### Gemini is a reasoning component, not the database

Gemini can:

- classify
- summarize
- explain
- compare
- recommend
- identify possible patterns
- draft follow-up
- extract candidate memories

Gemini cannot be the authority for:

- workspace identity
- permissions
- record identifiers
- money or currency
- pipeline stage
- task completion
- billing or subscription state
- immutable source fields

## Three memory layers

### 1. Short-term conversation memory

Used only by the AI Copilot. n8n Window Buffer Memory is keyed by workspace and conversation ID.

Purpose:

- conversational continuity
- pronouns and follow-up questions
- avoid forcing the user to repeat immediate context

This memory is not durable business truth.

### 2. Durable interaction history

Every Copilot question is stored in `ai_interactions` with:

- workspace
- user
- conversation
- question
- answer
- model
- execution ID
- context snapshot
- status and timestamps

Previous AI answers are conversation history, not evidence by themselves.

### 3. Durable semantic memory

Reusable knowledge is represented in `ai_memories` and indexed into `ai_memory_documents` with Gemini embeddings.

Memory types:

- `fact`
- `preference`
- `correction`
- `outcome`
- `pattern`

Memory scopes:

- workspace
- lead
- contact
- company
- deal

Each memory carries confidence, status, provenance, evidence count, metadata, and usage information.

## Candidate vs active memory

AI-extracted memories are created as `candidate`, not immediately trusted.

Examples:

- a recurring sales pattern inferred from recent deals
- a possible operating preference inferred from conversation
- an apparent historical outcome

Candidate memory may be retrieved, but the Copilot must treat it as tentative.

Explicit user correction is different. When the user uses **Correct this**, the correction is written to `ai_feedback`, and a database trigger promotes it into an `active` correction memory with confidence `1.000`.

This prevents the AI from teaching itself that its own hallucinations are facts.

## Retrieval

The Copilot uses the native n8n Supabase Vector Store in `retrieve-as-tool` mode.

The vector query is filtered by `workspace_id`, and the database trigger requires vector documents to carry valid workspace metadata.

The AI sees:

1. live trusted CRM snapshot
2. optional scoped record context
3. recent conversation history
4. semantically retrieved durable workspace memory

Live CRM truth always wins over remembered context.

## AI-ready context views

`workspace_ai_snapshot` provides compact, database-calculated context including:

- active leads and Hot/Warm/Cold mix
- USD lead budget value
- open and won deal value
- stale open deals
- open, overdue, and due-today tasks
- contacts and companies counts
- latest activity timestamp

`lead_ai_context` provides scoped lead context including:

- source inquiry
- AI classification
- routing signal
- sales stage
- task pressure
- recent notes
- conversion state

These views reduce prompt size and prevent the model from improvising database math.

## Lead classifier isolation

Lead Intake classification must remain stateless.

The lead classifier owns only:

- category: Hot / Warm / Cold
- intent
- summary

Source data — name, email, message, budget, currency, workspace — is preserved independently from the AI output.

No conversational memory should connect to the classifier. Lead B must never be classified differently because Lead A previously changed an AI memory buffer.

## Current n8n workflows

- `Smart CRM - Lead Intake - Commercial Multi Tenant USD`
- `Smart CRM - AI Copilot & Learning Engine`
- `Smart CRM - AI Memory Indexer`

The query workflow and indexing workflow are intentionally separate so retrieval and ingestion can scale independently.

## Future learning upgrades

The memory model is designed to support:

- memory review/approval UI
- automatic superseding of conflicting memory
- evidence-based promotion after repeated CRM outcomes
- memory decay for stale patterns
- usage-weighted retrieval
- deal-risk learning from won/lost outcomes
- next-best-action ranking
- explainable recommendations with cited CRM evidence
- workspace-specific sales playbooks
- industry templates without industry-specific core schema

The target is not a chatbot with history. The target is a workspace-scoped revenue intelligence system that becomes operationally smarter over time while preserving auditability and tenant isolation.
