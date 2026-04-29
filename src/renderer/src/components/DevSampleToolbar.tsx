/**
 * DEV-ONLY panel for editing the built-in sample model.
 *
 * Workflow:
 *   1. Click "Load sample (raw)" — opens the sample instantly (no layout wait)
 *      as a new editable LS document.
 *   2. Make changes in the diagram (move nodes, add labels, tweak structure …).
 *   3. Click "Save → sample source" — serialises the current diagram state and
 *      writes it to `src/renderer/src/store/fintechSampleData.json` inside the
 *      project.  Vite HMR picks up the change immediately.
 *      Next time someone clicks "Open sample model" on the WelcomeScreen the
 *      saved data is used directly (no layout computation needed).
 *
 * The toolbar is mounted only when `import.meta.env.DEV === true`.
 */

import React, { useState } from 'react'
import { documents } from '../store/documentStore'
import { buildFintechSampleRaw, loadFintechSample } from '../store/fintechSample'
import { useDiagramStore } from '../store/diagramStore'

interface Props {
  onSampleLoaded?: () => void
}

export function DevSampleToolbar({ onSampleLoaded }: Props): React.ReactElement {
  const saveDiagram = useDiagramStore((s) => s.saveDiagram)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)

  function handleLoad(): void {
    loadFintechSample().then((raw) => {
      const meta = documents.createLSDocument('[DEV] FinCore Sample', raw)
      documents.setActiveId(meta.id)
      onSampleLoaded?.()
    })
  }

  async function handleSave(): Promise<void> {
    if (!window.electronAPI?.devSaveSample) {
      alert('devSaveSample IPC not available — are you running in Electron dev mode?')
      return
    }
    setSaving(true)
    try {
      const data = saveDiagram()
      const json = JSON.stringify(data, null, 2)
      const res = await window.electronAPI.devSaveSample(json)
      if (res.success) {
        setLastSaved(new Date().toLocaleTimeString())
      } else {
        alert(`Save failed: ${res.error ?? 'unknown error'}`)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleReset(): Promise<void> {
    if (!window.electronAPI?.devSaveSample) return
    if (!confirm('Reset fintechSampleData.json to empty ({})? Next "Open sample model" will use hardcoded positions.')) return
    await window.electronAPI.devSaveSample('{}')
    setLastSaved(null)
  }

  return (
    <div className="dev-sample-toolbar">
      <span className="dev-sample-toolbar__label">DEV · sample</span>
      <button className="dev-sample-toolbar__btn" onClick={handleLoad} title="Load sample (raw, no layout) as a new editable document">
        Load raw
      </button>
      <button className="dev-sample-toolbar__btn dev-sample-toolbar__btn--save" onClick={handleSave} disabled={saving} title="Serialise current diagram and write to fintechSampleData.json">
        {saving ? 'Saving…' : 'Save → source'}
      </button>
      <button className="dev-sample-toolbar__btn dev-sample-toolbar__btn--reset" onClick={handleReset} title="Clear fintechSampleData.json (revert to auto-layout)">
        Reset
      </button>
      {lastSaved && <span className="dev-sample-toolbar__saved">saved {lastSaved}</span>}
    </div>
  )
}
