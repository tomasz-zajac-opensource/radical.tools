/**
 * Per-view collapse tests.
 *
 * Covers:
 *   - Collapsing a child node in a named view resizes the parent to fit
 *     only the view's visible children (not all model children).
 *   - Collapsing the parent node itself in a named view renders it at
 *     COLLAPSED_HEIGHT in rfNodes.
 *   - Collapsing a child node in a named view renders it at
 *     COLLAPSED_HEIGHT in rfNodes.
 *   - Collapse state is isolated per-view: toggling in one view does
 *     not affect the default (all-nodes) view.
 *   - A node that is model-collapsed (node.collapsed = true) can be
 *     expanded in a named view without affecting other views.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDiagramStore } from '../src/renderer/src/store/diagramStore'
import { COLLAPSED_HEIGHT, COLLAPSED_WIDTH, type C4Node, type DiagramView } from '../src/renderer/src/types/c4'

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

describe('view-collapse parent resize', () => {
  it('parent is resized to fit only the view children after collapsing a child', () => {
    const store = useDiagramStore.getState()
    // sys1 starts at full snap3 size (includes ctn1-ctn5)
    const sys1Before = store.c4Nodes['sys1']
    expect(sys1Before.height).toBeGreaterThan(400) // large — snap3 has h=500

    // Create a named view with only sys1, ctn1, ctn2 (not ctn3-ctn5)
    const vid = store.addView('Partial view')
    store.addNodeToView(vid, 'sys1')
    store.addNodeToView(vid, 'ctn1')
    store.addNodeToView(vid, 'ctn2')
    store.setActiveView(vid)

    // Collapse ctn1 (Frontend) inside this view
    useDiagramStore.getState().toggleCollapse('ctn1')

    const state = useDiagramStore.getState()

    // ctn1 must be tracked as view-collapsed
    expect(state.views[vid].collapsedNodeIds).toContain('ctn1')

    // sys1's stored height must be SMALLER than before — sized for only ctn1
    // (collapsed) + ctn2 (expanded), NOT for ctn3/ctn4/ctn5.
    // Before fix: height stays at ~500 (based on all 5 model children).
    // After fix:  height is roughly 290 (max(ctn1 collapsed, ctn2 expanded) + pad).
    const sys1After = state.c4Nodes['sys1']
    expect(sys1After.height).toBeLessThan(sys1Before.height - 50)

    // In rfNodes, ctn1 must render at the collapsed container height
    const rfCtn1 = state.rfNodes.find((n) => n.id === 'ctn1')
    expect(rfCtn1).toBeDefined()
    expect(rfCtn1!.style!.height).toBe(COLLAPSED_HEIGHT['container'])
    expect(rfCtn1!.data.height).toBe(COLLAPSED_HEIGHT['container'])

    // sys1 (parent) must render at its updated (smaller) height, NOT at
    // COLLAPSED_HEIGHT['system'] — sys1 itself is not collapsed.
    const rfSys1 = state.rfNodes.find((n) => n.id === 'sys1')
    expect(rfSys1).toBeDefined()
    expect(rfSys1!.style!.height).toBe(sys1After.height)
    expect(rfSys1!.style!.height).toBeLessThan(sys1Before.height - 50)
  })

  it('collapsing the parent node renders it at COLLAPSED_HEIGHT in rfNodes', () => {
    const store = useDiagramStore.getState()

    // Create a named view with only sys1 (no children)
    const vid = store.addView('System-only view')
    store.addNodeToView(vid, 'sys1')
    store.setActiveView(vid)

    // Collapse sys1 itself in this view
    useDiagramStore.getState().toggleCollapse('sys1')

    const state = useDiagramStore.getState()

    // sys1 must be in view.collapsedNodeIds
    expect(state.views[vid].collapsedNodeIds).toContain('sys1')

    // sys1's model-level collapsed flag must NOT be set (view-only collapse)
    expect(state.c4Nodes['sys1'].collapsed).toBe(false)

    // rfNode for sys1 must render at the per-type COLLAPSED dimensions
    const rfSys1 = state.rfNodes.find((n) => n.id === 'sys1')
    expect(rfSys1).toBeDefined()
    expect(rfSys1!.style!.height).toBe(COLLAPSED_HEIGHT['system'])
    expect(rfSys1!.style!.width).toBe(COLLAPSED_WIDTH['system'])
    expect(rfSys1!.data.height).toBe(COLLAPSED_HEIGHT['system'])
    expect(rfSys1!.data.width).toBe(COLLAPSED_WIDTH['system'])
  })

  it('collapse in named view does not affect the default (all-elements) view', () => {
    const store = useDiagramStore.getState()
    const sys1ModelHeight = store.c4Nodes['sys1'].height

    // Create a named view and collapse sys1 inside it
    const vid = store.addView('View 1')
    store.addNodeToView(vid, 'sys1')
    store.setActiveView(vid)
    useDiagramStore.getState().toggleCollapse('sys1')

    // Switch back to default (all-elements) view
    useDiagramStore.getState().setActiveView(null)

    const state = useDiagramStore.getState()

    // model-level collapsed flag must still be false
    expect(state.c4Nodes['sys1'].collapsed).toBe(false)

    // rfNode for sys1 in the default view must NOT be at collapsed height
    const rfSys1 = state.rfNodes.find((n) => n.id === 'sys1')
    expect(rfSys1).toBeDefined()
    expect(rfSys1!.style!.height).not.toBe(COLLAPSED_HEIGHT['system'])
    // It should be at the model height (or the full expanded container height)
    expect((rfSys1!.style!.height as number)).toBeGreaterThan(COLLAPSED_HEIGHT['system'])
  })
})

describe('view-expand override for model-collapsed nodes', () => {
  /**
   * Scenario: sys1 is collapsed at the model level (node.collapsed = true).
   * The user opens a named view and tries to expand sys1 in the right panel.
   * Before the fix: clicking ▶ had no effect — sys1 stayed collapsed.
   * After the fix: sys1 is added to view.expandedNodeIds and renders expanded.
   */
  it('can expand a model-collapsed parent in a named view', () => {
    // First, collapse sys1 at the model level (no view active)
    useDiagramStore.getState().setActiveView(null)
    useDiagramStore.getState().toggleCollapse('sys1')

    const afterModelCollapse = useDiagramStore.getState()
    expect(afterModelCollapse.c4Nodes['sys1'].collapsed).toBe(true)

    // Create a named view with sys1 in it
    const vid = afterModelCollapse.addView('Expanded view')
    afterModelCollapse.addNodeToView(vid, 'sys1')
    afterModelCollapse.setActiveView(vid)

    // In the named view, sys1 should appear collapsed initially
    const stateInView = useDiagramStore.getState()
    const rfSys1Before = stateInView.rfNodes.find((n) => n.id === 'sys1')
    expect(rfSys1Before!.style!.height).toBe(COLLAPSED_HEIGHT['system'])
    expect(rfSys1Before!.data.collapsed).toBe(true)

    // Expand sys1 in the named view (click ▶ in right panel tree)
    useDiagramStore.getState().toggleCollapse('sys1')

    const stateAfter = useDiagramStore.getState()

    // sys1 must be tracked in view.expandedNodeIds
    expect(stateAfter.views[vid].expandedNodeIds).toContain('sys1')

    // sys1 model-level flag must remain true (not changed)
    expect(stateAfter.c4Nodes['sys1'].collapsed).toBe(true)

    // rfNode for sys1 must now render EXPANDED (NOT at COLLAPSED_HEIGHT)
    const rfSys1After = stateAfter.rfNodes.find((n) => n.id === 'sys1')
    expect(rfSys1After).toBeDefined()
    expect(rfSys1After!.style!.height).not.toBe(COLLAPSED_HEIGHT['system'])
    expect(rfSys1After!.data.collapsed).toBe(false)
  })

  it('re-collapsing a view-expanded node removes it from expandedNodeIds', () => {
    // Model-collapse sys1
    useDiagramStore.getState().setActiveView(null)
    useDiagramStore.getState().toggleCollapse('sys1')
    expect(useDiagramStore.getState().c4Nodes['sys1'].collapsed).toBe(true)

    // Create view, expand sys1 inside it
    const store = useDiagramStore.getState()
    const vid = store.addView('View')
    store.addNodeToView(vid, 'sys1')
    store.setActiveView(vid)
    useDiagramStore.getState().toggleCollapse('sys1') // expand in view
    expect(useDiagramStore.getState().views[vid].expandedNodeIds).toContain('sys1')

    // Collapse it again in the same view
    useDiagramStore.getState().toggleCollapse('sys1')

    const stateAfter = useDiagramStore.getState()
    // Must be removed from expandedNodeIds
    expect(stateAfter.views[vid].expandedNodeIds ?? []).not.toContain('sys1')
    // Must be added to collapsedNodeIds (redundant but correct)
    expect(stateAfter.views[vid].collapsedNodeIds ?? []).toContain('sys1')
    // rfNode must render collapsed
    const rfSys1 = stateAfter.rfNodes.find((n) => n.id === 'sys1')
    expect(rfSys1!.style!.height).toBe(COLLAPSED_HEIGHT['system'])
  })

  it('view-expand does not affect the default view — default stays collapsed', () => {
    // Model-collapse sys1
    useDiagramStore.getState().setActiveView(null)
    useDiagramStore.getState().toggleCollapse('sys1')

    // Create view, expand sys1 inside it
    const store = useDiagramStore.getState()
    const vid = store.addView('View')
    store.addNodeToView(vid, 'sys1')
    store.setActiveView(vid)
    useDiagramStore.getState().toggleCollapse('sys1') // expand in view

    // Switch back to default view
    useDiagramStore.getState().setActiveView(null)

    const stateDefault = useDiagramStore.getState()
    // model flag still true
    expect(stateDefault.c4Nodes['sys1'].collapsed).toBe(true)
    // rfNode in default view renders collapsed
    const rfSys1 = stateDefault.rfNodes.find((n) => n.id === 'sys1')
    expect(rfSys1!.style!.height).toBe(COLLAPSED_HEIGHT['system'])
    expect(rfSys1!.data.collapsed).toBe(true)
  })
})
