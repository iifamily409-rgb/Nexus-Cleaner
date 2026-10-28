import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import App from './App'
import { AppProvider } from './hooks/useAppState'
import { ErrorBoundary } from './components/ErrorBoundary'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
