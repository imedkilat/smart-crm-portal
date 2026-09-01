import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { invokeSecureAutomation } from '../lib/secureFunctions'
import type { Database } from '../types/database'
import '../copilot.css'
import { useWorkspace } from '../workspace-context'

type Interaction = Database['public']['Tables']['ai_interactions']['Row']
type Memory = Database['public']['Tables']['ai_memories']['Row']

type CopilotResponse = {
  answer?: string
  interaction_id?: string
  conversation_id?: string
  memory?: string
}

type WorkspaceState = {
  id: string
  name: string
}

type WorkspaceRole = 'owner' | 'admin' | 'member'

const quickPrompts = [
  'What needs my attention today?',
  'Which opportunities look most at risk right now?',
  'What is the strongest signal in my pipeline?',
  'What have you learned about how this business operates?',
]

function conversationStorageKey(workspaceId: string) {
  return `smart-crm-copilot-conversation:${workspaceId}`
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function CopilotPage() {
  const { activeWorkspace } = useWorkspace()
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole>('member')
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [memories, setMemories] = useState<Memory[]>([])
  const [question, setQuestion] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [correctionFor, setCorrectionFor] = useState<string | null>(null)
  const [correction, setCorrection] = useState('')
  const [feedbackSaving, setFeedbackSaving] = useState(false)
  const [memorySavingId, setMemorySavingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Supabase is not configured.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const workspaceId = activeWorkspace.workspaceId
    const [interactionResult, memoryResult] = await Promise.all([
      supabase.from('ai_interactions').select('*').eq('workspace_id', workspaceId).eq('status', 'completed').order('created_at', { ascending: false }).limit(30),
      supabase.from('ai_memories').select('*').eq('workspace_id', workspaceId).in('status', ['active', 'candidate']).order('updated_at', { ascending: false }).limit(100),
    ])

    if (interactionResult.error || memoryResult.error) {
      setError(interactionResult.error?.message || memoryResult.error?.message || 'Could not load AI workspace.')
      setLoading(false)
      return
    }

    const currentWorkspace = { id: activeWorkspace.workspaceId, name: activeWorkspace.name }
    setWorkspace(currentWorkspace)
    setWorkspaceRole((activeWorkspace.role as WorkspaceRole) || 'member')
    setInteractions((interactionResult.data || []) as Interaction[])
    setMemories((memoryResult.data || []) as Memory[])

    const storedConversation = window.localStorage.getItem(conversationStorageKey(currentWorkspace.id))
    if (storedConversation) setConversationId(storedConversation)
    setLoading(false)
  }, [activeWorkspace.name, activeWorkspace.role, activeWorkspace.workspaceId])

  useEffect(() => { void load() }, [load])

  const activeMemories = useMemo(() => memories.filter((memory) => memory.status === 'active'), [memories])
  const candidateMemories = useMemo(() => memories.filter((memory) => memory.status === 'candidate'), [memories])
  const canReviewMemories = workspaceRole === 'owner' || workspaceRole === 'admin'

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || !workspace || sending) return

    setSending(true)
    setError(null)
    setNotice(null)

    const requestId = `ai_${crypto.randomUUID()}`
    const currentConversation = conversationId || `conv_${crypto.randomUUID()}`

    try {
      const raw = await invokeSecureAutomation(
        'crm-ai-copilot',
        {
          question: trimmed,
          conversation_id: currentConversation,
          scope_type: 'workspace',
          scope_key: null,
          request_id: requestId,
        },
        { workspaceId: workspace.id, idempotencyKey: requestId },
      )

      const payload = JSON.parse(raw) as CopilotResponse
      if (!payload.answer) throw new Error('AI Brain returned no answer.')

      const nextConversation = payload.conversation_id || currentConversation
      setConversationId(nextConversation)
      window.localStorage.setItem(conversationStorageKey(workspace.id), nextConversation)
      setQuestion('')
      setNotice('Answer saved to workspace AI history. New durable memory candidates are extracted separately.')
      await load()
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : 'AI Brain request failed.')
    } finally {
      setSending(false)
    }
  }

  async function rateInteraction(interaction: Interaction, rating: -1 | 1) {
    if (!supabase || !workspace || feedbackSaving) return
    setFeedbackSaving(true)
    setError(null)
    setNotice(null)

    const { data: authData } = await supabase.auth.getUser()
    const { error: feedbackError } = await supabase.from('ai_feedback').insert({
      workspace_id: workspace.id,
      interaction_id: interaction.id,
      rating,
      scope_type: 'workspace',
      created_by: authData.user?.id || null,
    })

    if (feedbackError) setError(feedbackError.message)
    else setNotice(rating === 1 ? 'Feedback saved.' : 'Feedback saved. Add a correction if you want the AI to remember the right answer.')
    setFeedbackSaving(false)
  }

  async function saveCorrection(interaction: Interaction) {
    const body = correction.trim()
    if (!supabase || !workspace || !body || feedbackSaving) return
    setFeedbackSaving(true)
    setError(null)
    setNotice(null)

    const { data: authData } = await supabase.auth.getUser()
    const { error: feedbackError } = await supabase.from('ai_feedback').insert({
      workspace_id: workspace.id,
      interaction_id: interaction.id,
      rating: -1,
      correction: body,
      scope_type: 'workspace',
      created_by: authData.user?.id || null,
    })

    if (feedbackError) {
      setError(feedbackError.message)
    } else {
      setCorrection('')
      setCorrectionFor(null)
      setNotice('Correction saved as high-confidence durable workspace memory.')
      await load()
    }
    setFeedbackSaving(false)
  }

  async function reviewMemory(memory: Memory, status: 'active' | 'rejected') {
    if (!supabase || !workspace || !canReviewMemories || memorySavingId) return

    setMemorySavingId(memory.id)
    setError(null)
    setNotice(null)

    const { error: memoryError } = await supabase
      .from('ai_memories')
      .update({ status })
      .eq('id', memory.id)
      .eq('workspace_id', workspace.id)

    if (memoryError) {
      setError(memoryError.message)
    } else {
      setNotice(status === 'active' ? 'Memory approved for future AI context.' : 'Memory rejected and removed from the review queue.')
      await load()
    }

    setMemorySavingId(null)
  }

  function startNewConversation() {
    if (!workspace) return
    const next = `conv_${crypto.randomUUID()}`
    window.localStorage.setItem(conversationStorageKey(workspace.id), next)
    setConversationId(next)
    setNotice('Started a fresh short-term conversation. Durable workspace memory remains available.')
  }

  return (
    <>
      <section className="page-heading copilot-heading">
        <div>
          <div className="eyebrow">WORKSPACE INTELLIGENCE · N8N + GEMINI + PGVECTOR</div>
          <h1>AI Brain</h1>
          <p>Ask the CRM about pipeline health, follow-up risk, operating patterns, and what it has learned about this workspace.</p>
        </div>
        <button className="button secondary" type="button" onClick={startNewConversation} disabled={!workspace}>New conversation</button>
      </section>

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="copilot-notice">✓ {notice}</div>}

      <section className="copilot-kpis">
        <article><span>Saved conversations</span><strong>{loading ? '—' : interactions.length}</strong><small>Durable workspace history</small></article>
        <article><span>Active memory</span><strong>{loading ? '—' : activeMemories.length}</strong><small>Trusted reusable context</small></article>
        <article><span>Memory candidates</span><strong>{loading ? '—' : candidateMemories.length}</strong><small>Useful but not yet authoritative</small></article>
        <article><span>Memory boundary</span><strong>Workspace</strong><small>No cross-tenant retrieval</small></article>
      </section>

      <section className="copilot-layout">
        <article className="panel copilot-chat-panel">
          <div className="copilot-chat-heading">
            <div><span className="mini-label">REVENUE OPERATIONS COPILOT</span><h2>{workspace?.name || 'Workspace'} intelligence</h2></div>
            <span className="copilot-live"><i /> live CRM context</span>
          </div>

          <div className="copilot-quick-prompts">
            {quickPrompts.map((prompt) => <button type="button" key={prompt} onClick={() => setQuestion(prompt)}>{prompt}</button>)}
          </div>

          <div className="copilot-thread">
            {interactions.slice(0, 12).map((item) => (
              <article className="copilot-turn" key={item.id}>
                <div className="copilot-question"><span>You</span><p>{item.question}</p></div>
                <div className="copilot-answer">
                  <div className="copilot-answer-meta"><span>✦ Smart CRM</span><time>{formatTime(item.created_at)}</time></div>
                  <p>{item.answer}</p>
                  <div className="copilot-feedback-actions">
                    <button type="button" onClick={() => void rateInteraction(item, 1)} disabled={feedbackSaving}>Useful</button>
                    <button type="button" onClick={() => { setCorrectionFor(item.id); setCorrection('') }} disabled={feedbackSaving}>Correct this</button>
                  </div>
                  {correctionFor === item.id && (
                    <div className="copilot-correction">
                      <textarea value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="Tell the CRM what it should remember instead…" maxLength={8000} />
                      <div><button className="button secondary" type="button" onClick={() => setCorrectionFor(null)}>Cancel</button><button className="button primary" type="button" onClick={() => void saveCorrection(item)} disabled={!correction.trim() || feedbackSaving}>Save correction to memory</button></div>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {!loading && interactions.length === 0 && <div className="copilot-empty"><strong>Your AI history starts here.</strong><span>Ask about today&apos;s priorities, pipeline risk, or what the CRM should learn about this business.</span></div>}
          </div>

          <form className="copilot-composer" onSubmit={ask}>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask Smart CRM about your business…" maxLength={12000} />
            <div className="copilot-composer-footer"><span>Current CRM data overrides remembered context.</span><button className="button primary" type="submit" disabled={!question.trim() || sending || !workspace}>{sending ? 'Thinking…' : 'Ask AI Brain'}</button></div>
          </form>
        </article>

        <aside className="panel copilot-memory-panel">
          <div className="copilot-memory-heading"><span className="mini-label">CUMULATIVE LEARNING</span><h2>Workspace memory</h2><p>Long-term context is stored separately from the model, with provenance and confidence.</p></div>
          <div className="copilot-memory-list">
            {memories.slice(0, 18).map((memory) => (
              <article className={`copilot-memory-item ${memory.status}`} key={memory.id}>
                <div><span className={`memory-status ${memory.status}`}>{memory.status}</span><span className="memory-type">{memory.memory_type}</span></div>
                <p>{memory.content}</p>
                <small>{Math.round(memory.confidence * 100)}% confidence · evidence {memory.evidence_count}</small>
                {memory.status === 'candidate' && canReviewMemories && (
                  <div className="copilot-memory-actions">
                    <button type="button" onClick={() => void reviewMemory(memory, 'rejected')} disabled={memorySavingId !== null}>Reject</button>
                    <button type="button" className="approve" onClick={() => void reviewMemory(memory, 'active')} disabled={memorySavingId !== null}>
                      {memorySavingId === memory.id ? 'Saving…' : 'Approve'}
                    </button>
                  </div>
                )}
              </article>
            ))}
            {!loading && memories.length === 0 && <div className="copilot-memory-empty">No durable memories yet. They build as the workspace is used and corrected.</div>}
          </div>
        </aside>
      </section>
    </>
  )
}
