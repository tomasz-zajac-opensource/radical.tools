import React, { memo, useCallback } from 'react'
import { NodeProps, Handle, Position } from 'reactflow'
import { C4NodeRFData, NODE_COLORS } from '../../types/c4'
import { useDiagramStore } from '../../store/diagramStore'
import { composeEarsSentence, resolveEarsSubject } from '../../types/metamodel'

// ─── Diff highlight overlay ────────────────────────────────────────────────
function DiffOverlay({ c4id }: { c4id: string }) {
  const diff = useDiagramStore(s => s.showDiff ? s.diffHighlight[c4id] : undefined)
  if (!diff) return null
  const color =
    diff === 'new' ? 'var(--success)'
    : diff === 'removed' ? 'var(--danger)'
    : 'var(--warning, #d97706)'
  const label =
    diff === 'new' ? 'NEW'
    : diff === 'removed' ? 'REMOVED'
    : 'CHANGED'
  const dashed = diff === 'removed'
  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      borderRadius: 'inherit',
      border: `3px ${dashed ? 'dashed' : 'solid'} ${color}`,
      boxShadow: `inset 0 0 14px ${color}44`,
      pointerEvents: 'none',
      zIndex: 10,
    }}>
      <div style={{
        position: 'absolute',
        top: 4,
        right: 4,
        background: color,
        color: diff === 'new' ? '#000' : '#fff',
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: '0.08em',
        padding: '1px 5px',
        borderRadius: 3,
        pointerEvents: 'none',
      }}>{label}</div>
    </div>
  )
}

const COLOR = NODE_COLORS.person
const ALT_COLOR = '#6b6b6b' // external person

// ─── Shared handles (8 handles: source+target on each side) ──────────────────
function AllHandles() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="top-target" />
      <Handle type="source" position={Position.Top} id="top-source" />
      <Handle type="target" position={Position.Bottom} id="bottom-target" />
      <Handle type="source" position={Position.Bottom} id="bottom-source" />
      <Handle type="target" position={Position.Left} id="left-target" />
      <Handle type="source" position={Position.Left} id="left-source" />
      <Handle type="target" position={Position.Right} id="right-target" />
      <Handle type="source" position={Position.Right} id="right-source" />
    </>
  )
}

// ─── C4 Person silhouette (head circle + rounded body) ───────────────────────
function PersonFigure({ color }: { color: string }) {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ marginTop: 4, flexShrink: 0 }}>
      {/* Head */}
      <circle cx="22" cy="11" r="10" fill={color} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
      {/* Body – rounded rectangle representing torso/shoulders */}
      <rect x="2" y="25" width="40" height="18" rx="10" fill={color} stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" />
    </svg>
  )
}

export const PersonNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const bg = data.external ? ALT_COLOR : COLOR

  return (
    <div
      className="c4-node c4-person-node"
      style={{
        position: 'relative',
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      {/* Person silhouette above the box */}
      <PersonFigure color={bg} />

      {/* Box body */}
      <div
        className="c4-person-body"
        style={{
          background: bg,
          border: `2px solid ${selected ? 'var(--accent)' : 'rgba(0,0,0,0.25)'}`,
          borderRadius: 8,
          flex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          overflow: 'hidden',
        }}
      >
        <div className="c4-node-label" style={{ textAlign: 'center', paddingTop: 6 }}>
          {data.label}
        </div>

        <div className="c4-node-tech" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontStyle: 'normal', fontWeight: 700 }}>
          {data.external ? 'External Person' : 'Person'}
        </div>

        {data.description && (
          <div className="c4-node-desc" style={{ textAlign: 'center' }}>
            {data.description}
          </div>
        )}
      </div>
    </div>
  )
})

PersonNode.displayName = 'PersonNode'

// ─── System Node ──────────────────────────────────────────────────────────────

