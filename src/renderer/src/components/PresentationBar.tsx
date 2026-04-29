import React, { useState, useRef, useEffect } from 'react'
import { useDiagramStore } from '../store/diagramStore'
import type { DiagramView, PresentationSlide } from '../types/c4'

// ── SVG icons ────────────────────────────────────────────────────────────────

const IconPrev = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const IconNext = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const IconExit = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
)
const IconCapture = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="2" y="4" width="12" height="9" rx="1.5" />
    <circle cx="8" cy="8.5" r="2.2" />
    <path d="M5.5 4V3a.5.5 0 01.5-.5h4a.5.5 0 01.5.5v1" />
  </svg>
)
const IconDelete = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M3 5h10M6 5V3h4v2M6 8v5M10 8v5" strokeLinecap="round" />
    <rect x="4" y="5" width="8" height="8" rx="1" />
  </svg>
)
const IconPresent = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <rect x="1" y="2" width="14" height="10" rx="1.5" />
    <path d="M5 14h6M8 12v2" strokeLinecap="round" />
    <path d="M6 6.5L10 8.5 6 10.5V6.5z" fill="currentColor" stroke="none" />
  </svg>
)
const IconAdd = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
  </svg>
)
const IconLink = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M7 9a3 3 0 004.24.17l1.5-1.5a3 3 0 00-4.24-4.24L7 4.93" strokeLinecap="round" />
    <path d="M9 7a3 3 0 00-4.24-.17L3.26 8.33a3 3 0 004.24 4.24L9 11.07" strokeLinecap="round" />
  </svg>
)

const IconView = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" strokeLinejoin="round" />
    <circle cx="8" cy="8" r="2" />
  </svg>
)

// ── Snapshot picker dropdown ──────────────────────────────────────────────────

function SnapPicker({ currentId, onPick, onClose }: {
  currentId: string | null
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const snapshots = useDiagramStore(s => s.snapshots)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="pres-snap-picker">
      <div className="pres-snap-picker-title">Link milestone</div>
      <button className={`pres-snap-item${currentId === null ? ' active' : ''}`}
        onClick={() => { onPick(null); onClose() }}>
        <em>(none — current state)</em>
      </button>
      {snapshots.length === 0 && (
        <div className="pres-snap-item disabled">No milestones yet</div>
      )}
      {snapshots.map(s => (
        <button key={s.id}
          className={`pres-snap-item${currentId === s.id ? ' active' : ''}`}
          onClick={() => { onPick(s.id); onClose() }}>
          {s.name}
        </button>
      ))}
    </div>
  )
}

// ── View picker dropdown ──────────────────────────────────────────────────────

