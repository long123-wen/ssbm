import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import AdminApp from './sections/admin/AdminApp'
import { Toaster } from './components/ui/sonner'
import ErrorBoundary from './components/ErrorBoundary'

// 门户标识：管理端所有请求带 X-RJ-Portal=admin，
// 用于与俱乐部端会话共存时判定应该解析哪一套凭据（详见 functions/_shared/auth.ts）
;(window as unknown as { __RJ_PORTAL__?: string }).__RJ_PORTAL__ = 'admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AdminApp />
    </ErrorBoundary>
    <Toaster />
  </StrictMode>,
)
