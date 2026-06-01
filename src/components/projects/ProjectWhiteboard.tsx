'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Move, Pen, Type, ImageIcon, Square, Circle, Eraser,
  ZoomIn, ZoomOut, Maximize2, Trash2, X, Save, Download,
} from 'lucide-react'
import { sb } from '@/lib/supabase'
import { toast } from '@/lib/toast'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tool = 'pan' | 'draw' | 'text' | 'image' | 'rect' | 'circle' | 'eraser'

type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'white'

const NOTE_COLORS: Record<NoteColor, { bg: string; border: string }> = {
  yellow: { bg: '#fef9c3', border: '#fde047' },
  blue:   { bg: '#dbeafe', border: '#93c5fd' },
  green:  { bg: '#dcfce7', border: '#86efac' },
  pink:   { bg: '#fce7f3', border: '#f9a8d4' },
  white:  { bg: '#ffffff', border: '#e2e2e0' },
}

interface WbNote {
  id: string
  type: 'note'
  x: number
  y: number
  w: number
  h: number
  text: string
  color: NoteColor
}

interface WbImage {
  id: string
  type: 'image'
  x: number
  y: number
  w: number
  h: number
  src: string   // URL or base64
}

interface WbShape {
  id: string
  type: 'rect' | 'circle'
  x: number
  y: number
  w: number
  h: number
  color: string
}

interface WbStroke {
  id: string
  type: 'stroke'
  points: [number, number][]
  color: string
  width: number
}

type WbElement = WbNote | WbImage | WbShape | WbStroke

interface WhiteboardState {
  elements: WbElement[]
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface CtxMenu {
  x: number
  y: number
  elementId: string
  elementType: WbElement['type']
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectCode: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function loadState(code: string): WhiteboardState {
  try {
    const raw = localStorage.getItem(`project_whiteboard_${code}`)
    if (raw) return JSON.parse(raw) as WhiteboardState
  } catch { /* ignore */ }
  return { elements: [] }
}

function saveState(code: string, state: WhiteboardState) {
  try {
    localStorage.setItem(`project_whiteboard_${code}`, JSON.stringify(state))
  } catch { /* ignore */ }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectWhiteboard({ projectCode }: Props) {
  // Canvas state
  const [state, setState] = useState<WhiteboardState>(() => loadState(projectCode))
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<Tool>('pan')
  const [saved, setSaved] = useState(true)
  const [clearConfirm, setClearConfirm] = useState(false)

  // Drawing
  const [drawColor, setDrawColor] = useState('#1a1a1a')
  const [drawWidth, setDrawWidth] = useState(2)
  const [currentStroke, setCurrentStroke] = useState<[number, number][] | null>(null)
  const isDrawing = useRef(false)

  // Eraser
  const [eraserStrokeId, setEraserStrokeId] = useState<string | null>(null)

  // Shape drawing
  const [shapeColor, setShapeColor] = useState('#1a1a1a')
  const shapeStart = useRef<{ cx: number; cy: number } | null>(null)
  const [shapePreview, setShapePreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const isShaping = useRef(false)

  // Panning
  const panStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  const isPanning = useRef(false)

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)

  // Note editing
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)

  // Image upload
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Auto-save: debounced 2s
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function markUnsaved(newState: WhiteboardState) {
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveState(projectCode, newState)
      setSaved(true)
    }, 2000)
  }

