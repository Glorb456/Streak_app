/** Which section and page the notebook should be looking at.
 *
 *  Run on every tree change, so it doubles as the repair after a delete or a
 *  rename: callers move the selection freely and this puts it back on
 *  something that still exists, rather than each handler working out what
 *  should be selected next.
 *
 *  The app-owned Sticky Notes section is never the default. It holds the
 *  task app's Quick notes, and opening the notebook onto that scratch pad is
 *  not where anyone means to start writing — it is picked only when it is
 *  the whole notebook. Matching is on the server's `sticky` flag rather than
 *  on the section's name, so the two frontends agree about which section it
 *  is without either of them hard-coding the string. */
export function pickSelection(sections, sectionId, pageId) {
  if (!sections?.length) return { sectionId: null, pageId: null }
  const fallback = sections.find((s) => !s.sticky) || sections[0]
  const section = sections.find((s) => s.id === sectionId) || fallback
  const pages = section.pages || []
  return {
    sectionId: section.id,
    pageId: pages.some((p) => p.id === pageId) ? pageId : (pages[0]?.id ?? null),
  }
}