export const SystemNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const toggleCollapse = useDiagramStore((s) => s.toggleCollapse)
  const canEdit = useDiagramStore((s) => s.appMode !== 'metamodel' && !s.presentationActive)
  const onToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleCollapse(data.c4id)
    },
    [data.c4id, toggleCollapse]
  )

  const solidBg = data.external ? ALT_COLOR : NODE_COLORS.system
  const isExpanded = data.hasChildren && !data.collapsed
  const borderColor = selected ? 'var(--accent)' : (isExpanded ? solidBg : 'rgba(0,0,0,0.2)')

  return (
    <div
      className={`c4-node${isExpanded ? ' c4-node-expanded' : ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: isExpanded ? 'transparent' : solidBg,
        border: `2px ${isExpanded ? 'dashed' : 'solid'} ${borderColor}`,
        borderRadius: 8,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      {/* Header bar */}
      <div className="c4-node-header" style={{ background: isExpanded ? 'transparent' : 'rgba(0,0,0,0.2)' }}>
        <span style={isExpanded ? { color: solidBg } : undefined}>{data.external ? 'External System' : 'Software System'}</span>
        {data.hasChildren && canEdit && (
          <button className="c4-node-collapse-btn" onClick={onToggle} title={data.collapsed ? 'Expand' : 'Collapse'}>
            {data.collapsed ? '+' : '−'}
          </button>
        )}
      </div>

      <div className="c4-node-label" style={isExpanded ? { color: solidBg } : undefined}>{data.label}</div>
      {!isExpanded && data.technology && (
        <div className="c4-node-tech">[{data.technology}]</div>
      )}
      {!isExpanded && data.description && (
        <div className="c4-node-desc">{data.description}</div>
      )}

      {/* Children are rendered by React Flow as separate nodes */}
    </div>
  )
})

SystemNode.displayName = 'SystemNode'

// ─── Container Node ───────────────────────────────────────────────────────────

export const ContainerNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const toggleCollapse = useDiagramStore((s) => s.toggleCollapse)
  const canEdit = useDiagramStore((s) => s.appMode !== 'metamodel' && !s.presentationActive)
  const onToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleCollapse(data.c4id)
    },
    [data.c4id, toggleCollapse]
  )

  const isExpanded = data.hasChildren && !data.collapsed
  const solidBg = NODE_COLORS.container
  const borderColor = selected ? 'var(--accent)' : (isExpanded ? solidBg : 'rgba(0,0,0,0.2)')

  return (
    <div
      className={`c4-node${isExpanded ? ' c4-node-expanded' : ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: isExpanded ? 'transparent' : solidBg,
        border: `2px ${isExpanded ? 'dashed' : 'solid'} ${borderColor}`,
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      <div className="c4-node-header" style={{ background: isExpanded ? 'transparent' : 'rgba(0,0,0,0.18)' }}>
        <span style={isExpanded ? { color: solidBg } : undefined}>Container</span>
        {data.hasChildren && canEdit && (
          <button className="c4-node-collapse-btn" onClick={onToggle} title={data.collapsed ? 'Expand' : 'Collapse'}>
            {data.collapsed ? '+' : '−'}
          </button>
        )}
      </div>

      <div className="c4-node-label" style={{ fontSize: 12, ...(isExpanded ? { color: solidBg } : {}) }}>{data.label}</div>
      {!isExpanded && data.technology && (
        <div className="c4-node-tech">[{data.technology}]</div>
      )}
      {!isExpanded && data.description && (
        <div className="c4-node-desc" style={{ fontSize: 10 }}>{data.description}</div>
      )}
    </div>
  )
})

ContainerNode.displayName = 'ContainerNode'

// ─── Component Node ────────────────────────────────────────────────────────────

export const ComponentNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  return (
    <div
      className="c4-node"
      style={{
        position: 'relative',
        width: data.width,
        height: data.height,
        background: NODE_COLORS.component,
        border: `2px solid ${selected ? 'var(--accent)' : 'rgba(0,0,0,0.15)'}`,
        borderRadius: 5,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      <div
        className="c4-node-header"
        style={{ background: 'rgba(0,0,0,0.1)', color: 'rgba(0,0,0,0.6)' }}
      >
        <span>Component</span>
      </div>

      <div className="c4-node-label" style={{ fontSize: 12, color: '#111' }}>
        {data.label}
      </div>
      {data.technology && (
        <div className="c4-node-tech" style={{ color: 'rgba(0,0,0,0.6)' }}>
          [{data.technology}]
        </div>
      )}
      {data.description && (
        <div className="c4-node-desc" style={{ color: 'rgba(0,0,0,0.75)', fontSize: 10 }}>
          {data.description}
        </div>
      )}
    </div>
  )
})

