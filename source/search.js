import {
  $getRoot, $isTextNode, $isLineBreakNode, $isDecoratorNode, $isElementNode, $getNodeByKey,
  $createRangeSelection, $setSelection,
} from 'lexical'
import { $findMatchingParent } from '@lexical/utils'
import { $isCollapsibleContainerNode } from './nodes.js'
import { normalizeState } from './normalize.js'

/*
 * Search works on "runs": the text of one block (paragraph, heading, list item, table cell line...)
 * with the text pieces it's made of. A match never spans two blocks or a line break.
 */

export function buildRegex(query, { caseSensitive, wholeWord }) {
  if (!query) return null
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const flags = caseSensitive ? 'gu' : 'giu'
  if (!wholeWord) return new RegExp(escaped, flags)
  try {
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, flags)
  } catch (e) {
    return new RegExp(`\\b${escaped}\\b`, caseSensitive ? 'g' : 'gi')
  }
}

function newRun() { return { text: '', pieces: [] } }

/* Runs from the live editor (must be called inside read/update). */
export function $liveRuns() {
  const runs = []
  const visitBlock = (el) => {
    let run = newRun()
    const flush = () => { if (run.pieces.length) runs.push(run); run = newRun() }
    const visit = (n) => {
      if ($isTextNode(n)) {
        const text = n.getTextContent()
        run.pieces.push({ key: n.getKey(), start: run.text.length, length: text.length })
        run.text += text
      } else if ($isLineBreakNode(n) || ($isDecoratorNode(n) && n.isInline())) {
        run.text += '\n'
      } else if ($isElementNode(n) && n.isInline()) {
        n.getChildren().forEach(visit)
      } else if ($isElementNode(n)) {
        flush()
        visitBlock(n)
      } else {
        flush()
      }
    }
    el.getChildren().forEach(visit)
    flush()
  }
  visitBlock($getRoot())
  return runs
}

/* Runs from a saved tab (JSON), used to count matches in tabs that aren't open. */
const JSON_TEXT = new Set(['text', 'code-highlight', 'tab'])
const JSON_INLINE = new Set(['link', 'autolink'])
function jsonRuns(state) {
  const runs = []
  const visitBlock = (el) => {
    let run = newRun()
    const flush = () => { if (run.pieces.length) runs.push(run); run = newRun() }
    const visit = (n) => {
      if (!n || typeof n !== 'object') return
      if (JSON_TEXT.has(n.type) && typeof n.text === 'string') {
        run.pieces.push({ start: run.text.length, length: n.text.length })
        run.text += n.text
      } else if (n.type === 'linebreak' || n.type === 'unencrypted-image') {
        run.text += '\n'
      } else if (JSON_INLINE.has(n.type)) {
        (n.children || []).forEach(visit)
      } else if (Array.isArray(n.children)) {
        flush()
        visitBlock(n)
      } else {
        flush()
      }
    }
    ;(el.children || []).forEach(visit)
    flush()
  }
  if (state && state.root) visitBlock(state.root)
  return runs
}

export function matchRuns(runs, re) {
  const matches = []
  runs.forEach((run, runIndex) => {
    re.lastIndex = 0
    let m
    while ((m = re.exec(run.text))) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      const s = m.index
      const e = s + m[0].length
      const pieces = []
      for (const p of run.pieces) {
        const ps = p.start
        const pe = p.start + p.length
        if (pe <= s || ps >= e) continue
        pieces.push({ key: p.key, from: Math.max(s, ps) - ps, to: Math.min(e, pe) - ps })
      }
      if (pieces.length) matches.push({ runIndex, start: s, end: e, pieces })
    }
  })
  return matches
}

function $replaceMatch(match, text) {
  for (let i = match.pieces.length - 1; i >= 0; i--) {
    const p = match.pieces[i]
    const node = $getNodeByKey(p.key)
    if (!$isTextNode(node) || node.getType() === 'tab') continue
    node.spliceText(p.from, p.to - p.from, i === 0 ? text : '', false)
  }
}

function firstTextNode(el) {
  if (!el) return null
  if (el.nodeType === 3) return el
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  return walker.nextNode()
}

