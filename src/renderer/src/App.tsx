import React, { useEffect, useState, useCallback } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { Toolbar } from './components/Toolbar'
import { Canvas } from './components/Canvas'
import { TreemapView } from './components/TreemapView'
import { SequenceView } from './components/SequenceView'
import { PresentationBar, PresenterDock } from './components/PresentationBar'
import { RightPanel, LeftPanel } from './components/RightPanel'
import { MetamodelEditor } from './components/MetamodelEditor'
import { NotificationHost } from './components/NotificationHost'
import { SelectionActionBar } from './components/SelectionActionBar'
import { EdgeActionBar } from './components/EdgeActionBar'
import { QuickSearch } from './components/QuickSearch'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useDiagramStore } from './store/diagramStore'

const LS_LEFT = 'radical-leftpanel-collapsed'
const LS_RIGHT = 'radical-rightpanel-collapsed'

function AppInner(): React.ReactElement {
  const runRadicalLayout = useDiagramStore((s) => s.runRadicalLayout)
  const appMode = useDiagramStore((s) => s.appMode)
  const presentationActive = useDiagramStore((s) => s.presentationActive)
  const activeViewKind = useDiagramStore((s) =>
    s.activeViewId ? (s.views[s.activeViewId]?.kind ?? 'static') : 'static'
  )
  const isTreemapView  = activeViewKind === 'treemap'
  const isSequenceView = activeViewKind === 'dynamic'
  const isCanvasView   = !isTreemapView && !isSequenceView

  const isPresenting = presentationActive
  const isDesigner = appMode === 'designer'
  const isViewer = appMode === 'viewer'
  const isMetamodel = appMode === 'metamodel'
  const isReadOnlyMode = !isDesigner && !isMetamodel

  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => localStorage.getItem(LS_LEFT) === '1')
  const [rightCollapsed, setRightCollapsed] = useState<boolean>(() => localStorage.getItem(LS_RIGHT) === '1')
  const [showWelcome, setShowWelcome] = useState(() => !(window as unknown as { electronAPI?: unknown }).electronAPI)
  const toggleLeft = useCallback(() => {
    setLeftCollapsed((c) => { localStorage.setItem(LS_LEFT, c ? '0' : '1'); return !c })
  }, [])
  const toggleRight = useCallback(() => {
    setRightCollapsed((c) => { localStorage.setItem(LS_RIGHT, c ? '0' : '1'); return !c })
  }, [])

  // Expose a way for global features (e.g. Quick Search) to force the right
  // panel open so the freshly-selected node's properties slide into view
  // instead of being hidden behind a collapsed panel.
  useEffect(() => {
    ;(window as unknown as { __radicalExpandRightPanel?: () => void }).__radicalExpandRightPanel = () => {
      setRightCollapsed((c) => {
        if (!c) return c
        localStorage.setItem(LS_RIGHT, '0')
        return false
      })
    }
    return () => {
      delete (window as unknown as { __radicalExpandRightPanel?: () => void }).__radicalExpandRightPanel
    }
  }, [])

  // Run Radical layout automatically on first load — but only when nodes have
  // no saved positions yet (all at origin). Skip if positions were loaded from file.
  useEffect(() => {
    const timer = setTimeout(() => {
      const nodes = Object.values(useDiagramStore.getState().c4Nodes)
      const hasPositions = nodes.some(n => (n.x ?? 0) !== 0 || (n.y ?? 0) !== 0)
      if (!hasPositions) runRadicalLayout()
    }, 400)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const layoutClass = [
    'app-layout',
    isPresenting ? 'mode-presenting' : '',
    !isPresenting && isReadOnlyMode ? 'mode-presentation' : '',
    !isPresenting && leftCollapsed ? 'lp-collapsed' : '',
    !isPresenting && rightCollapsed ? 'rp-collapsed' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={layoutClass}>
      {!isPresenting && <Toolbar />}
      {!isPresenting && isDesigner && <LeftPanel mode="designer" collapsed={leftCollapsed} onToggleCollapsed={toggleLeft} />}
      {!isPresenting && isViewer && <LeftPanel mode="viewer" collapsed={leftCollapsed} onToggleCollapsed={toggleLeft} />}
      {isTreemapView ? <TreemapView /> : isSequenceView ? <SequenceView /> : <Canvas />}
      {!isPresenting && isDesigner && <RightPanel collapsed={rightCollapsed} onToggleCollapsed={toggleRight} />}
      {!isPresenting && !isDesigner && <RightPanel readOnly collapsed={rightCollapsed} onToggleCollapsed={toggleRight} />}
      {!isPresenting && isViewer && <PresenterDock />}
      <PresentationBar />
      {!isPresenting && isCanvasView && <SelectionActionBar />}
      {!isPresenting && isCanvasView && <EdgeActionBar />}
      {isCanvasView && <QuickSearch />}
      <NotificationHost />
      {isMetamodel && !isPresenting && <MetamodelEditor />}
      {showWelcome && <WelcomeScreen onDismiss={() => setShowWelcome(false)} />}
    </div>
  )
}

export default function App(): React.ReactElement {
  return (
    <ReactFlowProvider>
      <AppInner />
    </ReactFlowProvider>
  )
}
