import {
  $getRoot, $getSelection, $setSelection, $isRangeSelection, $isNodeSelection, $createNodeSelection, $getNodeByKey,
  $getNearestNodeFromDOMNode, $createParagraphNode, $isElementNode, $isRootOrShadowRoot,
  PASTE_COMMAND, DROP_COMMAND, KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND, KEY_ENTER_COMMAND,
  SELECTION_CHANGE_COMMAND, COMMAND_PRIORITY_HIGH, COMMAND_PRIORITY_LOW,
} from 'lexical'
import { mergeRegister, $insertNodeToNearestRoot } from '@lexical/utils'
import { $createInlineFileNode, $isInlineFileNode, $isImageNode, $isSuperFileNode } from './nodes.js'

const MAX_EDGE = 1600            // longest side kept, in pixels
const WARN_IMAGE_BYTES = 1_000_000
const MAX_IMAGE_BYTES = 3_000_000
const WARN_NOTE_BYTES = 5_000_000

const isResizable = (n) => $isInlineFileNode(n) || $isImageNode(n)
const isMedia = (n) => isResizable(n) || $isSuperFileNode(n)

const kb = (bytes) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`)

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch (e) { /* fall back below */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/* Shrink and re-encode an image, keeping whichever version is smallest. */
export async function prepareImage(file) {
  const type = file.type || ''
  if (!type.startsWith('image/')) throw new Error('That file isn\'t an image.')
  if (type === 'image/gif' || type === 'image/svg+xml') {
    // Keep animations and vector images as they are
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`This image is ${kb(file.size)}, which is too large to embed in a note.`)
    return { blob: file, mimeType: type, width: null }
  }
  const source = await loadImage(file)
  const w0 = source.width || source.naturalWidth
  const h0 = source.height || source.naturalHeight
  const scale = Math.min(1, MAX_EDGE / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(source, 0, 0, w, h)
  if (source.close) source.close()

  const candidates = []
  if (scale === 1 && ['image/png', 'image/jpeg', 'image/webp'].includes(type)) candidates.push(file)
  const webp = await canvasToBlob(canvas, 'image/webp', 0.9)
  if (webp && webp.type === 'image/webp') candidates.push(webp)
  if (type === 'image/png') {
    const png = await canvasToBlob(canvas, 'image/png')
    if (png) candidates.push(png)
  } else {
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.85)
    if (jpeg) candidates.push(jpeg)
  }
  let best = candidates.filter(Boolean).sort((a, b) => a.size - b.size)[0]
  if (!best) throw new Error('This image couldn\'t be read.')
  // Still too big (usually a detailed photo): lower the quality, then the size, until it fits
  const lossy = webp && webp.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
  for (const [edge, quality] of [[MAX_EDGE, 0.75], [MAX_EDGE, 0.6], [1200, 0.6], [900, 0.55]]) {
    if (best.size <= WARN_IMAGE_BYTES) break
    let c = canvas
    if (edge < Math.max(w, h)) {
      const k = edge / Math.max(w, h)
      c = document.createElement('canvas')
      c.width = Math.round(w * k)
      c.height = Math.round(h * k)
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height)
    }
    const smaller = await canvasToBlob(c, lossy, quality)
    if (smaller && smaller.size < best.size) best = smaller
  }
  if (best.size > MAX_IMAGE_BYTES) throw new Error(`Even after shrinking, this image is ${kb(best.size)}, which is too large to embed in a note.`)
  // Show screenshots at the size they appeared on screen (high-resolution screens use 2-3 pixels per point)
  const displayWidth = w0 / (window.devicePixelRatio || 1)
  return { blob: best, mimeType: best.type || type, displayWidth }
}

export function createImages(ctx) {
  const { editor, page, wrap, isLocked, toast, noteSize, topBlockAt } = ctx
  const tools = document.querySelector('#image-tools')
  const picker = document.querySelector('#image-picker')
  let selectedKey = null
  let selectedEl = null

  /* ---------- inserting ---------- */

  function lineWidth() {
    const style = getComputedStyle(page)
    return page.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  }

  async function insertFiles(files, afterKey = null) {
    if (isLocked()) return
    const images = [...files].filter((f) => (f.type || '').startsWith('image/'))
    if (!images.length) return
    let added = 0
    let anchor = afterKey
    for (const file of images) {
      let prepared
      try {
        prepared = await prepareImage(file)
      } catch (error) {
        toast(error.message || 'This image couldn\'t be added.', 'error')
        continue
      }
      const src = await readAsDataURL(prepared.blob)
      const available = lineWidth()
      const width = prepared.displayWidth && available > 0 && prepared.displayWidth < available
        ? Math.round((prepared.displayWidth / available) * 100) : null
      const name = file.name && file.name !== 'image.png' ? file.name : undefined
      editor.update(() => {
        const node = $createInlineFileNode(src, prepared.mimeType, name, 'left', width)
        const after = anchor && $getNodeByKey(anchor)
        if (after) {
          after.insertAfter(node)
        } else {
          const sel = $getSelection()
          if (!$isRangeSelection(sel) && !$isNodeSelection(sel)) $getRoot().selectEnd()
          $insertNodeToNearestRoot(node)
        }
        if (!node.getNextSibling()) node.insertAfter($createParagraphNode())
        anchor = node.getKey()
        const next = node.getNextSibling()
        if (next && $isElementNode(next)) next.selectStart()
      })
      added++
      if (prepared.blob.size > WARN_IMAGE_BYTES) toast(`Added a large image (${kb(prepared.blob.size)}). The note will save more slowly.`, 'warn')
    }
    if (added) {
      editor.focus()
      setTimeout(() => {
        const size = noteSize()
        if (size > WARN_NOTE_BYTES) toast(`This note is now about ${kb(size)}. Very large notes sync slowly; consider moving some images to another note.`, 'warn')
      }, 300)
    }
  }

  function chooseFromDevice() {
    if (isLocked()) return
    picker.value = ''
    picker.click()
  }
  picker.addEventListener('change', () => {
    if (picker.files && picker.files.length) insertFiles(picker.files)
  })

  /* ---------- selecting, aligning, resizing ---------- */

  function selectImage(key) {
    editor.update(() => {
      const ns = $createNodeSelection()
      ns.add(key)
      $setSelection(ns)
    })
  }

  function $selectedMedia() {
    const sel = $getSelection()
    if (!$isNodeSelection(sel)) return null
    const nodes = sel.getNodes()
    return nodes.length === 1 && isMedia(nodes[0]) ? nodes[0] : null
  }

  function refresh() {
    const info = editor.read(() => {
      const node = $selectedMedia()
      if (!node) return null
      let align = ''
      if ($isInlineFileNode(node)) align = node.getFormat()
      else if ($isImageNode(node)) {
        const parent = node.getParent()
        align = parent && $isElementNode(parent) ? parent.getFormatType() : ''
      }
      return {
        key: node.getKey(),
        resizable: isResizable(node),
        width: isResizable(node) ? node.getWidth() : null,
        align: align || 'left',
      }
    })
    if (selectedEl) selectedEl.classList.remove('selected')
    selectedEl = null
    selectedKey = info ? info.key : null
    if (!info || isLocked()) {
      tools.hidden = true
      return
    }
    const host = editor.getElementByKey(info.key)
    selectedEl = host && (host.querySelector('.iv') || host.querySelector('.snfile-card'))
    if (selectedEl) selectedEl.classList.add('selected')
    tools.querySelectorAll('[data-img-size], [data-img-align]').forEach((b) => { b.hidden = !info.resizable })
    tools.querySelectorAll('[data-img-align]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.imgAlign === info.align)))
    tools.querySelectorAll('[data-img-size]').forEach((b) => {
      const v = b.dataset.imgSize === 'auto' ? null : Number(b.dataset.imgSize)
      b.setAttribute('aria-pressed', String(v === info.width))
    })
    position()
  }

  function position() {
    if (!selectedEl) return
    tools.hidden = false
    const r = selectedEl.getBoundingClientRect()
    const box = wrap.getBoundingClientRect()
    const top = r.top - box.top + wrap.scrollTop - tools.offsetHeight - 6
    const left = Math.min(Math.max(r.left - box.left, 4), box.width - tools.offsetWidth - 8)
    tools.style.top = `${Math.max(wrap.scrollTop + 4, top)}px`
    tools.style.left = `${left}px`
  }

  function setWidth(key, width) {
    editor.update(() => {
      const node = $getNodeByKey(key)
      if (node && isResizable(node)) node.setWidth(width)
    })
  }

  function setAlign(key, align) {
    editor.update(() => {
      const node = $getNodeByKey(key)
      if ($isInlineFileNode(node)) node.setFormat(align)
      else if ($isImageNode(node)) {
        const parent = node.getParent()
        if (parent && $isElementNode(parent) && !$isRootOrShadowRoot(parent)) parent.setFormat(align)
      }
    })
  }

  function removeSelected() {
    if (!selectedKey) return
    const key = selectedKey
    editor.update(() => {
      const node = $getNodeByKey(key)
      if (!node) return
      const next = node.getNextSibling() || node.getPreviousSibling()
      node.remove()
      if (next && $isElementNode(next)) next.selectStart()
    })
    editor.focus()
  }

  tools.addEventListener('mousedown', (e) => e.preventDefault())
  tools.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b || !selectedKey) return
    if (b.dataset.imgAlign) setAlign(selectedKey, b.dataset.imgAlign)
    if (b.dataset.imgSize) setWidth(selectedKey, b.dataset.imgSize === 'auto' ? null : Number(b.dataset.imgSize))
    if (b.dataset.imgAct === 'delete') removeSelected()
  })

  // Click an image to select it (mousedown, so the browser doesn't move the text cursor first)
  page.addEventListener('mousedown', (e) => {
    const view = e.target.closest && (e.target.closest('.iv') || e.target.closest('.snfile-card'))
    if (!view || e.target.closest('.iv-resize') || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const key = editor.read(() => {
      const node = $getNearestNodeFromDOMNode(view)
      return node && isMedia(node) ? node.getKey() : null
    })
    if (key) {
      if (document.activeElement !== page) page.focus({ preventScroll: true })
      selectImage(key)
    }
  }, true)
  page.addEventListener('click', (e) => {
    if (e.target.closest && (e.target.closest('.iv') || e.target.closest('.snfile-card'))) e.preventDefault()
  }, true)

  // Drag the corner handle to resize
  page.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest && e.target.closest('.iv-resize')
    if (!grip || isLocked() || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const view = grip.closest('.iv')
    const key = editor.read(() => {
      const node = $getNearestNodeFromDOMNode(view)
      return node && isResizable(node) ? node.getKey() : null
    })
    if (!key) return
    const align = editor.read(() => {
      const n = $getNodeByKey(key)
      if ($isInlineFileNode(n)) return n.getFormat()
      const p = n.getParent()
      return p && $isElementNode(p) ? p.getFormatType() : ''
    })
    const factor = align === 'center' ? 2 : align === 'right' || align === 'end' ? -1 : 1
    const container = (view.parentElement && view.parentElement.closest('.image-block, .p, .h1, .h2, .h3, .td, .th, .li, .quote')) || page
    const style = getComputedStyle(container)
    const full = container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const startX = e.clientX
    const startW = view.getBoundingClientRect().width
    const label = document.createElement('span')
    label.className = 'iv-size'
    view.append(label)
    view.classList.add('resizing', 'sized')
    grip.setPointerCapture(e.pointerId)
    let pct = null
    const move = (ev) => {
      const px = Math.max(40, Math.min(full, startW + (ev.clientX - startX) * factor))
      pct = Math.max(5, Math.min(100, Math.round((px / full) * 100)))
      view.style.width = `${pct}%`
      label.textContent = `${pct}%`
    }
    const up = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', up)
      grip.removeEventListener('pointercancel', up)
      view.classList.remove('resizing')
      label.remove()
      if (pct !== null) setWidth(key, pct)
      selectImage(key)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', up)
    grip.addEventListener('pointercancel', up)
  }, true)

  wrap.addEventListener('scroll', () => { if (selectedEl) position() })
  window.addEventListener('resize', () => { if (selectedEl) position() })

  /* ---------- clipboard, drop, and keys ---------- */

  const imageFiles = (dt) => (dt && dt.files ? [...dt.files].filter((f) => (f.type || '').startsWith('image/')) : [])

  mergeRegister(
    editor.registerCommand(PASTE_COMMAND, (event) => {
      const dt = event && event.clipboardData
      const files = imageFiles(dt)
      if (!files.length) return false
      // Pasted text that just comes with a picture (like copying from a web page) stays as text
      const text = dt.getData('text/plain')
      if (text && text.trim()) return false
      event.preventDefault()
      insertFiles(files)
      return true
    }, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(DROP_COMMAND, (event) => {
      const files = imageFiles(event.dataTransfer)
      if (!files.length) return false
      event.preventDefault()
      const block = topBlockAt(event.clientY)
      insertFiles(files, block ? block.key : null)
      return true
    }, COMMAND_PRIORITY_HIGH),
    editor.registerCommand(KEY_BACKSPACE_COMMAND, (event) => {
      const has = editor.read(() => !!$selectedMedia())
      if (!has) return false
      event.preventDefault()
      removeSelected()
      return true
    }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(KEY_DELETE_COMMAND, (event) => {
      const has = editor.read(() => !!$selectedMedia())
      if (!has) return false
      event.preventDefault()
      removeSelected()
      return true
    }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      const key = editor.read(() => { const n = $selectedMedia(); return n ? n.getKey() : null })
      if (!key) return false
      if (event) event.preventDefault()
      editor.update(() => {
        const node = $getNodeByKey(key)
        const target = $isImageNode(node) ? node.getParent() : node
        const p = $createParagraphNode()
        target.insertAfter(p)
        p.selectStart()
      })
      return true
    }, COMMAND_PRIORITY_LOW),
    editor.registerCommand(SELECTION_CHANGE_COMMAND, () => { refresh(); return false }, COMMAND_PRIORITY_LOW),
    editor.registerUpdateListener(() => refresh()),
  )

  // Let image files be dropped onto the page
  wrap.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault()
  })

  return { insertFiles, chooseFromDevice, refresh }
}
