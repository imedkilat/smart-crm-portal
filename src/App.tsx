import { isSupabaseConfigured } from './lib/supabase'

export default function App() {
  return (
    <main className="shell">
      <section className="card">
        <div className="eyebrow">SMART CRM PORTAL · V2</div>
        <h1>Rebuild scaffold is ready.</h1>
        <p>
          React + TypeScript is initialized. Next we port the approved Claude Design UI,
          connect the existing Supabase data, then wire authentication and n8n workflows.
        </p>
        <div className="status-row">
          <span className={`status ${isSupabaseConfigured ? 'ready' : 'pending'}`}>
            <span className="dot" />
            {isSupabaseConfigured ? 'Supabase configured' : 'Supabase env not configured yet'}
          </span>
        </div>
      </section>
    </main>
  )
}
