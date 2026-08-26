import React from 'react'

// The colour control both apps already use: a native <input type="color">
// made invisible and stretched over a painted swatch. Native because it is the
// only picker that opens the system colour UI — on iPadOS that means the same
// wheel/sliders sheet the rest of the OS uses, which no custom picker can
// match for a pencil you are choosing mid-sentence.
//
// Shared by the section rail and the pencil settings so the two stay identical.
export default function ColorSwatch({ value, onChange, className = '', title, size }) {
  const style = { background: value }
  if (size) { style.width = size; style.height = size }
  return (
    <label className={`swatch ${className}`} style={style} title={title}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={title || 'colour'}
      />
    </label>
  )
}
