import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/hooks/useAuth';
import AdminLogin from './AdminLogin';
import AdminPasswordReset from './AdminPasswordReset';
import AdminDashboard from './AdminDashboard';
import CompetitionSelector from './CompetitionSelector';
import type { Competition } from '@/types';
import { Loader2 } from 'lucide-react';

export default function AdminApp() {
  const { isAdmin, currentUser, loading, login, logout, refresh } = useAdminAuth();
  const [activeComp, setActiveComp] = useState<Competition | null>(null);

  // 恢复上次选择的赛事（可选）
  useEffect(() => {
    if (isAdmin) {
      try {
        const saved = localStorage.getItem('rj_admin_active_comp');
        if (saved) setActiveComp(JSON.parse(saved));
      } catch { /* ignore */ }
    }
  }, [isAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" aria-label="正在验证管理员会话" />
      </div>
    );
  }

  if (!isAdmin) {
    return <AdminLogin onLogin={login} />;
  }

  // 强制改密：被标记 reset_required 的账号只能进入改密页
  if (currentUser?.mustResetPassword) {
    return (
      <AdminPasswordReset
        onComplete={() => { void refresh(); }}
        onLogout={() => { logout(); }}
      />
    );
  }

  if (!activeComp) {
    return (
      <CompetitionSelector
        onSelect={(comp) => {
          setActiveComp(comp);
          localStorage.setItem('rj_admin_active_comp', JSON.stringify(comp));
        }}
        onLogout={() => { logout(); }}
      />
    );
  }

  return (
    <AdminDashboard
      activeComp={activeComp}
      onChangeComp={() => {
        setActiveComp(null);
        localStorage.removeItem('rj_admin_active_comp');
      }}
      onLogout={() => {
        logout();
        setActiveComp(null);
        localStorage.removeItem('rj_admin_active_comp');
      }}
    />
  );
}
