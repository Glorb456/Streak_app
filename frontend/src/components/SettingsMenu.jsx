import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { DAY_NAMES, EVERY_DAY } from '../dates.js'

// Mon-first initials for the weekday toggles. Tue/Thu and Sat/Sun collide, so
// the full name rides along in each button's title.
const DAY_LETTERS = DAY_NAMES.map((d) => d[0])

// Streak Notes shares this origin (nginx proxies /notes/ to it), which is
// what lets the two apps share one authorization state.
const NOTES_URL = '/notes/'

// Streak emoji in the top right with the current streak count on top;
// dropdown offers category colors, daily tasks + colors, background color,
// and the streak emoji itself.
export default function SettingsMenu({ categories, dailyTasks, settings, streak, onChanged }) {
  const [open, setOpen] = useState(false)
  const [panel, setPanel] = useState(null) // 'categories' | 'daily' | 'background' | 'emoji'
  const [emojiDraft, setEmojiDraft] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    // Close on 'click', not 'mousedown': mousedown would unmount the panel's
    // inputs before their blur handlers run, silently dropping pending saves.
    const close = (e) => {
      // A target detached mid-click was a menu/panel element React swapped
      // out during the click (e.g. menu -> emoji panel) — that's an inside
      // click, not an outside one, even though contains() can't see it.
      if (!e.target.isConnected) return
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setPanel(null) }
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  // Run an API call, refresh app state, and surface failures instead of
  // silently doing nothing.
  const call = async (fn) => {
    try { await fn() } catch (e) { alert(`Saving failed: ${e.message}`) }
    onChanged()
  }

  const updateCategory = (c, patch) =>
    call(() => api.updateCategory(c.id, { name: patch.name ?? c.name, color: patch.color ?? c.color }))
  // PUT /daily/{id} replaces the whole record, so days_mask has to ride along
  // on every edit or renaming a task would silently reset it to every day.
  // ?? not ||, since a mask of 0 (parked) must survive.
  const updateDaily = (d, patch) =>
    call(() => api.updateDailyTask(d.id, {
      name: patch.name ?? d.name,
      color: patch.color ?? d.color,
      days_mask: patch.days_mask ?? d.days_mask ?? EVERY_DAY,
    }))

  const emoji = settings.streak_emoji || '🔥'

  return (
    <div className="settings" ref={ref}>
      <button className="pfp" onClick={() => { setOpen(!open); setPanel(null) }} aria-label="settings">
        {emoji}
        <span className="streak-badge">{streak}</span>
      </button>

      {open && !panel && (
        <div className="dropdown">
          <button onClick={() => setPanel('categories')}>Change category colors</button>
          <button onClick={() => setPanel('daily')}>Change daily tasks + colors</button>
          <button onClick={() => setPanel('background')}>Change background color</button>
          <button onClick={() => { setEmojiDraft(emoji); setPanel('emoji') }}>Change streak emoji</button>
          {/* Streak Notes is a separate app on the same origin, so this is a
              plain navigation: one oauth2-proxy session already covers both
              and there is no second login on the way over. */}
          <button className="launch-notes" onClick={() => { window.location.href = NOTES_URL }}>
            Launch Streak notes
          </button>
        </div>
      )}

      {open && panel === 'emoji' && (
        <div className="dropdown panel">
          <div className="panel-title">Streak emoji</div>
          <div className="panel-row">
            <input
              value={emojiDraft}
              maxLength={16}
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => setEmojiDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && emojiDraft.trim()) {
                  call(() => api.setSetting('streak_emoji', emojiDraft.trim()))
                }
              }}
            />
            <button
              className="panel-save"
              disabled={!emojiDraft.trim()}
              onClick={() => call(() => api.setSetting('streak_emoji', emojiDraft.trim()))}
            >
              Save
            </button>
          </div>
          <div className="panel-row">
            <span className="panel-hint">current streak: {streak}</span>
          </div>
        </div>
      )}

      {open && panel === 'categories' && (
        <div className="dropdown panel">
          <div className="panel-title">Categories</div>
          {categories.map((c) => (
            <div key={c.id} className="panel-row">
              <input
                type="color"
                value={c.color}
                onChange={(e) => updateCategory(c, { color: e.target.value })}
              />
              <input
                defaultValue={c.name}
                onBlur={(e) => e.target.value !== c.name && updateCategory(c, { name: e.target.value })}
              />
              <button
                className="danger"
                onClick={() => call(() => api.deleteCategory(c.id))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={() => call(() => api.createCategory({ name: 'New category', color: '#7a7a7a' }))}
          >
            + Add category
          </button>
        </div>
      )}

      {open && panel === 'daily' && (
        <div className="dropdown panel">
          <div className="panel-title">Daily tasks (up to 5 per day shown on the page)</div>
          {dailyTasks.map((d) => {
            const mask = d.days_mask ?? EVERY_DAY
            return (
              <div key={d.id} className="panel-item">
                <div className="panel-row">
                  <input
                    type="color"
                    value={d.color}
                    onChange={(e) => updateDaily(d, { color: e.target.value })}
                  />
                  <input
                    defaultValue={d.name}
                    onBlur={(e) => e.target.value !== d.name && updateDaily(d, { name: e.target.value })}
                  />
                  <button
                    className="danger"
                    onClick={() => call(() => api.deleteDailyTask(d.id))}
                  >
                    ✕
                  </button>
                </div>
                <div className="panel-row panel-days">
                  {DAY_LETTERS.map((letter, i) => {
                    const on = (mask & (1 << i)) !== 0
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`day-toggle ${on ? 'on' : ''}`}
                        title={DAY_NAMES[i]}
                        aria-pressed={on}
                        onClick={() => updateDaily(d, { days_mask: mask ^ (1 << i) })}
                      >
                        {letter}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="panel-row">
            <span className="panel-hint">Turn every day off to park a task.</span>
          </div>
          <button
            onClick={() => call(() => api.createDailyTask({ name: 'New daily task', color: '#f9e2ce' }))}
          >
            + Add daily task
          </button>
        </div>
      )}

      {open && panel === 'background' && (
        <div className="dropdown panel">
          <div className="panel-title">Background color</div>
          <div className="panel-row">
            <input
              type="color"
              value={settings.background_color || '#191919'}
              onChange={(e) => call(() => api.setSetting('background_color', e.target.value))}
            />
            <span>Main background</span>
          </div>
        </div>
      )}
    </div>
  )
}
