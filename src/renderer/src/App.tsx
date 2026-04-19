import React, { useEffect, useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { Toolbar } from './components/Toolbar'
import { ViewBar } from './components/ViewBar'
import { Sidebar } from './components/Sidebar'
import { Canvas } from './components/Canvas'
import { PropertiesPanel } from './components/PropertiesPanel'
import { useDiagramStore } from './store/diagramStore'

function AppInner(): React.ReactElement {
  const runRadicalLayout = useDiagramStore((s) => s.runRadicalLayout)
  const selectedNodeId = useDiagramStore((s) => s.selectedNodeId)
  const selectedEdgeId = useDiagramStore((s) => s.selectedEdgeId)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [propsOpen, setPropsOpen] = useState(false)

  // Auto-open props panel when something is selected, auto-close when deselected
  useEffect(() => {
    setPropsOpen(!!(selectedNodeId || selectedEdgeId))
  }, [selectedNodeId, selectedEdgeId])

  // Run Radical layout automatically on first load
  useEffect(() => {
    const timer = setTimeout(() => {
      runRadicalLayout()
    }, 400)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const layoutClass = [
    'app-layout',
    sidebarOpen ? '' : 'sidebar-collapsed',
    propsOpen ? '' : 'props-collapsed',
  ].filter(Boolean).join(' ')

  return (
    <div className={layoutClass}>
      <Toolbar />
      <ViewBar />
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((v) => !v)} />
      <Canvas />
      <PropertiesPanel open={propsOpen} onToggle={() => setPropsOpen((v) => !v)} />
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