ComponentNode.displayName = 'ComponentNode'

// ─── Database Node ─────────────────────────────────────────────────────────────

export const DatabaseNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const w = data.width ?? 200
  const h = data.height ?? 120
  const bg = NODE_COLORS.database
  const ry = 14 // ellipse vertical radius for cylinder caps
  const borderColor = selected ? 'var(--accent)' : 'rgba(0,0,0,0.25)'

  return (
    <div
      className="c4-node c4-database-node"
      style={{
        width: w,
        height: h,
        position: 'relative',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      {/* Cylinder SVG background */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Body */}
        <path
          d={`M0,${ry} V${h - ry} A${w / 2},${ry} 0 0,0 ${w},${h - ry} V${ry}`}
          fill={bg}
          stroke={borderColor}
          strokeWidth="2"
        />
        {/* Bottom ellipse (visible arc) */}
        <ellipse cx={w / 2} cy={h - ry} rx={w / 2} ry={ry} fill={bg} stroke={borderColor} strokeWidth="2" />
        {/* Top ellipse (full) */}
        <ellipse cx={w / 2} cy={ry} rx={w / 2} ry={ry} fill={bg} stroke={borderColor} strokeWidth="2" />
        {/* Top highlight */}
        <ellipse cx={w / 2} cy={ry} rx={w / 2 - 2} ry={ry - 2} fill="rgba(255,255,255,0.08)" stroke="none" />
      </svg>

      {/* Text content overlay */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          paddingTop: ry + 4,
          paddingBottom: ry - 4,
        }}
      >
        <div className="c4-node-label" style={{ textAlign: 'center' }}>
          {data.label}
        </div>
        <div className="c4-node-tech" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontStyle: 'normal', fontWeight: 700 }}>
          Database
        </div>
        {data.technology && (
          <div className="c4-node-tech">[{data.technology}]</div>
        )}
        {data.description && (
          <div className="c4-node-desc" style={{ textAlign: 'center' }}>
            {data.description}
          </div>
        )}
      </div>
    </div>
  )
})

DatabaseNode.displayName = 'DatabaseNode'

// ─── Web App Node ─────────────────────────────────────────────────────────────

export const WebAppNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const w = data.width ?? 220
  const h = data.height ?? 140
  const bg = NODE_COLORS.webapp
  const borderColor = selected ? 'var(--accent)' : 'rgba(0,0,0,0.25)'
  const barH = 18

  return (
    <div
      className="c4-node c4-webapp-node"
      style={{
        width: w,
        height: h,
        position: 'relative',
        background: bg,
        border: `2px solid ${borderColor}`,
        borderRadius: 8,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      {/* Browser title bar */}
      <div
        style={{
          height: barH,
          background: 'rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 6px',
          flexShrink: 0,
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5f57' }} />
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#febc2e' }} />
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#28c840' }} />
      </div>

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 8px',
          textAlign: 'center',
        }}
      >
        <div className="c4-node-label">{data.label}</div>
        <div className="c4-node-tech" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          Web App
        </div>
        {data.technology && (
          <div className="c4-node-tech">[{data.technology}]</div>
        )}
        {data.description && (
          <div className="c4-node-desc">{data.description}</div>
        )}
      </div>
    </div>
  )
})

WebAppNode.displayName = 'WebAppNode'

// ─── Queue Node ───────────────────────────────────────────────────────────────

