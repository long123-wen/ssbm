import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import ClubApp from './sections/club/ClubApp'
import { Toaster } from './components/ui/sonner'
import ErrorBoundary from './components/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ClubApp />
    </ErrorBoundary>
    <Toaster />
  </StrictMode>,
)
