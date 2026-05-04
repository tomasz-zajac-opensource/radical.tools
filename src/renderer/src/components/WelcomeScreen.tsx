import React from 'react'
import { documents } from '../store/documentStore'
import { buildFintechSampleRaw } from '../store/fintechSample'

interface Props {
  onDismiss: () => void
}

export function WelcomeScreen({ onDismiss }: Props): React.ReactElement {
  const existingDocs = documents.listDocuments()
  const hasExisting  = existingDocs.length > 0

  function handleNew(): void {
    documents.createLSDocument('Untitled model', { nodes: [], relations: [] })
    onDismiss()
  }

  function handleOpen(id: string): void {
    documents.setActiveId(id)
    onDismiss()
  }

  function handleImport(): void {
    documents.importFromFile().then((meta) => {
      if (meta) onDismiss()
    })
  }

  function handleSample(): void {
    const data = buildFintechSampleRaw()
    const meta = documents.createLSDocument('Fintech Banking Platform', data)
    documents.setActiveId(meta.id)
    onDismiss()
  }

  return (
    <div className="welcome-overlay">
      <div className="welcome-card">

        {/* ── Left column ── */}
        <div className="welcome-left">
          <div className="welcome-wordmark">
            <svg className="welcome-wordmark-icon" width="28" height="28" viewBox="0 0 28 28" fill="none">
                <circle cx="14" cy="14" r="4.5" fill="#3b6fe6"/>
                <circle cx="14" cy="14" r="12" stroke="#3b6fe6" strokeWidth="1.5" fill="none" strokeDasharray="3 2"/>
                <circle cx="14" cy="2"  r="2" fill="#3b6fe6" opacity="0.45"/>
                <circle cx="14" cy="26" r="2" fill="#3b6fe6" opacity="0.45"/>
                <circle cx="2"  cy="14" r="2" fill="#3b6fe6" opacity="0.45"/>
                <circle cx="26" cy="14" r="2" fill="#3b6fe6" opacity="0.45"/>
            </svg>
            <span className="welcome-wordmark-text">radical<em>.model</em></span>
          </div>

          <h1 className="welcome-heading">
            {hasExisting ? <>Your recent<br/>models</> : <>Architecture<br/>modelling</>}
          </h1>
          <p className="welcome-lead">
            {hasExisting
              ? 'Continue where you stopped, or start something new.'
              : 'C4-based visual modelling for software architecture teams.'}
          </p>

          <div className="welcome-cta-group">
            <button className="welcome-btn welcome-btn-primary" onClick={handleNew}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              New model
            </button>
            <button className="welcome-btn welcome-btn-ghost" onClick={handleImport}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1.5" y="1.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <polyline points="7,4 10,7 7,10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Open file…
            </button>
            <button className="welcome-btn welcome-btn-sample" onClick={handleSample}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="4" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                <line x1="6" y1="6.5" x2="8" y2="3.5" stroke="currentColor" strokeWidth="1.2"/>
                <line x1="6" y1="6.5" x2="8" y2="10.5" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
              Open sample model
            </button>
          </div>
        </div>

        {/* ── Right column ── */}
        <div className="welcome-right">
          {hasExisting ? (
            <>
              <p className="welcome-right-label">Recent</p>
              <div className="welcome-recent">
                {existingDocs.slice(0, 6).map((doc) => (
                  <button
                    key={doc.id}
                    className="welcome-recent-item"
                    onClick={() => handleOpen(doc.id)}
                  >
                    <span className="welcome-recent-icon">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <rect x="1.5" y="0.5" width="9" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                        <line x1="4" y1="4.5" x2="8" y2="4.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                        <line x1="4" y1="7"   x2="8" y2="7"   stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                        <line x1="4" y1="9.5" x2="6" y2="9.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                      </svg>
                    </span>
                    <span className="welcome-recent-name">{doc.name}</span>
                    <span className="welcome-recent-date">
                      {new Date(doc.lastModified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="welcome-preview">
              <svg width="100%" viewBox="0 0 260 180" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="10"  y="20"  width="100" height="60" rx="6" fill="rgba(59,111,230,0.07)" stroke="rgba(59,111,230,0.3)" strokeWidth="1"/>
                <text x="60"  y="53"  textAnchor="middle" fill="rgba(59,111,230,0.6)" fontSize="9" fontFamily="system-ui">System A</text>
                <rect x="150" y="20"  width="100" height="60" rx="6" fill="rgba(59,111,230,0.07)" stroke="rgba(59,111,230,0.3)" strokeWidth="1"/>
                <text x="200" y="53"  textAnchor="middle" fill="rgba(59,111,230,0.6)" fontSize="9" fontFamily="system-ui">System B</text>
                <rect x="80"  y="115" width="100" height="50" rx="6" fill="rgba(59,111,230,0.07)" stroke="rgba(59,111,230,0.3)" strokeWidth="1"/>
                <text x="130" y="143" textAnchor="middle" fill="rgba(59,111,230,0.6)" fontSize="9" fontFamily="system-ui">Database</text>
                <line x1="110" y1="50" x2="150" y2="50" stroke="rgba(59,111,230,0.35)" strokeWidth="1" markerEnd="url(#arr)"/>
                <line x1="60"  y1="80" x2="100" y2="115" stroke="rgba(59,111,230,0.35)" strokeWidth="1"/>
                <line x1="200" y1="80" x2="165" y2="115" stroke="rgba(59,111,230,0.35)" strokeWidth="1"/>
                <defs>
                  <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="rgba(59,111,230,0.5)"/>
                  </marker>
                </defs>
              </svg>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