function ViewPicker({ currentId, views, onPick, onClose }: {
  currentId: string | null | undefined
  views: Record<string, DiagramView>
  onPick: (id: string | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const viewList = Object.values(views)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div ref={ref} className="pres-snap-picker">
      <div className="pres-snap-picker-title">Link view</div>
      <button className={`pres-snap-item${!currentId ? ' active' : ''}`}
        onClick={() => { onPick(null); onClose() }}>
        <em>(none — show all)</em>
      </button>
      {viewList.length === 0 && (
        <div className="pres-snap-item disabled">No views yet</div>
      )}
      {viewList.map(v => (
        <button key={v.id}
          className={`pres-snap-item${currentId === v.id ? ' active' : ''}`}
          onClick={() => { onPick(v.id); onClose() }}>
          {v.name}
        </button>
      ))}
    </div>
  )
}

// ── Slide thumbnail card ──────────────────────────────────────────────────────

function SlideCard({ slide, index, isActive, snapshotNames, viewNames, views, onSelect, onDelete, onRename, onCapture, onLinkSnapshot, onLinkView }: {
  slide: PresentationSlide
  index: number
  isActive: boolean
  snapshotNames: Record<string, string>
  viewNames: Record<string, string>
  views: Record<string, DiagramView>
  onSelect: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onCapture: () => void
  onLinkSnapshot: (id: string | null) => void
  onLinkView: (id: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(slide.name)
  const [snapPickerOpen, setSnapPickerOpen] = useState(false)
  const [viewPickerOpen, setViewPickerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraftName(slide.name) }, [slide.name])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commitRename = () => {
    const name = draftName.trim()
    if (name && name !== slide.name) onRename(name)
    setEditing(false)
  }

  return (
    <div className={`pres-slide-card${isActive ? ' active' : ''}`} onClick={onSelect}>
      <div className="pres-slide-num">{index + 1}</div>
      <div className="pres-slide-body">
        {editing ? (
          <input ref={inputRef} className="pres-slide-name-input" value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftName(slide.name); setEditing(false) }
              e.stopPropagation()
            }}
            onClick={e => e.stopPropagation()} />
        ) : (
          <span className="pres-slide-name"
            onDoubleClick={e => { e.stopPropagation(); setEditing(true) }}
            title="Double-click to rename">
            {slide.name}
          </span>
        )}
        {slide.snapshotId && (
          <span className="pres-slide-snap-tag" title={`Milestone: ${snapshotNames[slide.snapshotId]}`}>
            {snapshotNames[slide.snapshotId] ?? '?'}
          </span>
        )}
        {slide.viewId && (
          <span className="pres-slide-view-tag" title={`View: ${viewNames[slide.viewId]}`}>
            {viewNames[slide.viewId] ?? '?'}
          </span>
        )}
      </div>
      <div className="pres-slide-actions" onClick={e => e.stopPropagation()}>
        <button className="pres-icon-btn" title="Capture canvas state (positions, zoom, expanded/collapsed)" onClick={onCapture}>
          <IconCapture />
        </button>
        <div style={{ position: 'relative' }}>
          <button className={`pres-icon-btn${slide.snapshotId ? ' linked' : ''}`}
            title="Link milestone" onClick={() => setSnapPickerOpen(v => !v)}>
            <IconLink />
          </button>
          {snapPickerOpen && (
            <SnapPicker currentId={slide.snapshotId} onPick={onLinkSnapshot}
              onClose={() => setSnapPickerOpen(false)} />
          )}
        </div>
        <div style={{ position: 'relative' }}>
          <button className={`pres-icon-btn${slide.viewId ? ' linked' : ''}`}
            title="Link view" onClick={() => setViewPickerOpen(v => !v)}>
            <IconView />
          </button>
          {viewPickerOpen && (
            <ViewPicker currentId={slide.viewId} views={views} onPick={onLinkView}
              onClose={() => setViewPickerOpen(false)} />
          )}
        </div>
        <button className="pres-icon-btn danger" title="Delete slide" onClick={onDelete}>
          <IconDelete />
        </button>
      </div>
    </div>
  )
}

// ── Presenter HUD (shown during active presentation) ─────────────────────────

function PresenterHUD() {
  const slides = useDiagramStore(s => s.presentationSlides)
  const idx = useDiagramStore(s => s.presentationSlideIndex)
  const goToSlide = useDiagramStore(s => s.goToSlide)
  const stopPresentation = useDiagramStore(s => s.stopPresentation)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { stopPresentation(); return }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault(); goToSlide(idx + 1)
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); goToSlide(idx - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goToSlide, stopPresentation, idx])

  return (
    <div className="pres-hud">
      <button className="pres-hud-btn" disabled={idx === 0}
        onClick={() => goToSlide(idx - 1)} title="Previous (←)">
        <IconPrev />
      </button>
      <div className="pres-hud-dots">
        {slides.map((s, i) => (
          <button key={s.id}
            className={`pres-hud-dot${i === idx ? ' active' : ''}`}
            onClick={() => goToSlide(i)} title={s.name} />
        ))}
      </div>
      <div className="pres-hud-label">
        <strong>{slides[idx]?.name ?? ''}</strong>
        <span className="pres-hud-counter">{idx + 1} / {slides.length}</span>
      </div>
      <button className="pres-hud-btn" disabled={idx === slides.length - 1}
        onClick={() => goToSlide(idx + 1)} title="Next (→)">
        <IconNext />
      </button>
      <button className="pres-hud-btn exit" onClick={stopPresentation} title="Exit (Esc)">
        <IconExit />
      </button>
    </div>
  )
}

