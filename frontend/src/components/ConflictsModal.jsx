import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'

// Bare-bones sync-conflict resolver. A conflict means two nodes edited the
// same thing while apart; the newer version already won and the app kept
// working — this list is the chance to overrule that. "Keep" blesses what
// won; "Restore" puts the losing version back (as a fresh edit, so it
// propagates to every node on the next sync).

const LABELS = {
  categories: 'Category', projects: 'Project', tasks: 'Task',
  daily_tasks: 'Daily task', daily_task_completions: 'Completion',
  settings: 'Setting',
}

function describe(tbl, data) {
  if (!data) return ''
  if (data.deleted_at) return '(deleted)'
  if (tbl === 'settings') return String(data.value)
  const name = data.description ?? data.name ?? ''
  const extra = [
    data.due_date, data.done === true ? 'done' : null, data.color,
  ].filter(Boolean).join(', ')
  return extra ? `${name} (${extra})` : String(name)
}

export default function ConflictsModal({ onClose, onChanged }) {
  const [conflicts, setConflicts] = useState(null)

  const load = useCallback(async () => {
    try { setConflicts(await api.syncConflicts()) }
    catch (e) { alert(`Loading conflicts failed: ${e.message}`); onClose() }
  }, [onClose])

  useEffect(() => { load() }, [load])

  const settle = async (id, restore) => {
    try {
      await api.resolveConflict(id, restore)
      setConflicts((cs) => cs.filter((c) => c.id !== id))
      onChanged()
    } catch (e) {
      alert(`Resolving failed: ${e.message}`)
    }
  }

  return (
    <div className="conflicts-overlay" onClick={onClose}>
      <div className="conflicts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="conflicts-head">
          <span>Sync conflicts</span>
          <button onClick={onClose}>✕</button>
        </div>
        {conflicts === null && <div className="conflicts-empty">Loading…</div>}
        {conflicts !== null && conflicts.length === 0 && (
          <div className="conflicts-empty">No conflicts. Everything merged cleanly.</div>
        )}
        {conflicts !== null && conflicts.map((c) => (
          <div key={c.id} className="conflict-row">
            <div className="conflict-what">
              <b>{LABELS[c.tbl] || c.tbl}</b>
              <span className="conflict-when">
                {new Date(c.created_at).toLocaleString()}
              </span>
            </div>
            <div className="conflict-versions">
              <div>
                <span className="conflict-tag kept">kept</span> {describe(c.tbl, c.kept)}
              </div>
              <div>
                <span className="conflict-tag lost">other</span> {describe(c.tbl, c.lost)}
              </div>
            </div>
            <div className="conflict-actions">
              <button onClick={() => settle(c.id, false)}>Keep</button>
              <button onClick={() => settle(c.id, true)}>Restore other</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
