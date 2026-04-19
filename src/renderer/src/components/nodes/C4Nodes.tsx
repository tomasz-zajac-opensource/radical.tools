import React, { memo, useCallback } from 'react'
import { NodeProps, Handle, Position } from 'reactflow'
import { C4NodeRFData, NODE_COLORS } from '../../types/c4'
import { useDiagramStore } from '../../store/diagramStore'

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
    <svg width="38" height="32" viewBox="0 0 38 32" fill="none" style={{ marginTop: 6, flexShrink: 0 }}>
      {/* Head */}
      <circle cx="19" cy="8" r="8" fill={color} stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" />
      {/* Body */}
      <path
        d="M5 32 C5 20, 33 20, 33 32"
        fill={color}
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export const PersonNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const bg = data.external ? ALT_COLOR : COLOR

  return (
    <div
      className="c4-node c4-person-node"
      style={{
        width: data.width,
        height: data.height,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <AllHandles />

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
      className="c4-node"
      style={{
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

      {/* Header bar */}
      <div className="c4-node-header" style={{ background: isExpanded ? 'transparent' : 'rgba(0,0,0,0.2)' }}>
        <span style={isExpanded ? { color: solidBg } : undefined}>{data.external ? 'External System' : 'Software System'}</span>
        {data.hasChildren && (
          <button className="c4-node-collapse-btn" onClick={onToggle} title={data.collapsed ? 'Expand' : 'Collapse'}>
            {data.collapsed ? '+' : '−'}
          </button>
        )}
      </div>

      <div className="c4-node-label" style={isExpanded ? { color: solidBg } : undefined}>{data.label}</div>
      {data.technology && (
        <div className="c4-node-tech" style={isExpanded ? { color: solidBg, opacity: 0.7 } : undefined}>[{data.technology}]</div>
      )}
      {data.description && (
        <div className="c4-node-desc" style={isExpanded ? { color: solidBg, opacity: 0.8 } : undefined}>{data.description}</div>
      )}

      {/* Children are rendered by React Flow as separate nodes */}
    </div>
  )
})

SystemNode.displayName = 'SystemNode'

// ─── Container Node ───────────────────────────────────────────────────────────

export const ContainerNode = memo(({ data, selected }: NodeProps<C4NodeRFData>) => {
  const toggleCollapse = useDiagramStore((s) => s.toggleCollapse)
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
      className="c4-node"
      style={{
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

      <div className="c4-node-header" style={{ background: isExpanded ? 'transparent' : 'rgba(0,0,0,0.18)' }}>
        <span style={isExpanded ? { color: solidBg } : undefined}>Container</span>
        {data.hasChildren && (
          <button className="c4-node-collapse-btn" onClick={onToggle} title={data.collapsed ? 'Expand' : 'Collapse'}>
            {data.collapsed ? '+' : '−'}
          </button>
        )}
      </div>

      <div className="c4-node-label" style={{ fontSize: 12, ...(isExpanded ? { color: solidBg } : {}) }}>{data.label}</div>
      {data.technology && (
        <div className="c4-node-tech" style={isExpanded ? { color: solidBg, opacity: 0.7 } : undefined}>[{data.technology}]</div>
      )}
      {data.description && (
        <div className="c4-node-desc" style={{ fontSize: 10, ...(isExpanded ? { color: solidBg, opacity: 0.8 } : {}) }}>{data.description}</div>
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
