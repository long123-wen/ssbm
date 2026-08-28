import { useState } from 'react';
import { Trophy, LayoutDashboard, Layers, Users, FileText, Shield, LogOut, Menu, RefreshCw, UsersRound, BookOpen, SlidersHorizontal, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import ThemeToggle from '@/components/ThemeToggle';
import { adminAuth } from '@/lib/store';
import AdminOverview from './AdminOverview';
import AdminEvents from './AdminEvents';
import AdminRegistrations from './AdminRegistrations';
import AdminOrderBook from './AdminOrderBook';
import AdminAccounts from './AdminAccounts';
import AdminPersonnel from './AdminPersonnel';
import AdminLimits from './AdminLimits';
import AdminScorecards from './AdminScorecards';
import type { Competition } from '@/types';

type AdminPage = 'overview' | 'events' | 'registrations' | 'orderbook' | 'scorecards' | 'accounts' | 'personnel' | 'limits';

interface Props {
  activeComp: Competition;
  onChangeComp: () => void;
  onLogout: () => void;
}

const navItems = [
  { id: 'overview' as AdminPage, label: '数据总览', icon: LayoutDashboard },
  { id: 'events' as AdminPage, label: '项目 & 分组', icon: Layers },
  { id: 'registrations' as AdminPage, label: '在线报名清单', icon: Users },
  { id: 'personnel' as AdminPage, label: '注册账号及队伍管理', icon: UsersRound },
  { id: 'limits' as AdminPage, label: '限报配置', icon: SlidersHorizontal },
  { id: 'orderbook' as AdminPage, label: '出场顺序', icon: FileText },
  { id: 'scorecards' as AdminPage, label: '计分表数据', icon: ClipboardCheck },
  { id: 'accounts' as AdminPage, label: '管理员账号', icon: Shield },
];

export default function AdminDashboard({ activeComp, onChangeComp, onLogout }: Props) {
  const [page, setPage] = useState<AdminPage>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [eventFilter, setEventFilter] = useState<string>('');

  const currentAdmin = adminAuth.getCurrentUser();
  const currentName = currentAdmin?.displayName || '系统管理员';

  const currentNav = navItems.find(n => n.id === page);

  return (
    <div className="flex h-screen bg-muted/50 overflow-hidden">
      {/* Sidebar — Premium Dark Panel */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300
        lg:static lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="px-5 pt-5 pb-4 border-b border-sidebar-border/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0 shadow-glow">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm leading-tight truncate">{activeComp.name}</div>
              <div className="text-[11px] text-sidebar-foreground/50 mt-0.5 truncate">管理后台</div>
            </div>
          </div>
          <button
            onClick={onChangeComp}
            className="mt-4 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-200 border border-sidebar-border/40"
          >
            <RefreshCw className="w-3 h-3" />切换赛事
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setPage(item.id); setSidebarOpen(false); setEventFilter(''); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-sidebar-primary/15 text-sidebar-primary shadow-sm'
                    : 'text-sidebar-foreground/55 hover:text-sidebar-foreground hover:bg-sidebar-accent/40'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-sidebar-primary' : 'opacity-60'}`} />
                {item.label}
                {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-primary" />}
              </button>
            );
          })}
        </nav>

        {/* 使用说明 */}
        <div className="px-3 pb-2">
          <a
            href="/用户使用说明.html"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 transition-all duration-200"
          >
            <BookOpen className="w-4 h-4 shrink-0 opacity-60" />
            使用说明
          </a>
        </div>

        {/* Logout */}
        <div className="p-3 border-t border-sidebar-border/50">
          <div className="px-3 py-2.5 mb-1.5 rounded-lg bg-sidebar-accent/30">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-sidebar-accent flex items-center justify-center text-xs font-bold text-sidebar-foreground/80 shrink-0">
                {currentName[0]}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{currentName}</div>
                <div className="text-[11px] text-sidebar-foreground/40">管理员</div>
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-all duration-200"
          >
            <LogOut className="w-4 h-4" />
            退出登录
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar — Glass Morphism */}
        <header className="h-14 bg-card/70 backdrop-blur-xl border-b border-border/50 flex items-center px-4 lg:px-6 gap-3 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-muted transition-colors duration-200">
            <Menu className="w-5 h-5 text-muted-foreground" />
          </button>
          <div className="flex items-center gap-2.5">
            {currentNav && (
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <currentNav.icon className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
            <h1 className="font-semibold text-foreground text-sm">{currentNav?.label}</h1>
          </div>
          <ThemeToggle />
          <Badge variant="outline" className="ml-auto text-[11px] border-primary/20 bg-primary/5 text-primary font-medium">
            {activeComp.name}
          </Badge>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          {page === 'overview' && (
            <AdminOverview
              competitionId={activeComp.id}
              onNavigate={(p, evName) => {
                if (evName) setEventFilter(evName);
                setPage(p as AdminPage);
              }}
            />
          )}
          {page === 'events' && <AdminEvents competitionId={activeComp.id} />}
          {page === 'registrations' && <AdminRegistrations competitionId={activeComp.id} eventFilter={eventFilter} />}
          {page === 'personnel' && <AdminPersonnel competitionId={activeComp.id} />}
          {page === 'limits' && <AdminLimits competitionId={activeComp.id} />}
          {page === 'orderbook' && <AdminOrderBook competitionId={activeComp.id} />}
          {page === 'scorecards' && <AdminScorecards competitionId={activeComp.id} />}
          {page === 'accounts' && <AdminAccounts />}
        </main>
      </div>
    </div>
  );
}
