import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import { COLLAPSED_HEIGHT, COLLAPSED_WIDTH, NODE_SIZES, type C4Node, type DiagramView } from '../src/renderer/src/types/c4'

const initial = (() => {
  const s = useDiagramStore.getState()
  return {
    c4Nodes: JSON.parse(JSON.stringify(s.c4Nodes)) as Record<string, C4Node>,
    views: JSON.parse(JSON.stringify(s.views)) as Record<string, DiagramView>,
    activeViewId: s.activeViewId,
    defaultPositions: JSON.parse(JSON.stringify(s.defaultPositions)),
  }
})()

beforeEach(() => {
  useDiagramStore.setState({
    c4Nodes: JSON.parse(JSON.stringify(initial.c4Nodes)),
    views: JSON.parse(JSON.stringify(initial.views)),
    activeViewId: initial.activeViewId,
    defaultPositions: JSON.parse(JSON.stringify(initial.defaultPositions)),
    appMode: 'designer',
  } as any)
  useDiagramStore.getState()._sync()
})

describe('group collapse in view', () => {
  it('group inside domain - debug', () => {
    const store = useDiagramStore.getState()

    const domainId = store.addNode({
      type: 'domain', label: 'My Domain', description: '',
      x: 100, y: 100, ...NODE_SIZES.domain, collapsed: false,
    })
    const groupId = store.addNode({
      type: 'group', label: 'Test Group', description: '',
      x: 40, y: 120, ...NODE_SIZES.group, collapsed: false, parentId: domainId,
    })
    const sysId = store.addNode({
      type: 'system', label: 'Child System', description: '',
      x: 40, y: 120, ...NODE_SIZES.system, collapsed: false, parentId: groupId,
    })
    useDiagramStore.getState()._sync()

    const vid = useDiagramStore.getState().addView('Domain view')
    useDiagramStore.getState().addNodeToView(vid, domainId)
    useDiagramStore.getState().addNodeToView(vid, groupId)
    useDiagramStore.getState().addNodeToView(vid, sysId)
    useDiagramStore.getState().setActiveView(vid)

    // Check initial state
    const initialState = useDiagramStore.getState()
    const rfDomainBefore = initialState.rfNodes.find(n => n.id === domainId)
    const rfGroupBefore = initialState.rfNodes.find(n => n.id === groupId)
    console.log('BEFORE - domain style:', JSON.stringify(rfDomainBefore?.style))
    console.log('BEFORE - group style:', JSON.stringify(rfGroupBefore?.style))
    console.log('BEFORE - rfNodes count:', initialState.rfNodes.filter(n => [domainId,groupId,sysId].includes(n.id)).length)
    console.log('BEFORE - rfNodes ids:', initialState.rfNodes.filter(n => [domainId,groupId,sysId].includes(n.id)).map(n=>n.id.substring(0,8)))

    // Collapse the group
    useDiagramStore.getState().toggleCollapse(groupId)

    const state = useDiagramStore.getState()
    const rfDomainAfter = state.rfNodes.find(n => n.id === domainId)
    const rfGroupAfter = state.rfNodes.find(n => n.id === groupId)
    const rfSysAfter = state.rfNodes.find(n => n.id === sysId)
    console.log('AFTER - domain style:', JSON.stringify(rfDomainAfter?.style))
    console.log('AFTER - group style:', JSON.stringify(rfGroupAfter?.style))
    console.log('AFTER - sys style/hidden:', rfSysAfter?.hidden)
    console.log('AFTER - rfNodes count (our 3):', state.rfNodes.filter(n => [domainId,groupId,sysId].includes(n.id)).length)
    console.log('AFTER - rfNodes ids (our 3):', state.rfNodes.filter(n => [domainId,groupId,sysId].includes(n.id)).map(n=>n.id.substring(0,8)))
    console.log('AFTER - model group.collapsed:', state.c4Nodes[groupId]?.collapsed)
    console.log('AFTER - view.collapsedNodeIds:', state.views[vid]?.collapsedNodeIds?.map(n=>n.substring(0,8)))
    console.log('AFTER - view.nodeIds count:', state.views[vid]?.nodeIds?.length)

    // Check if the domain node collapsed the group inside it
    console.log('AFTER - domain.collapsed (model):', state.c4Nodes[domainId]?.collapsed)
    console.log('AFTER - domain.width/height:', state.c4Nodes[domainId]?.width, state.c4Nodes[domainId]?.height)
  })
})
