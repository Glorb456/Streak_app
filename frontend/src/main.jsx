import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { ensureBestOrigin } from './failover.js'
import './styles.css'

// Shell cache only (see public/sw.js): keeps the PWA able to open when its
// own origin is down, so the failover chain below has somewhere to run.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}

// If a better node in the failover chain is alive — or this one is dead —
// redirect. Renders immediately regardless; a redirect, if any, follows.
ensureBestOrigin()

createRoot(document.getElementById('root')).render(<App />)
