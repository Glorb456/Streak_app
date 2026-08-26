import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { iso, monthWeeks, todayIso, MONTH_NAMES } from './dates.js'
import { applyVisibleOrder, firstTaskIdOn, orderTasks, tasksOn } from './tasks.js'
import DailyBar from './components/DailyBar.jsx'
import Calendar from './components/Calendar.jsx'
import TaskModal from './components/TaskModal.jsx'
import SettingsMenu from './components/SettingsMenu.jsx'
import DayTaskList from './components/DayTaskList.jsx'

export default function App() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const [categories, setCategories] = useState([])
  const [dailyTasks, setDailyTasks] = useState([])
  const [settings, setSettings] = useState({})
  const [tasks, setTasks] = useState([])
  const [completions, setCompletions] = useState([])
  const [streak, setStreak] = useState(0)

  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [modal, setModal] = useState(null) // {mode:'new', date} | {mode:'edit', task}
  // A drag pauses the poll for the same reason an open modal does: a refresh
  // landing mid-drag would swap the rows out from under the pointer.
  const [dragging, setDragging] = useState(false)
  // Single-clicking a day selects it; the daily bar shows that day's status.
  const [selectedDay, setSelectedDay] = useState(todayIso())

  const weeks = useMemo(() => monthWeeks(year, month), [year, month])
  const rangeStart = iso(weeks[0][0])
  const rangeEnd = iso(weeks[weeks.length - 1][6])

  const syncAll = useCallback(async () => {
    if (!navigator.onLine) return
    setSyncing(true)
    try {
      const [cats, daily, sett, ts, comps, stk] = await Promise.all([
        api.categories(),
        api.dailyTasks(),
        api.settings(),
        api.tasks(rangeStart, rangeEnd),
        api.completions(rangeStart, rangeEnd),
        api.streak(todayIso()),
      ])
      setCategories(cats)
      setDailyTasks(daily)
      setSettings(sett)
      setTasks(ts)
      setCompletions(comps)
      setStreak(stk.streak)
    } catch (e) {
      console.error('sync failed', e)
    } finally {
      setSyncing(false)
    }
  }, [rangeStart, rangeEnd])

  // Initial load + reload when the visible month changes.
  useEffect(() => { syncAll() }, [syncAll])

  // Auto refresh every 5 seconds unless offline. Paused while a task popup
  // is open so a refresh can't race with (and briefly revert) live edits.
  const syncRef = useRef(syncAll)
  syncRef.current = syncAll
  const modalRef = useRef(null)
  modalRef.current = modal
  const draggingRef = useRef(false)
  draggingRef.current = dragging
  useEffect(() => {
    const t = setInterval(() => {
      if (navigator.onLine && !modalRef.current && !draggingRef.current) syncRef.current()
    }, 5000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const toggleDaily = async (dailyTask) => {
    const day = selectedDay
    const existing = completions.find(
      (c) => c.daily_task_id === dailyTask.id && c.day === day
    )
    const completed = !(existing && existing.completed)
    setCompletions((cs) => [
      ...cs.filter((c) => !(c.daily_task_id === dailyTask.id && c.day === day)),
      { daily_task_id: dailyTask.id, day, completed },
    ])
    try { await api.setCompletion({ daily_task_id: dailyTask.id, day, completed }) }
    catch { syncAll() }
  }

  const toggleTaskDone = async (task) => {
    const updated = { ...task, done: !task.done }
    setTasks((ts) => ts.map((t) => (t.id === task.id ? updated : t)))
    try { await api.updateTask(task.id, updated) }
    catch { syncAll() }
  }

  // Notion-style live edits from the task popup: persist immediately and
  // reflect on the calendar without closing the modal.
  const liveUpdateTask = async (task, data) => {
    try {
      const updated = await api.updateTask(task.id, data)
      setTasks((ts) => ts.map((t) => (t.id === task.id ? updated : t)))
    } catch (e) {
      alert(`Saving failed: ${e.message}`)
      syncAll()
    }
  }

  const saveTask = async (data, existing) => {
    if (existing) {
      const updated = await api.updateTask(existing.id, data)
      setTasks((ts) => ts.map((t) => (t.id === existing.id ? updated : t)))
    } else {
      const created = await api.createTask(data)
      // Ordered on read, so where this lands in the array doesn't matter —
      // the server gave it a position below its day's minimum, i.e. the top.
      setTasks((ts) => [...ts, created])
    }
    setModal(null)
  }

  const removeTask = async (task) => {
    try {
      await api.deleteTask(task.id)
      setTasks((ts) => ts.filter((t) => t.id !== task.id))
      setModal(null)
    } catch (e) {
      // Leave the modal open so it's clear the task survived.
      alert(`Delete failed: ${e.message}`)
      syncAll()
    }
  }

  const shiftMonth = (delta) => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }
  const goToday = () => {
    const d = new Date()
    setYear(d.getFullYear())
    setMonth(d.getMonth())
    setSelectedDay(todayIso())
  }

  const bg = settings.background_color || '#191919'

  // Settings values are always strings server-side.
  const hideDone = settings.hide_completed === '1'
  const editingId = modal?.mode === 'edit' ? modal.task.id : null
  // Filtered once here so the calendar and the mobile day list stay in step,
  // and so Calendar's week-height calculation sees the same list. The task
  // being edited is exempt, or checking it off yanks the card out from under
  // the open modal.
  const visibleTasks = useMemo(
    () => orderTasks(hideDone ? tasks.filter((t) => !t.done || t.id === editingId) : tasks),
    [tasks, hideDone, editingId]
  )

  // Derived from the *visible* list, so the highlight always sits on the row
  // actually rendered at the top of today — `hide done` retiring the first
  // task promotes the next one rather than leaving the colour on a hidden row.
  const firstTodayId = useMemo(
    () => firstTaskIdOn(visibleTasks, todayIso()),
    [visibleTasks]
  )

  // A drag only rearranges rows the user can see, but the endpoint renumbers a
  // whole day, so the hidden ones are dealt back into the slots they held
  // before the list is sent. Applied optimistically first: the rows have
  // already animated into place and snapping back would read as a failure.
  const reorderDay = async (dayIso, visibleOrder) => {
    const dayIds = tasksOn(tasks, dayIso).map((t) => t.id)
    const ids = applyVisibleOrder(
      dayIds,
      tasksOn(visibleTasks, dayIso).map((t) => t.id),
      visibleOrder
    )
    const pos = new Map(ids.map((id, i) => [id, i]))
    setTasks((ts) => ts.map((t) => (pos.has(t.id) ? { ...t, position: pos.get(t.id) } : t)))
    try {
      const day = await api.reorderTasks(dayIso, ids)
      const fresh = new Map(day.map((t) => [t.id, t]))
      setTasks((ts) => ts.map((t) => fresh.get(t.id) ?? t))
    } catch (e) {
      alert(`Reordering failed: ${e.message}`)
      syncAll()
    }
  }

  const toggleHideDone = async () => {
    const next = hideDone ? '0' : '1'
    setSettings((s) => ({ ...s, hide_completed: next }))
    try { await api.setSetting('hide_completed', next) }
    catch (e) { alert(`Saving failed: ${e.message}`); syncAll() }
  }

  // Keep the iOS status bar (and Android task switcher) in step with the
  // user's chosen background, which the static manifest can't know about.
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  }, [bg])

  return (
    <div className="app" style={{ background: bg }}>
      <header className="topbar">
        {/* Grouped so .topbar keeps three flex children and the month nav
            stays centred. */}
        <div className="topbar-left">
          <button
            className={`sync-btn ${online ? '' : 'offline'}`}
            onClick={syncAll}
            disabled={!online}
            title={online ? 'Sync now' : 'Offline'}
          >
            {syncing ? '…' : '⟳'} <span className="label">Sync</span>
          </button>
          <button
            className={`hide-done-btn ${hideDone ? 'on' : ''}`}
            onClick={toggleHideDone}
            aria-pressed={hideDone}
            title={hideDone ? 'Showing only unfinished tasks' : 'Hide completed tasks'}
          >
            {hideDone ? '☑' : '☐'} <span className="label">Hide done</span>
          </button>
        </div>
        <div className="month-nav">
          <span className="month-title">{MONTH_NAMES[month]} {year}</span>
          <button onClick={() => shiftMonth(-1)}>‹</button>
          <button onClick={goToday}>Today</button>
          <button onClick={() => shiftMonth(1)}>›</button>
        </div>
        <SettingsMenu
          categories={categories}
          dailyTasks={dailyTasks}
          settings={settings}
          streak={streak}
          onChanged={syncAll}
        />
      </header>

      {/* Uncapped: DailyBar filters to the selected weekday, then takes 5. */}
      <DailyBar
        dailyTasks={dailyTasks}
        completions={completions}
        selectedDay={selectedDay}
        onToggle={toggleDaily}
      />

      <Calendar
        weeks={weeks}
        month={month}
        tasks={visibleTasks}
        categories={categories}
        dailyTasks={dailyTasks}
        completions={completions}
        selectedDay={selectedDay}
        firstTodayId={firstTodayId}
        onSelectDay={setSelectedDay}
        onToggleTask={toggleTaskDone}
        onNewTask={(date) => setModal({ mode: 'new', date })}
        onEditTask={(task) => setModal({ mode: 'edit', task })}
        onReorder={reorderDay}
        onDragActive={setDragging}
      />

      <DayTaskList
        selectedDay={selectedDay}
        tasks={visibleTasks}
        hideDone={hideDone}
        categories={categories}
        firstTodayId={firstTodayId}
        onToggleTask={toggleTaskDone}
        onEditTask={(task) => setModal({ mode: 'edit', task })}
        onNewTask={(date) => setModal({ mode: 'new', date })}
        onReorder={reorderDay}
        onDragActive={setDragging}
      />

      {modal && (
        <TaskModal
          modal={modal}
          categories={categories}
          onSave={saveTask}
          onLive={liveUpdateTask}
          onDelete={removeTask}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