// ── SlidesColumn — embeddable slides panel ────────────────────────────────────

function PresentationPicker() {
  const presentations = useDiagramStore(s => s.presentations)
  const activeId = useDiagramStore(s => s.activePresentationId)
  const setActivePresentation = useDiagramStore(s => s.setActivePresentation)
  const addPresentation = useDiagramStore(s => s.addPresentation)
  const removePresentation = useDiagramStore(s => s.removePresentation)
  const renamePresentation = useDiagramStore(s => s.renamePresentation)

  const active = presentations.find(p => p.id === activeId)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(active?.name ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraftName(active?.name ?? '') }, [active?.id, active?.name])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const commitRename = () => {
    const name = draftName.trim()
    if (active && name && name !== active.name) renamePresentation(active.id, name)
    setEditing(false)
  }

  const handleDelete = () => {
    if (!active) return
    if (window.confirm(`Delete presentation "${active.name}" and all its slides?`)) {
      removePresentation(active.id)
    }
  }

  return (
    <div className="pres-picker">
      <div className="pres-picker-row">
        {editing ? (
          <input ref={inputRef} className="pres-picker-input" value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraftName(active?.name ?? ''); setEditing(false) }
            }} />
        ) : (
          <select className="pres-picker-select"
            value={activeId ?? ''}
            onChange={e => setActivePresentation(e.target.value)}>
            {presentations.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.slides.length})</option>
            ))}
          </select>
        )}
        <button className="pres-icon-btn" title="Rename presentation"
          onClick={() => setEditing(v => !v)}>
          ✎
        </button>
        <button className="pres-icon-btn" title="New presentation"
          onClick={() => addPresentation()}>
          <IconAdd />
        </button>
        <button className="pres-icon-btn danger" title="Delete presentation"
          onClick={handleDelete}>
          <IconDelete />
        </button>
      </div>
    </div>
  )
}

export function SlidesColumn({ readOnly = false }: { readOnly?: boolean } = {}): React.ReactElement {
  const slides = useDiagramStore(s => s.presentationSlides)
  const idx = useDiagramStore(s => s.presentationSlideIndex)
  const snapshots = useDiagramStore(s => s.snapshots)
  const views = useDiagramStore(s => s.views)

  const addPresentationSlide = useDiagramStore(s => s.addPresentationSlide)
  const removePresentationSlide = useDiagramStore(s => s.removePresentationSlide)
  const renamePresentationSlide = useDiagramStore(s => s.renamePresentationSlide)
  const captureSlideViewport = useDiagramStore(s => s.captureSlideViewport)
  const linkSnapshotToSlide = useDiagramStore(s => s.linkSnapshotToSlide)
  const linkViewToSlide = useDiagramStore(s => s.linkViewToSlide)
  const startPresentation = useDiagramStore(s => s.startPresentation)
  const goToSlide = useDiagramStore(s => s.goToSlide)

  const snapshotNames: Record<string, string> = {}
  for (const s of snapshots) snapshotNames[s.id] = s.name

  const viewNames: Record<string, string> = {}
  for (const v of Object.values(views)) viewNames[v.id] = v.name

  return (
    <div className="pres-slides-inline">
      <PresentationPicker />
      <div className="pres-slides-actions">
        <button className="pres-panel-btn primary" onClick={startPresentation}
          disabled={slides.length === 0} title="Start presentation (F5)">
          <IconPresent />Present
        </button>
        {!readOnly && (
          <button className="pres-panel-btn" onClick={() => addPresentationSlide()}
            title="Add slide from current canvas state">
            <IconAdd />Add slide
          </button>
        )}
      </div>
      <div className="pres-slide-list">
        {slides.length === 0 && (
          <div className="pres-empty">
            {readOnly ? 'No slides in this presentation.' : <>No slides yet — click <strong>Add slide</strong>.</>}
          </div>
        )}
        {slides.map((slide, i) => (
          <SlideCard key={slide.id} slide={slide} index={i} isActive={i === idx}
            snapshotNames={snapshotNames}
            viewNames={viewNames}
            views={views}
            onSelect={() => goToSlide(i)}
            onDelete={() => removePresentationSlide(slide.id)}
            onRename={(name) => renamePresentationSlide(slide.id, name)}
            onCapture={() => captureSlideViewport(slide.id)}
            onLinkSnapshot={(snapId) => linkSnapshotToSlide(slide.id, snapId)}
            onLinkView={(viewId) => linkViewToSlide(slide.id, viewId)}
          />
        ))}
      </div>
    </div>
  )
}

