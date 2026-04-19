import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 40,
            color: '#ff6b6b',
            background: '#1e1e2e',
            height: '100vh',
            fontFamily: 'monospace',
            fontSize: 14,
          }}
        >
          <h2 style={{ marginBottom: 16 }}>Runtime Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#ffb3b3' }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#888', marginTop: 16 }}>
            {this.state.error.stack}
          </pre>
          <button
            style={{
              marginTop: 24,
              padding: '8px 16px',
              background: '#5c9bff',
              color: '#000',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
