import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { reloadFromServer } from '../shellcache.js'
import { ago, connState, entryAsset, shortHost, STATES } from '../syncstate.js'

// Stamped in at build time by vite.config.js; 'dev' under the dev server.
const BUILD = typeof __BUILD_ID__ === 'undefined' ? 'dev' : __BUILD_ID__

// The bundle this tab is actually running — an old one here, next to a newer
// one on the server, is what a stale browser cache looks like.
const runningAsset = () => {
  try { return new URL(import.meta.url).pathname } catch { return null }
}

// Sync button plus a caret that opens the status panel. The button still
// syncs on click; the panel is where "why is this not updating?" is answered:
// connection state, when data last landed, which build is running, and the
// peer-sync picture on a multi-node install.
export default function SyncMenu({
  online, syncing, lastSyncAt, syncError, fromCache, syncInfo, conflicts,
  onSyncNow, onOpenConflicts,
}) {
  const [open, setOpen] = useState(false)
  const [, setTick] = useState(0)
  const [newBuild, setNewBuild] = useState(null)
  const ref = useRef(null)

  const state = connState({ online, fromCache, lastSyncAt, error: syncError })
  const { tone, title, detail } = STATES[state]

  useEffect(() => {
    // 'click', like the settings menu: mousedown would close the panel
    // before the button under the pointer ever fires.
    const close = (e) => {
      if (!e.target.isConnected) return
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  // "12s ago" has to keep counting while the panel sits open.
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [open])

  // Ask the server which bundle it serves now. Cheap, and only while the
  // panel is open. no-store so an HTTP cache can't answer for the server.
  useEffect(() => {
    if (!open || !online) return
    let dead = false
    fetch('/', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => {
        if (dead || !html) return
        const served = entryAsset(html)
        const running = runningAsset()
        setNewBuild(served && running && served !== running ? served : null)
      })
      .catch(() => { /* the panel already says the server is unreachable */ })
    return () => { dead = true }
  }, [open, online])

  const peerSync = () => {
    onSyncNow()
    // Nudges the backend's own pull/push loop; only means anything on a node
    // with a sync role, and never blocks the local refresh above.
    if (syncInfo?.role) api.syncNow().catch(() => {})
  }

  return (
    <div className="sync-group" ref={ref}>
      <button
        className={`sync-btn tone-${tone}`}
        onClick={onSyncNow}
        disabled={!online}
        title={online ? 'Sync now' : 'Offline'}
      >
        {syncing ? '…' : '⟳'} <span className="label">Sync</span>
      </button>
      <button
        className={`sync-caret tone-${tone} ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Sync status"
        title="Sync status"
      >
        ▾
      </button>

      {open && (
        <div className="dropdown sync-panel">
          <div className="sync-head">
            <span className={`sync-dot tone-${tone}`} />
            <div>
              <div className="sync-title">{syncing && state === 'ok' ? 'Syncing…' : title}</div>
              <div className="sync-detail">{detail}</div>
            </div>
          </div>

          <div className="sync-rows">
            <div className="sync-row"><span>Last update</span><b>{ago(lastSyncAt)}</b></div>
            <div className="sync-row"><span>This page came from</span><b>{fromCache ? 'browser cache' : 'the server'}</b></div>
            <div className="sync-row"><span>Auto-refresh</span><b>{online ? 'every 5s' : 'paused'}</b></div>
            {syncError && <div className="sync-row bad"><span>Last error</span><b>{syncError}</b></div>}
          </div>

          <div className="sync-rows">
            {syncInfo?.role ? (
              <>
                <div className="sync-row"><span>This node</span><b>{syncInfo.role}</b></div>
                {syncInfo.upstream && (
                  <>
                    <div className="sync-row"><span>Upstream</span><b>{shortHost(syncInfo.upstream)}</b></div>
                    <div className={`sync-row ${syncInfo.upstream_reachable === false ? 'bad' : ''}`}>
                      <span>Upstream state</span>
                      <b>
                        {syncInfo.upstream_reachable === false
                          ? 'unreachable'
                          : syncInfo.upstream_reachable
                            ? 'reachable'
                            : 'not probed yet'}
                      </b>
                    </div>
                  </>
                )}
                <div className="sync-row">
                  <span>Last peer sync</span>
                  <b>{ago(Date.parse(syncInfo.last_ok))}</b>
                </div>
                {syncInfo.last_error && (
                  <div className="sync-row bad"><span>Peer error</span><b>{syncInfo.last_error}</b></div>
                )}
              </>
            ) : (
              <div className="sync-note">Single node — peer sync is off.</div>
            )}
            {conflicts > 0 && (
              <button className="sync-conflicts" onClick={() => { setOpen(false); onOpenConflicts() }}>
                ⚠ {conflicts} conflict{conflicts === 1 ? '' : 's'} to review
              </button>
            )}
          </div>

          {newBuild && (
            <button className="sync-update" onClick={reloadFromServer} title={newBuild}>
              The server has a newer build than this tab — reload
            </button>
          )}

          <div className="sync-foot">
            <span className="sync-build">Build {BUILD}</span>
            <button className="sync-now" onClick={peerSync} disabled={!online}>Sync now</button>
          </div>
        </div>
      )}
    </div>
  )
}