export const QueueNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const w = data.width ?? 240
  const h = data.height ?? 90
  const bg = NODE_COLORS.queue
  const borderColor = selected ? 'var(--accent)' : 'rgba(0,0,0,0.25)'
  const rx = 16 // ellipse horizontal radius for caps

  return (
    <div
      className="c4-node c4-queue-node"
      style={{
        width: w,
        height: h,
        position: 'relative',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      {/* Horizontal cylinder SVG background */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Body */}
        <path
          d={`M${rx},0 H${w - rx} A${rx},${h / 2} 0 0,1 ${w - rx},${h} H${rx}`}
          fill={bg}
          stroke={borderColor}
          strokeWidth="2"
        />
        {/* Right cap (visible arc) */}
        <ellipse cx={w - rx} cy={h / 2} rx={rx} ry={h / 2} fill={bg} stroke={borderColor} strokeWidth="2" />
        {/* Left cap (full) */}
        <ellipse cx={rx} cy={h / 2} rx={rx} ry={h / 2} fill={bg} stroke={borderColor} strokeWidth="2" />
        {/* Left highlight */}
        <ellipse cx={rx} cy={h / 2} rx={rx - 2} ry={h / 2 - 2} fill="rgba(255,255,255,0.08)" stroke="none" />
      </svg>

      {/* Text content overlay */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          paddingLeft: rx + 4,
          paddingRight: rx + 4,
          textAlign: 'center',
        }}
      >
        <div className="c4-node-label">{data.label}</div>
        <div className="c4-node-tech" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          Queue
        </div>
        {data.technology && (
          <div className="c4-node-tech">[{data.technology}]</div>
        )}
        {data.description && (
          <div className="c4-node-desc">{data.description}</div>
        )}
      </div>
    </div>
  )
})

QueueNode.displayName = 'QueueNode'

// ─── Domain Node (DDD) ────────────────────────────────────────────────────────
//
// Always rendered as a boundary container (whether or not it has children).
// Title bar shows "Domain" plus the user-given label.

