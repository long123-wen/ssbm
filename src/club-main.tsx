import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import ClubApp from './sections/club/ClubApp'
import { Toaster } from './components/ui/sonner'
import ErrorBoundary from './components/ErrorBoundary'

// 门户标识：俱乐部端所有请求带 X-RJ-Portal=club
;(window as unknown as { __RJ_PORTAL__?: string }).__RJ_PORTAL__ = 'club';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ClubApp />
    </ErrorBoundary>
    <Toaster />
  </StrictMode>,
)