// ── PresenterDock — horizontal slides bar at the bottom (presenter mode) ─────

export function PresenterDock({ readOnly = false }: { readOnly?: boolean } = {}): React.ReactElement {
  const slides = useDiagramStore(s => s.presentationSlides)
  const idx = useDiagramStore(s => s.presentationSlideIndex)
  const snapshots = useDiagramStore(s => s.snapshots)
  const views = useDiagramStore(s => s.views)

  const addPresentationSlide = useDiagramStore(s => s.addPresentationSlide)
  const removePresentationSlide = useDiagramStore(s => s.removePresentationSlide)
  const renamePresentationSlide = useDiagramStore(s => s.renamePresentationSlide)
  const captureSlideViewport = useDiagramStore(s => s.captureSlideViewport)
  const linkSnapshotToSlide = useDiagramStore(s => s.linkSnapshotToSlide)
  const linkViewToSlide = useDiagramStore(s => s.linkViewToSlide)
  const startPresentation = useDiagramStore(s => s.startPresentation)
  const goToSlide = useDiagramStore(s => s.goToSlide)

  const activeRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [idx])

  const snapshotNames: Record<string, string> = {}
  for (const s of snapshots) snapshotNames[s.id] = s.name
  const viewNames: Record<string, string> = {}
  for (const v of Object.values(views)) viewNames[v.id] = v.name

  return (
    <div className="pres-dock">
      <div className="pres-dock-controls">
        <PresentationPicker />
        <div className="pres-dock-actions">
          <button className="pres-panel-btn primary" onClick={startPresentation}
            disabled={slides.length === 0} title="Start presentation (F5)">
            <IconPresent />Present
          </button>
          {!readOnly && (
            <button className="pres-panel-btn" onClick={() => addPresentationSlide()}
              title="Add slide from current canvas state">
              <IconAdd />Add slide
            </button>
          )}
        </div>
      </div>
      <div className="pres-dock-track">
        {slides.length === 0 && (
          <div className="pres-empty pres-dock-empty">
            {readOnly ? 'No slides in this presentation.' : <>No slides yet — click <strong>Add slide</strong>.</>}
          </div>
        )}
        {slides.map((slide, i) => (
          <div key={slide.id} ref={i === idx ? activeRef : null} className="pres-dock-card-wrap">
            <SlideCard slide={slide} index={i} isActive={i === idx}
              snapshotNames={snapshotNames}
              viewNames={viewNames}
              views={views}
              onSelect={() => goToSlide(i)}
              onDelete={() => removePresentationSlide(slide.id)}
              onRename={(name) => renamePresentationSlide(slide.id, name)}
              onCapture={() => captureSlideViewport(slide.id)}
              onLinkSnapshot={(snapId) => linkSnapshotToSlide(slide.id, snapId)}
              onLinkView={(viewId) => linkViewToSlide(slide.id, viewId)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main PresentationBar — only HUD overlay during active presentation ────────

export function PresentationBar(): React.ReactElement | null {
  const presentationActive = useDiagramStore(s => s.presentationActive)
  if (!presentationActive) return null
  return <PresenterHUD />
}