  // Periodic save every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      saveState(projectCode, state)
      setSaved(true)
    }, 30000)
    return () => clearInterval(interval)
  }, [projectCode, state])

  // Reload when projectCode changes
  useEffect(() => {
    setState(loadState(projectCode))
    setSaved(true)
    setPanX(0); setPanY(0); setZoom(1)
  }, [projectCode])

  // ── Coordinate helpers ──

  function screenToCanvas(screenX: number, screenY: number): [number, number] {
    const rect = containerRef.current!.getBoundingClientRect()
    return [
      (screenX - rect.left - panX) / zoom,
      (screenY - rect.top - panY) / zoom,
    ]
  }

  // ── Zoom ──

  function zoomIn()    { setZoom(z => Math.min(z * 1.25, 4)) }
  function zoomOut()   { setZoom(z => Math.max(z / 1.25, 0.2)) }
  function zoomReset() { setZoom(1); setPanX(0); setPanY(0) }

  // Scroll-to-zoom
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 1.1 : 0.9
    setZoom(z => Math.min(Math.max(z * delta, 0.2), 4))
  }

  // ── Mouse events ──

  function handleMouseDown(e: React.MouseEvent) {
    if (ctxMenu) { setCtxMenu(null); return }
    const [cx, cy] = screenToCanvas(e.clientX, e.clientY)

    if (tool === 'pan') {
      isPanning.current = true
      panStart.current = { mx: e.clientX, my: e.clientY, px: panX, py: panY }
    }

    if (tool === 'draw') {
      isDrawing.current = true
      setCurrentStroke([[cx, cy]])
    }

    if (tool === 'eraser') {
      // start: nothing, eraser works on hover during drag
    }

    if (tool === 'rect' || tool === 'circle') {
      isShaping.current = true
      shapeStart.current = { cx, cy }
      setShapePreview({ x: cx, y: cy, w: 0, h: 0 })
    }

    if (tool === 'text') {
      addNote(cx, cy)
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const [cx, cy] = screenToCanvas(e.clientX, e.clientY)

    if (tool === 'pan' && isPanning.current && panStart.current) {
      const dx = e.clientX - panStart.current.mx
      const dy = e.clientY - panStart.current.my
      setPanX(panStart.current.px + dx)
      setPanY(panStart.current.py + dy)
    }

    if (tool === 'draw' && isDrawing.current) {
      setCurrentStroke(prev => prev ? [...prev, [cx, cy]] : [[cx, cy]])
    }

    if (tool === 'eraser' && e.buttons === 1) {
      // Find stroke under cursor
      const hit = state.elements.findLast(el => {
        if (el.type !== 'stroke') return false
        return (el as WbStroke).points.some(([px, py]) => Math.hypot(px - cx, py - cy) < 12 / zoom)
      })
      if (hit) {
        const next = { elements: state.elements.filter(el => el.id !== hit.id) }
        setState(next)
        markUnsaved(next)
      }
    }

    if ((tool === 'rect' || tool === 'circle') && isShaping.current && shapeStart.current) {
      const { cx: sx, cy: sy } = shapeStart.current
      setShapePreview({
        x: Math.min(sx, cx), y: Math.min(sy, cy),
        w: Math.abs(cx - sx), h: Math.abs(cy - sy),
      })
    }
  }

  function handleMouseUp(e: React.MouseEvent) {
    const [cx, cy] = screenToCanvas(e.clientX, e.clientY)

    if (tool === 'pan') isPanning.current = false

    if (tool === 'draw' && isDrawing.current && currentStroke) {
      isDrawing.current = false
      if (currentStroke.length > 1) {
        const stroke: WbStroke = {
          id: uid(), type: 'stroke',
          points: currentStroke, color: drawColor, width: drawWidth,
        }
        const next = { elements: [...state.elements, stroke] }
        setState(next)
        markUnsaved(next)
      }
      setCurrentStroke(null)
    }

    if ((tool === 'rect' || tool === 'circle') && isShaping.current && shapeStart.current) {
      isShaping.current = false
      const { cx: sx, cy: sy } = shapeStart.current
      const x = Math.min(sx, cx), y = Math.min(sy, cy)
      const w = Math.abs(cx - sx), h = Math.abs(cy - sy)
      if (w > 5 && h > 5) {
        const shape: WbShape = { id: uid(), type: tool, x, y, w, h, color: shapeColor }
        const next = { elements: [...state.elements, shape] }
        setState(next)
        markUnsaved(next)
      }
      setShapePreview(null)
      shapeStart.current = null
    }
  }

  // ── Add note ──

  function addNote(cx: number, cy: number) {
    const note: WbNote = {
      id: uid(), type: 'note',
      x: cx, y: cy, w: 180, h: 140,
      text: '',
      color: 'yellow',
    }
    const next = { elements: [...state.elements, note] }
    setState(next)
    markUnsaved(next)
    setEditingNoteId(note.id)
    setTool('pan')
  }

  // ── Element drag ──

  function startDragElement(e: React.MouseEvent, id: string) {
    if (tool !== 'pan') return
    e.stopPropagation()
    const el = state.elements.find(el => el.id === id) as (WbNote | WbImage | WbShape) | undefined
    if (!el) return
    const startX = e.clientX, startY = e.clientY
    const origX = el.x, origY = el.y

    function onMove(ev: MouseEvent) {
      const dx = (ev.clientX - startX) / zoom
      const dy = (ev.clientY - startY) / zoom
      setState(prev => ({
        elements: prev.elements.map(el2 =>
          el2.id === id ? { ...el2, x: origX + dx, y: origY + dy } : el2
        ),
      }))
    }
    function onUp() {
      setState(prev => {
        markUnsaved(prev)
        return prev
      })
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Element resize ──

  function startResizeElement(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    const el = state.elements.find(el => el.id === id) as (WbNote | WbImage | WbShape) | undefined
    if (!el) return
    const startX = e.clientX, startY = e.clientY
    const origW = el.w, origH = el.h

    function onMove(ev: MouseEvent) {
      const dw = (ev.clientX - startX) / zoom
      const dh = (ev.clientY - startY) / zoom
      setState(prev => ({
        elements: prev.elements.map(el2 =>
          el2.id === id ? { ...el2, w: Math.max(80, origW + dw), h: Math.max(60, origH + dh) } : el2
        ),
      }))
    }
    function onUp() {
      setState(prev => { markUnsaved(prev); return prev })
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Context menu ──

  function handleCtxMenu(e: React.MouseEvent, el: WbElement) {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, elementId: el.id, elementType: el.type })
  }

  function deleteElement(id: string) {
    const next = { elements: state.elements.filter(el => el.id !== id) }
    setState(next)
    markUnsaved(next)
    setCtxMenu(null)
  }

  function changeNoteColor(id: string, color: NoteColor) {
    const next = {
      elements: state.elements.map(el =>
        el.id === id && el.type === 'note' ? { ...el, color } : el
      ),
    }
    setState(next)
    markUnsaved(next)
    setCtxMenu(null)
  }

  // ── Image upload ──

  async function handleImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingImage(true)
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      try {
        let src: string
        // Try Supabase Storage upload
        try {
          const path = `projects/${projectCode}/whiteboard/${Date.now()}-${file.name}`
          const { data, error } = await sb.storage.from('invoices').upload(path, file, { upsert: true })
          if (error) throw error
          const { data: pub } = sb.storage.from('invoices').getPublicUrl(data.path)
          src = pub.publicUrl
        } catch {
          // Fall back to base64
          src = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = e => resolve(e.target!.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
        }
        const img: WbImage = {
          id: uid(), type: 'image',
          x: (300 - panX) / zoom, y: (200 - panY) / zoom,
          w: 300, h: 220, src,
        }
        setState(prev => {
          const next = { elements: [...prev.elements, img] }
          markUnsaved(next)
          return next
        })
      } catch (err) {
        toast(`Image upload failed: ${String(err)}`, 'error')
      }
    }
    setUploadingImage(false)
  }

  // Paste image
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return
      const imageItem = Array.from(items).find(i => i.type.startsWith('image/'))
      if (!imageItem) return
      const file = imageItem.getAsFile()
      if (file) handleImageFiles(Object.assign(new DataTransfer(), { files: [file] }).files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectCode, panX, panY, zoom])

  // Drop image
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    handleImageFiles(e.dataTransfer.files)
  }

  // ── Clear ──

  function clearBoard() {
    const next = { elements: [] }
    setState(next)
    saveState(projectCode, next)
    setSaved(true)
    setClearConfirm(false)
    toast('Whiteboard cleared')
  }

  // ── Export as PNG ──

  async function exportPNG() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const h2c = ((await import(/* webpackIgnore: true */ 'html2canvas' as string)) as any).default
      const el = document.getElementById('wb-canvas-root')
      if (!el) return
      const canvas = await h2c(el, { useCORS: true, backgroundColor: '#f8f8f6' })
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `whiteboard-${projectCode}.png`
      a.click()
      toast('Exported PNG')
    } catch {
      toast('Export failed — html2canvas not available', 'error')
    }
  }

  // ── SVG path builder ──

  function pointsToPath(points: [number, number][]): string {
    if (points.length < 2) return ''
    let d = `M ${points[0][0]} ${points[0][1]}`
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i][0]} ${points[i][1]}`
    }
    return d
  }

  // ── Cursor ──

  const cursor =
    tool === 'pan' ? 'grab' :
    tool === 'draw' ? 'crosshair' :
    tool === 'eraser' ? 'cell' :
    tool === 'text' ? 'text' :
    'crosshair'

  // ─── Render ───────────────────────────────────────────────────────────────────

  const strokes = state.elements.filter(el => el.type === 'stroke') as WbStroke[]
  const nonStrokes = state.elements.filter(el => el.type !== 'stroke') as (WbNote | WbImage | WbShape)[]

  return (
    <div className="flex flex-col h-full relative bg-paper select-none">

      {/* ── Toolbar ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-cream border-b border-rule flex-wrap">

        {/* Tools */}
        <div className="flex items-center gap-1 bg-[#1a1a1a]/10 px-1.5 py-1 rounded-none">
          {([
            { key: 'pan',    icon: <Move size={14} />,       title: 'Pan / Select (V)' },
            { key: 'draw',   icon: <Pen size={14} />,        title: 'Freehand Draw (D)' },
            { key: 'text',   icon: <Type size={14} />,       title: 'Add Text Note (T)' },
            { key: 'image',  icon: <ImageIcon size={14} />,  title: 'Add Image (I)' },
            { key: 'rect',   icon: <Square size={14} />,     title: 'Rectangle (R)' },
            { key: 'circle', icon: <Circle size={14} />,     title: 'Circle (C)' },
            { key: 'eraser', icon: <Eraser size={14} />,     title: 'Eraser (E)' },
          ] as { key: Tool; icon: React.ReactNode; title: string }[]).map(t => (
            <button
              key={t.key}
              title={t.title}
              onClick={() => {
                if (t.key === 'image') { imageInputRef.current?.click(); return }
                setTool(t.key)
              }}
              className={`p-1.5 transition-colors ${tool === t.key ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
            >
              {t.icon}
            </button>
          ))}
        </div>

        {/* Draw options */}
        {tool === 'draw' && (
          <div className="flex items-center gap-2">
            <input type="color" value={drawColor} onChange={e => setDrawColor(e.target.value)}
              className="w-6 h-6 border border-rule cursor-pointer" title="Stroke colour" />
            <select value={drawWidth} onChange={e => setDrawWidth(Number(e.target.value))}
              className="border border-rule bg-white text-xs font-mono px-1 py-0.5 focus:outline-none">
              <option value={1}>1px</option>
              <option value={2}>2px</option>
              <option value={4}>4px</option>
              <option value={8}>8px</option>
            </select>
          </div>
        )}

        {/* Shape colour */}
        {(tool === 'rect' || tool === 'circle') && (
          <div className="flex items-center gap-2">
            <input type="color" value={shapeColor} onChange={e => setShapeColor(e.target.value)}
              className="w-6 h-6 border border-rule cursor-pointer" title="Shape colour" />
          </div>
        )}

        <div className="flex-1" />

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} title="Zoom out" className="p-1 text-muted hover:text-ink transition-colors"><ZoomOut size={14} /></button>
          <span className="font-mono text-[10px] text-muted w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={zoomIn} title="Zoom in" className="p-1 text-muted hover:text-ink transition-colors"><ZoomIn size={14} /></button>
          <button onClick={zoomReset} title="Reset zoom" className="p-1 text-muted hover:text-ink transition-colors"><Maximize2 size={14} /></button>
        </div>

        {/* Export + clear */}
        <button onClick={exportPNG} title="Export as PNG"
          className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 border border-rule text-muted hover:text-ink transition-colors">
          <Download size={11} /> Export
        </button>
        {clearConfirm ? (
          <div className="flex items-center gap-1">
            <button onClick={clearBoard} className="font-mono text-[10px] px-2 py-1 bg-red-500 text-white hover:bg-red-600 transition-colors">
              Confirm clear
            </button>
            <button onClick={() => setClearConfirm(false)} className="p-1 text-muted hover:text-ink"><X size={12} /></button>
          </div>
        ) : (
          <button onClick={() => setClearConfirm(true)} title="Clear whiteboard"
            className="flex items-center gap-1 font-mono text-[10px] px-2 py-1 border border-rule text-muted hover:text-red-500 hover:border-red-300 transition-colors">
            <Trash2 size={11} /> Clear
          </button>
        )}

        {/* Save indicator */}
        <div className="flex items-center gap-1 font-mono text-[10px]">
          {saved
            ? <><Save size={10} className="text-green-600" /><span className="text-green-600">Saved</span></>
            : <><Save size={10} className="text-amber-500 animate-pulse" /><span className="text-amber-500">Unsaved</span></>
          }
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative"
        style={{ cursor, background: '#f8f8f6' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onContextMenu={e => e.preventDefault()}
      >
        {/* Dot-grid background */}
        <svg
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' }}
          aria-hidden
        >
          <defs>
            <pattern
              id="wb-dot-grid"
              x={panX % (20 * zoom)}
              y={panY % (20 * zoom)}
              width={20 * zoom}
              height={20 * zoom}
              patternUnits="userSpaceOnUse"
            >
              <circle cx={1} cy={1} r={0.8} fill="#d1d1cf" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#wb-dot-grid)" />
        </svg>

        {/* ── Canvas transform root ── */}
        <div
          id="wb-canvas-root"
          style={{
            position: 'absolute',
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: 3000,
            height: 3000,
          }}
        >
          {/* SVG overlay for strokes + shape preview */}
          <svg
            ref={svgRef}
            style={{ position: 'absolute', inset: 0, width: 3000, height: 3000, pointerEvents: 'none', overflow: 'visible' }}
          >
            {/* Committed strokes */}
            {strokes.map(s => (
              <path
                key={s.id}
                d={pointsToPath(s.points)}
                stroke={s.color}
                strokeWidth={s.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {/* In-progress stroke */}
            {currentStroke && currentStroke.length > 1 && (
              <path
                d={pointsToPath(currentStroke)}
                stroke={drawColor}
                strokeWidth={drawWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {/* Shape preview */}
            {shapePreview && tool === 'rect' && (
              <rect x={shapePreview.x} y={shapePreview.y} width={shapePreview.w} height={shapePreview.h}
                fill="none" stroke={shapeColor} strokeWidth={2} strokeDasharray="6 3" />
            )}
            {shapePreview && tool === 'circle' && (
              <ellipse
                cx={shapePreview.x + shapePreview.w / 2} cy={shapePreview.y + shapePreview.h / 2}
                rx={shapePreview.w / 2} ry={shapePreview.h / 2}
                fill="none" stroke={shapeColor} strokeWidth={2} strokeDasharray="6 3" />
            )}
          </svg>

          {/* Shapes (committed) */}
          <svg style={{ position: 'absolute', inset: 0, width: 3000, height: 3000, pointerEvents: tool === 'pan' ? 'all' : 'none', overflow: 'visible' }}>
            {(state.elements.filter(el => el.type === 'rect' || el.type === 'circle') as WbShape[]).map(s => (
              s.type === 'rect' ? (
                <rect
                  key={s.id}
                  x={s.x} y={s.y} width={s.w} height={s.h}
                  fill="none" stroke={s.color} strokeWidth={2}
                  style={{ cursor: tool === 'pan' ? 'move' : undefined }}
                  onMouseDown={e => startDragElement(e, s.id)}
                  onContextMenu={e => handleCtxMenu(e, s)}
                />
              ) : (
                <ellipse
                  key={s.id}
                  cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2}
                  fill="none" stroke={s.color} strokeWidth={2}
                  style={{ cursor: tool === 'pan' ? 'move' : undefined }}
                  onMouseDown={e => startDragElement(e, s.id)}
                  onContextMenu={e => handleCtxMenu(e, s)}
                />
              )
            ))}
          </svg>

          {/* Notes + Images (non-stroke, non-shape elements) */}
          {(state.elements.filter(el => el.type === 'note' || el.type === 'image') as (WbNote | WbImage)[]).map(el => {
            if (el.type === 'note') {
              const nc = NOTE_COLORS[el.color]
              const isEditing = editingNoteId === el.id
              return (
                <div
                  key={el.id}
                  style={{
                    position: 'absolute',
                    left: el.x, top: el.y, width: el.w, height: el.h,
                    background: nc.bg,
                    border: `2px solid ${nc.border}`,
                    boxSizing: 'border-box',
                    cursor: tool === 'pan' ? 'move' : 'default',
                    display: 'flex', flexDirection: 'column',
                    boxShadow: '2px 2px 8px rgba(0,0,0,0.10)',
                  }}
                  onMouseDown={e => !isEditing && startDragElement(e, el.id)}
                  onDoubleClick={e => { e.stopPropagation(); setEditingNoteId(el.id) }}
                  onContextMenu={e => handleCtxMenu(e, el)}
                >
                  {isEditing ? (
                    <textarea
                      autoFocus
                      value={el.text}
                      onChange={ev => {
                        setState(prev => {
                          const next = { elements: prev.elements.map(e2 => e2.id === el.id ? { ...e2, text: ev.target.value } : e2) }
                          markUnsaved(next)
                          return next
                        })
                      }}
                      onBlur={() => setEditingNoteId(null)}
                      onMouseDown={e => e.stopPropagation()}
                      style={{
                        flex: 1, width: '100%', border: 'none', outline: 'none', resize: 'none',
                        background: 'transparent', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5,
                        padding: '10px 10px 6px',
                      }}
                      placeholder="Type your note…"
                    />
                  ) : (
                    <div style={{ flex: 1, padding: '10px 10px 6px', fontSize: 13, lineHeight: 1.5, overflow: 'hidden', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {el.text || <span style={{ color: '#9a9a9a', fontStyle: 'italic' }}>Double-click to edit</span>}
                    </div>
                  )}
                  {/* Resize handle */}
                  <div
                    style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'se-resize', opacity: 0.4 }}
                    onMouseDown={e => startResizeElement(e, el.id)}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14">
                      <path d="M 14 0 L 14 14 L 0 14" fill="none" stroke="#999" strokeWidth="1.5" />
                    </svg>
                  </div>
                </div>
              )
            }

            if (el.type === 'image') {
              return (
                <div
                  key={el.id}
                  style={{
                    position: 'absolute',
                    left: el.x, top: el.y, width: el.w, height: el.h,
                    cursor: tool === 'pan' ? 'move' : 'default',
                    border: '1px solid #e2e2e0',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                  }}
                  onMouseDown={e => startDragElement(e, el.id)}
                  onContextMenu={e => handleCtxMenu(e, el)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={el.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
                  {/* Resize handle */}
                  <div
                    style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, cursor: 'se-resize', background: 'rgba(0,0,0,0.15)' }}
                    onMouseDown={e => startResizeElement(e, el.id)}
                  />
                </div>
              )
            }

            return null
          })}
        </div>

        {/* Uploading overlay */}
        {uploadingImage && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center pointer-events-none">
            <p className="font-mono text-xs text-ink animate-pulse">Uploading image…</p>
          </div>
        )}

        {/* Drop hint */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 font-mono text-[10px] text-muted pointer-events-none">
          Drag & drop images · Cmd+V to paste · Double-click to add a note · Scroll to zoom
        </div>
      </div>

      {/* ── Context menu ── */}
      {ctxMenu && (
        <div
          className="fixed z-[90] bg-white border border-rule shadow-lg min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          {ctxMenu.elementType === 'note' && (
            <div className="px-3 py-2 border-b border-rule">
              <p className="font-mono text-[10px] text-muted uppercase tracking-wider mb-1.5">Note colour</p>
              <div className="flex gap-1.5">
                {(Object.keys(NOTE_COLORS) as NoteColor[]).map(c => (
                  <button
                    key={c}
                    onClick={() => changeNoteColor(ctxMenu.elementId, c)}
                    style={{ background: NOTE_COLORS[c].bg, border: `2px solid ${NOTE_COLORS[c].border}` }}
                    className="w-6 h-6 hover:scale-110 transition-transform"
                    title={c}
                  />
                ))}
              </div>
            </div>
          )}
          <button
            onClick={() => deleteElement(ctxMenu.elementId)}
            className="w-full text-left px-4 py-2.5 font-mono text-xs text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
          >
            <Trash2 size={12} /> Delete
          </button>
          <button
            onClick={() => setCtxMenu(null)}
            className="w-full text-left px-4 py-2.5 font-mono text-xs text-muted hover:bg-cream transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Hidden image file input */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => { handleImageFiles(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