export const DomainNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const toggleCollapse = useDiagramStore((s) => s.toggleCollapse)
  const canEdit = useDiagramStore((s) => s.appMode !== 'metamodel' && !s.presentationActive)
  const onToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      toggleCollapse(data.c4id)
    },
    [data.c4id, toggleCollapse]
  )

  const accent = NODE_COLORS.domain
  const isExpanded = data.hasChildren && !data.collapsed
  const borderColor = selected ? 'var(--accent)' : accent

  return (
    <div
      className={`c4-node${isExpanded ? ' c4-node-expanded' : ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: isExpanded ? 'rgba(76,29,149,0.05)' : accent,
        border: `2px ${isExpanded ? 'dashed' : 'solid'} ${borderColor}`,
        borderRadius: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      <div className="c4-node-header" style={{ background: isExpanded ? 'transparent' : 'rgba(0,0,0,0.2)' }}>
        <span style={isExpanded ? { color: accent } : undefined}>Domain</span>
        {data.hasChildren && canEdit && (
          <button className="c4-node-collapse-btn" onClick={onToggle} title={data.collapsed ? 'Expand' : 'Collapse'}>
            {data.collapsed ? '+' : '−'}
          </button>
        )}
      </div>

      <div className="c4-node-label" style={isExpanded ? { color: accent } : undefined}>{data.label}</div>
      {!isExpanded && data.description && (
        <div className="c4-node-desc">{data.description}</div>
      )}
    </div>
  )
})

DomainNode.displayName = 'DomainNode'

// ─── ADR Node ─────────────────────────────────────────────────────────────────
//
// Compact pill: amber header strip + label on one line.

const ADR_COLOR = '#92400e'

export const AdrNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const node = useDiagramStore(s => s.c4Nodes[data.c4id])
  const status = (node as unknown as Record<string, string> | undefined)?.status ?? 'proposed'
  const statusColor: Record<string, string> = {
    proposed:   '#fbbf24',
    accepted:   '#34d399',
    deprecated: '#9ca3af',
    superseded: '#f87171',
  }
  const badge = statusColor[status] ?? '#9ca3af'

  return (
    <div
      className="c4-node"
      style={{
        position: 'relative',
        width: data.width,
        height: data.height,
        background: ADR_COLOR,
        border: `2px solid ${selected ? 'var(--accent)' : 'rgba(0,0,0,0.25)'}`,
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      {/* Row 1: type + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 7px', background: 'rgba(0,0,0,0.25)' }}>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>
          ADR
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', background: badge, color: '#000', padding: '1px 4px', borderRadius: 2 }}>
          {status}
        </span>
      </div>

      {/* Row 2: label */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {data.label}
        </span>
      </div>
    </div>
  )
})

AdrNode.displayName = 'AdrNode'

// ─── Fitness Function Node ────────────────────────────────────────────────────
//
// Compact pill: purple header strip + label on one line.

const FF_COLOR = '#5b21b6'

export const FitnessFnNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const node = useDiagramStore(s => s.c4Nodes[data.c4id])
  const extra = node as unknown as Record<string, string> | undefined
  const automated = !!(node as unknown as Record<string, unknown> | undefined)?.automated
  const status    = extra?.status ?? 'proposed'

  const statusColor: Record<string, string> = {
    proposed:   '#fbbf24',
    active:     '#34d399',
    deprecated: '#9ca3af',
  }
  const badge = statusColor[status] ?? '#9ca3af'

  return (
    <div
      className="c4-node"
      style={{
        position: 'relative',
        width: data.width,
        height: data.height,
        background: FF_COLOR,
        border: `2px solid ${selected ? 'var(--accent)' : 'rgba(0,0,0,0.25)'}`,
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      {/* Row 1: type + auto chip + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 7px', background: 'rgba(0,0,0,0.25)' }}>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>
          FF{automated && <span style={{ marginLeft: 4, background: 'rgba(52,211,153,0.4)', color: '#d1fae5', padding: '0 3px', borderRadius: 2 }}>auto</span>}
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', background: badge, color: '#000', padding: '1px 4px', borderRadius: 2 }}>
          {status}
        </span>
      </div>

      {/* Row 2: label */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {data.label}
        </span>
      </div>
    </div>
  )
})

FitnessFnNode.displayName = 'FitnessFnNode'

// ─── Requirement Node (EARS) ──────────────────────────────────────────────────
//
// Compact pill: teal/cyan header strip with EARS type + priority + status badge.

const REQ_COLOR = '#0e7490'

export const RequirementNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const node = useDiagramStore(s => s.c4Nodes[data.c4id])
  const extra = node as unknown as Record<string, string> | undefined
  const status   = extra?.status ?? 'draft'
  const priority = extra?.priority ?? 'must'

  const statusColor: Record<string, string> = {
    draft:        '#fbbf24',
    approved:     '#60a5fa',
    implemented:  '#34d399',
    verified:     '#a78bfa',
    deprecated:   '#9ca3af',
  }
  const badge = statusColor[status] ?? '#9ca3af'

  const priorityLabel: Record<string, string> = {
    must:   'M',
    should: 'S',
    could:  'C',
    "won't": 'W',
  }

  const c4Relations = useDiagramStore(s => s.c4Relations)
  const c4Nodes = useDiagramStore(s => s.c4Nodes)
  const subject = resolveEarsSubject(data.c4id, c4Relations, c4Nodes)
  const { sentence, complete } = composeEarsSentence((node ?? {}) as unknown as Record<string, unknown>, subject)

  return (
    <div
      className="c4-node"
      style={{
        position: 'relative',
        width: data.width,
        height: data.height,
        background: REQ_COLOR,
        border: `2px solid ${selected ? 'var(--accent)' : 'rgba(0,0,0,0.25)'}`,
        borderRadius: 6,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <AllHandles />
      <DiffOverlay c4id={data.c4id} />

      {/* Row 1: type + priority chip + status badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 7px', background: 'rgba(0,0,0,0.25)' }}>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>
          REQ
          <span style={{ marginLeft: 4, background: 'rgba(6,182,212,0.4)', color: '#cffafe', padding: '0 3px', borderRadius: 2 }}>
            {priorityLabel[priority] ?? 'M'}
          </span>
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', background: badge, color: '#000', padding: '1px 4px', borderRadius: 2 }}>
          {status}
        </span>
      </div>

      {/* Row 2: label */}
      <div style={{ padding: '2px 7px 0', overflow: 'hidden' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          {data.label}
        </span>
      </div>

      {/* Row 3: EARS sentence */}
      <div style={{ flex: 1, padding: '2px 7px 4px', overflow: 'hidden' }}>
        <span style={{ fontSize: 9, color: complete ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.5)', fontStyle: 'italic', lineHeight: '1.3', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {sentence}
        </span>
      </div>
    </div>
  )
})

RequirementNode.displayName = 'RequirementNode'

