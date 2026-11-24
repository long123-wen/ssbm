import { useState, useEffect } from 'react';
import AdminApp from '@/sections/admin/AdminApp';
import ClubApp from '@/sections/club/ClubApp';
import LandingPage from '@/sections/LandingPage';
import { Toaster } from '@/components/ui/sonner';

type AppMode = 'landing' | 'admin' | 'club';

// hash 可能带查询参数（赛事专属报名链接 #club?competition=xxx），只取路由部分判断
function modeFromHash(): AppMode {
  const route = (window.location.hash || '').split('?')[0];
  if (route === '#admin') return 'admin';
  if (route === '#club') return 'club';
  return 'landing';
}

export default function App() {
  const [mode, setMode] = useState<AppMode>('landing');

  useEffect(() => {
    // 根据 URL hash 自动路由（兼容带参数的专属报名链接）
    const next = modeFromHash();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next !== 'landing') setMode(next);
  }, []);

  const handleHashChange = () => {
    setMode(modeFromHash());
  };

  useEffect(() => {
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (mode === 'admin') return <><AdminApp /><Toaster /></>;
  if (mode === 'club') return <><ClubApp /><Toaster /></>;
  return <><LandingPage onAdminClick={() => { window.location.hash = 'admin'; setMode('admin'); }} onClubClick={() => { window.location.hash = 'club'; setMode('club'); }} /><Toaster /></>;
}
