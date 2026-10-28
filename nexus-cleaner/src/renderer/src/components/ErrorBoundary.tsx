import React from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[renderer] unhandled error', error, info.componentStack)
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen items-center justify-center p-8">
          <div className="nx-panel max-w-xl p-8">
            <h1 className="mb-2 text-lg font-semibold text-red-300">Interface error</h1>
            <p className="mb-4 text-sm text-slate-400">
              The interface hit an unexpected error. No filesystem operation was started by this failure.
            </p>
            <pre className="nx-mono mb-4 max-h-48 overflow-auto rounded bg-black/40 p-3 text-xs text-red-200">
              {this.state.error.message}
            </pre>
            <button className="nx-btn nx-btn-primary" onClick={() => window.location.reload()}>
              Reload interface
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
