import React, { useState } from 'react'

// First-run tour: a short card deck pointing at where everything lives.
// Shown once per browser (localStorage, so it never blocks a shared account
// on a device that has already seen it) and reopenable from the settings menu.

const SEEN_KEY = 'streak.onboarded.v1'

export function needsOnboarding() {
  try { return !localStorage.getItem(SEEN_KEY) } catch { return false }
}

export function markOnboarded() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* private mode: shrug */ }
}

const STEPS = [
  {
    icon: '📅',
    title: 'Welcome to Streak',
    body: 'Your month at a glance. Double-click any day (or tap it and use “+ Add” on a phone) to create a task there. Single-click a day to select it.',
  },
  {
    icon: '🔥',
    title: 'Daily habits',
    body: 'The bar above the calendar holds your recurring daily tasks — check them off as you go. Finish every one and the day turns green; the flame in the top-right counts your streak of green days.',
  },
  {
    icon: '☑️',
    title: 'Working with tasks',
    body: 'Click a task’s circle to complete it, double-click the card to open it. Inside you can write notes and checklists, pick a category, and reschedule on the mini calendar. Drag cards to reorder a day.',
  },
  {
    icon: '⚙️',
    title: 'Everything else',
    body: 'The emoji button (top right) opens settings: categories, daily tasks, colors, the cyberpunk skin, and backups. The floating notepad icon is your sticky notes, and “Launch Streak notes” opens the full notes app.',
  },
]

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0)
  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div className="tour-backdrop">
      <div className="tour-card" role="dialog" aria-label="Introduction tour">
        <div className="tour-icon" aria-hidden="true">{s.icon}</div>
        <div className="tour-title">{s.title}</div>
        <div className="tour-body">{s.body}</div>
        <div className="tour-dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} className={`tour-dot ${i === step ? 'on' : ''}`} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="tour-skip" onClick={onDone}>Skip</button>
          <span className="spacer" />
          {step > 0 && (
            <button onClick={() => setStep(step - 1)}>Back</button>
          )}
          <button
            className="primary"
            autoFocus
            onClick={() => (last ? onDone() : setStep(step + 1))}
          >
            {last ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
