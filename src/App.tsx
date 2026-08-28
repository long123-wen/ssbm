import { useState, useEffect } from 'react';
import AdminApp from '@/sections/admin/AdminApp';
import ClubApp from '@/sections/club/ClubApp';
import LandingPage from '@/sections/LandingPage';
import { Toaster } from '@/components/ui/sonner';

type AppMode = 'landing' | 'admin' | 'club';

export default function App() {
  const [mode, setMode] = useState<AppMode>('landing');

  useEffect(() => {
    // 根据 URL hash 自动路由
    const hash = window.location.hash;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hash === '#admin') setMode('admin');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else if (hash === '#club') setMode('club');
  }, []);

  const handleHashChange = () => {
    const hash = window.location.hash;
    if (hash === '#admin') setMode('admin');
    else if (hash === '#club') setMode('club');
    else setMode('landing');
  };

  useEffect(() => {
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (mode === 'admin') return <><AdminApp /><Toaster /></>;
  if (mode === 'club') return <><ClubApp /><Toaster /></>;
  return <><LandingPage onAdminClick={() => { window.location.hash = 'admin'; setMode('admin'); }} onClubClick={() => { window.location.hash = 'club'; setMode('club'); }} /><Toaster /></>;
}