export function createSearch(ctx) {
  const { editor, getDoc, selectTab, renderTabs, isLocked, ensureStates, scrollContainer } = ctx
  const bar = document.querySelector('#searchbar')
  const find = bar.querySelector('#find')
  const replaceInput = bar.querySelector('#replace')
  const status = bar.querySelector('#search-status')
  const btn = (name) => bar.querySelector(`[data-search="${name}"]`)
  const supportsHighlights = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined'

  const state = {
    open: false,
    caseSensitive: false,
    wholeWord: false,
    counts: {},
    live: [],
    order: [], // [{ tabId, local }]
    index: -1,
  }
  let timer = null

  const query = () => find.value
  const regex = () => buildRegex(query(), state)
  const activeId = () => getDoc() && getDoc().activeId

  function countFor(tabId) { return state.open && query() ? state.counts[tabId] || 0 : 0 }

  function recompute(keepPosition = null) {
    const doc = getDoc()
    const re = regex()
    state.counts = {}
    state.live = []
    state.order = []
    if (!doc || !re) {
      state.index = -1
      paint()
      renderTabs()
      return
    }
    ensureStates()
    for (const tab of doc.tabs) {
      if (tab.id === doc.activeId) {
        state.live = editor.getEditorState().read(() => matchRuns($liveRuns(), re))
        state.counts[tab.id] = state.live.length
        state.live.forEach((_, local) => state.order.push({ tabId: tab.id, local }))
      } else {
        let saved = tab.state
        try { saved = normalizeState(tab.state) } catch (e) { /* count what's there */ }
        const n = matchRuns(jsonRuns(saved), re).length
        state.counts[tab.id] = n
        for (let local = 0; local < n; local++) state.order.push({ tabId: tab.id, local })
      }
    }
    // Choose which match is current
    if (!state.order.length) state.index = -1
    else if (keepPosition) {
      const i = state.order.findIndex((o) => {
        if (o.tabId !== doc.activeId) return false
        const m = state.live[o.local]
        return m.runIndex > keepPosition.runIndex || (m.runIndex === keepPosition.runIndex && m.start >= keepPosition.start)
      })
      state.index = i >= 0 ? i : Math.min(state.index, state.order.length - 1)
    } else if (state.index < 0 || state.index >= state.order.length || state.order[state.index].tabId !== doc.activeId) {
      // Prefer the first match in the tab you're looking at
      const here = state.order.findIndex((o) => o.tabId === doc.activeId)
      state.index = here >= 0 ? here : 0
    }
    paint()
    renderTabs()
  }

  /* Edits made from the search bar shouldn't pull the cursor (and the keyboard) into the page. */
  function quietUpdate(fn) {
    const focused = document.activeElement
    editor.update(fn, { discrete: true, tag: 'skip-dom-selection' })
    if (focused && bar.contains(focused) && document.activeElement !== focused) focused.focus()
  }

  function currentLive() {
    const o = state.order[state.index]
    if (!o || o.tabId !== activeId()) return null
    return state.live[o.local] || null
  }

  function rangeFor(match) {
    const first = match.pieces[0]
    const last = match.pieces[match.pieces.length - 1]
    const a = firstTextNode(editor.getElementByKey(first.key))
    const b = firstTextNode(editor.getElementByKey(last.key))
    if (!a || !b) return null
    try {
      const r = document.createRange()
      r.setStart(a, Math.min(first.from, a.length))
      r.setEnd(b, Math.min(last.to, b.length))
      return r
    } catch (e) { return null }
  }

  function paint() {
    const total = state.order.length
    const hasQuery = !!query()
    const cur = state.order[state.index]
    const elsewhere = cur && cur.tabId !== activeId() ? getDoc().tabs.find((t) => t.id === cur.tabId) : null
    status.textContent = !hasQuery ? '' : !total ? 'No results'
      : elsewhere ? `${state.index + 1} of ${total} · in ${elsewhere.title}` : `${state.index + 1} of ${total}`
    bar.classList.toggle('no-results', hasQuery && !total)
    btn('prev').disabled = btn('next').disabled = total === 0
    const live = currentLive()
    const locked = isLocked()
    const hereCount = state.live.length
    btn('replace').disabled = locked || !live
    btn('replace-all').disabled = locked || hereCount === 0
    btn('replace').title = live || !total ? 'Replace this match' : 'The current match is in another tab. Replace only works in the tab you are viewing.'
    btn('replace-all').textContent = hereCount ? `Replace all in tab (${hereCount})` : 'Replace all in tab'
    if (!supportsHighlights) return
    const all = []
    let active = null
    state.live.forEach((m) => {
      const r = rangeFor(m)
      if (!r) return
      if (m === live) active = r
      else all.push(r)
    })
    CSS.highlights.set('tn-search', new Highlight(...all))
    if (active) CSS.highlights.set('tn-search-active', new Highlight(active))
    else CSS.highlights.delete('tn-search-active')
  }

  function clearHighlights() {
    if (!supportsHighlights) return
    CSS.highlights.delete('tn-search')
    CSS.highlights.delete('tn-search-active')
  }

  function reveal(match) {
    // Open any collapsed sections the match is inside
    const needsOpen = editor.getEditorState().read(() => {
      const node = $getNodeByKey(match.pieces[0].key)
      let c = node && $findMatchingParent(node, $isCollapsibleContainerNode)
      while (c) {
        if (!c.getOpen()) return true
        c = $findMatchingParent(c.getParent(), $isCollapsibleContainerNode)
      }
      return false
    })
    if (needsOpen) {
      quietUpdate(() => {
        const node = $getNodeByKey(match.pieces[0].key)
        let c = node && $findMatchingParent(node, $isCollapsibleContainerNode)
        while (c) {
          if (!c.getOpen()) c.setOpen(true)
          c = $findMatchingParent(c.getParent(), $isCollapsibleContainerNode)
        }
      })
      paint()
    }
    const r = rangeFor(match)
    if (!r) return
    const rect = r.getBoundingClientRect()
    const box = scrollContainer.getBoundingClientRect()
    if (rect.top < box.top + 40 || rect.bottom > box.bottom - 20) {
      scrollContainer.scrollTop += rect.top - box.top - box.height / 3
    }
  }

  function go(delta) {
    const total = state.order.length
    if (!total) return
    state.index = (state.index + delta + total) % total
    const o = state.order[state.index]
    if (o.tabId !== activeId()) {
      const wanted = state.index
      selectTab(o.tabId) // loads the tab; onTabLoaded() recomputes
      state.index = wanted
      recompute()
      state.index = wanted
      paint()
    } else {
      paint()
    }
    const m = currentLive()
    if (m) reveal(m)
  }

  function replaceOne() {
    const m = currentLive()
    if (!m || isLocked()) return
    const text = replaceInput.value
    const keep = { runIndex: m.runIndex, start: m.start + text.length }
    quietUpdate(() => $replaceMatch(m, text))
    recompute(keep)
    const next = currentLive()
    if (next) reveal(next)
  }

  function replaceAll() {
    const re = regex()
    if (!re || isLocked()) return
    const text = replaceInput.value
    quietUpdate(() => {
      const matches = matchRuns($liveRuns(), re)
      for (let i = matches.length - 1; i >= 0; i--) $replaceMatch(matches[i], text)
    })
    recompute()
  }

  function open() {
    const selected = window.getSelection ? String(window.getSelection()) : ''
    const wasOpen = state.open
    state.open = true
    bar.hidden = false
    bar.classList.toggle('locked', isLocked())
    if (selected && selected.length < 80 && !selected.includes('\n')) find.value = selected
    find.focus()
    find.select()
    if (!wasOpen || selected) recompute()
  }

  function close(focusEditor = true) {
    if (!state.open) return
    const m = currentLive()
    state.open = false
    bar.hidden = true
    clearHighlights()
    renderTabs()
    if (focusEditor) {
      if (m) {
        editor.update(() => {
          const first = m.pieces[0]
          const last = m.pieces[m.pieces.length - 1]
          const sel = $createRangeSelection()
          sel.anchor.set(first.key, first.from, 'text')
          sel.focus.set(last.key, last.to, 'text')
          $setSelection(sel)
        })
      }
      editor.focus()
    }
  }

  find.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => { state.index = -1; recompute() }, 120)
  })
  find.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); if (state.index === -1) recompute(); go(e.shiftKey ? -1 : 1) }
    if (e.key === 'Escape') { e.preventDefault(); close() }
  })
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne() }
    if (e.key === 'Escape') { e.preventDefault(); close() }
  })
  bar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault() })
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    const act = b.dataset.search
    if (act === 'next') go(1)
    if (act === 'prev') go(-1)
    if (act === 'replace') replaceOne()
    if (act === 'replace-all') replaceAll()
    if (act === 'close') close()
    if (act === 'case' || act === 'word') {
      const key = act === 'case' ? 'caseSensitive' : 'wholeWord'
      state[key] = !state[key]
      b.setAttribute('aria-pressed', String(state[key]))
      state.index = -1
      recompute()
    }
  })

  return {
    open,
    close,
    countFor,
    isOpen: () => state.open,
    onEditorUpdate() {
      if (!state.open || !query()) return
      clearTimeout(timer)
      timer = setTimeout(() => recompute(), 150)
    },
    onTabLoaded() {
      if (state.open) {
        bar.classList.toggle('locked', isLocked())
        recompute()
      }
    },
  }
}
