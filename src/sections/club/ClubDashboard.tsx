import { useState } from 'react';
import {
  Trophy, Users, ClipboardList, FileDown, LogOut, Menu, X,
  RefreshCw, Shield, Plus, MoreHorizontal, Pencil, ChevronDown, ClipboardCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import ThemeToggle from '@/components/ThemeToggle';
import ClubTeamManage from './ClubTeamManage';
import ClubRegForm from './ClubRegForm';
import ClubMyRegistrations from './ClubMyRegistrations';
import ClubScorecards from './ClubScorecards';
import type { ClubAccount, TeamProfile } from '@/types';

type ClubPage = 'team' | 'register' | 'myregs' | 'scorecards';

interface Props {
  club: ClubAccount;
  competitionId: string;
  competitionName: string;
  teamProfiles: TeamProfile[];
  selectedTeamId: string;
  onSelectTeam: (id: string) => void;
  onAddTeam: () => void;
  onEditTeam: (profile: TeamProfile) => void;
  onSwitchCompetition: () => void;
  onLogout: () => void;
}

const navItems: { id: ClubPage; label: string; icon: typeof Users; desc: string }[] = [
  { id: 'team', label: '团队管理', icon: Users, desc: '领队/教练/运动员' },
  { id: 'register', label: '在线报名', icon: ClipboardList, desc: '选择项目与分组' },
  { id: 'myregs', label: '我的报名', icon: FileDown, desc: '查看与导出报名' },
  { id: 'scorecards', label: '计分表', icon: ClipboardCheck, desc: '查询并生成计分表' },
];

export default function ClubDashboard({
  club, competitionId, competitionName, teamProfiles, selectedTeamId,
  onSelectTeam, onAddTeam, onEditTeam, onSwitchCompetition, onLogout
}: Props) {
  const [page, setPage] = useState<ClubPage>('team');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  const currentNav = navItems.find(n => n.id === page);
  const selectedTeam = teamProfiles.find(t => t.id === selectedTeamId);

  const handleTeamAction = (action: ClubPage, teamId: string) => {
    onSelectTeam(teamId);
    setPage(action);
  };

  return (
    <div className="flex h-screen bg-muted/50 overflow-hidden">
      {/* ========== 桌面端侧边栏 (lg+) ========== */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border/50 flex flex-col transition-transform duration-300
        lg:static lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Logo */}
        <div className="px-5 pt-5 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0 shadow-glow">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm text-foreground leading-tight">自助报名系统</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{club.clubName}</div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Team cards + Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {/* Team profile cards */}
          <div className="mb-3 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">参赛队伍</span>
              <button
                onClick={onAddTeam}
                className="flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 hover:bg-primary/5 rounded-md px-1.5 py-0.5 transition-colors"
              >
                <Plus className="w-3 h-3" />增加队伍
              </button>
            </div>

            {teamProfiles.map(profile => {
              const isSelected = profile.id === selectedTeamId;
              const isExpanded = expandedTeamId === profile.id;
              return (
                <div key={profile.id}>
                  {/* Team card */}
                  <div
                    className={`group relative rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-primary/5 border-primary/25 shadow-soft'
                        : 'bg-card border-border/60 hover:border-border hover:shadow-xs'
                    } ${isExpanded ? 'rounded-b-lg' : ''}`}
                  >
                    {/* Main click area */}
                    <div
                      className="px-3 py-2.5"
                      onClick={() => {
                        onSelectTeam(profile.id);
                        setExpandedTeamId(isExpanded ? null : profile.id);
                      }}
                    >
                      <div className="flex items-center gap-2.5 mb-1">
                        {profile.logoUrl ? (
                          <img src={profile.logoUrl} alt="队徽" className="w-8 h-8 rounded-lg object-cover border border-primary/20" />
                        ) : (
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            isSelected ? 'bg-primary/10' : 'bg-muted'
                          }`}>
                            <Shield className={`w-4 h-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-semibold truncate ${isSelected ? 'text-foreground' : 'text-foreground/80'}`}>
                            {profile.teamName}
                          </div>
                          {profile.slogan && (
                            <div className={`text-[11px] truncate italic ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}>
                              「{profile.slogan}」
                            </div>
                          )}
                        </div>
                        <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform duration-250 ${
                          isExpanded ? 'rotate-180 text-primary' : 'text-muted-foreground/40 group-hover:text-muted-foreground/70'
                        }`} />
                      </div>
                    </div>

                    {/* Edit button */}
                    <div className="absolute top-2 right-6">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className={`p-1 rounded-md transition-all opacity-0 group-hover:opacity-100 ${
                              isSelected
                                ? 'text-primary hover:bg-primary/10'
                                : 'text-muted-foreground hover:bg-muted'
                            }`}
                            onClick={e => e.stopPropagation()}
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem onClick={() => onEditTeam(profile)}>
                            <Pencil className="w-3.5 h-3.5 mr-2" />编辑资料
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Expandable sub-menu */}
                  <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    isExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'
                  }`}>
                    <div className={`mx-1 rounded-b-xl border border-t-0 bg-card/80 backdrop-blur-sm divide-y divide-border/30 ${
                      isSelected ? 'border-primary/15' : 'border-border/40'
                    }`}>
                      {navItems.map(item => {
                        const Icon = item.icon;
                        const active = page === item.id && isSelected;
                        return (
                          <button
                            key={item.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTeamAction(item.id, profile.id);
                            }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                              active
                                ? 'bg-primary/5 text-primary font-medium'
                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                            }`}
                          >
                            <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground/60'}`} />
                            <span>{item.label}</span>
                            {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            {teamProfiles.length === 0 && (
              <div className="px-3 py-3 text-center">
                <p className="text-xs text-muted-foreground mb-2">暂无队伍</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAddTeam}
                  className="w-full text-xs gap-1"
                >
                  <Plus className="w-3 h-3" />创建队伍
                </Button>
              </div>
            )}
          </div>

          <div className="border-t border-border/30 my-2" />
        </nav>

        {/* User info & logout */}
        <div className="p-3 border-t border-border/40">
          <div className="px-3 py-2.5 mb-1.5 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {club.contactName[0]}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">{club.contactName}</div>
                <div className="text-[11px] text-muted-foreground truncate">{club.phone}</div>
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-red-500 hover:bg-red-500/5 transition-all"
          >
            <LogOut className="w-4 h-4" />退出登录
          </button>
        </div>
      </aside>

      {/* 遮罩 */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ========== 主内容区 ========== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶部 Header — Glass Morphism */}
        <header className="h-14 bg-card/70 backdrop-blur-xl border-b border-border/50 flex items-center px-4 lg:px-6 gap-3 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 min-w-0">
            {currentNav && (
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <currentNav.icon className="w-3.5 h-3.5 text-primary" />
              </div>
            )}
            <h1 className="font-semibold text-foreground text-sm truncate">{currentNav?.label}</h1>
            {selectedTeam && (
              <Badge variant="outline" className="text-[11px] font-medium bg-primary/5 text-primary border-primary/20 max-w-[150px]">
                <Shield className="w-3 h-3 mr-1 shrink-0" />
                <span className="truncate">{selectedTeam.teamName}</span>
              </Badge>
            )}
          </div>

          <div className="flex-1" />

          {/* Competition badge + switch */}
          <div className="hidden sm:flex items-center gap-2">
            <Badge variant="secondary" className="text-[11px] font-medium bg-primary/5 text-primary border-primary/15 max-w-[200px]">
              <Trophy className="w-3 h-3 mr-1 shrink-0" />
              <span className="truncate">{competitionName || competitionId}</span>
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onSwitchCompetition}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/5 transition-colors"
                  title="切换赛事"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>切换赛事</TooltipContent>
            </Tooltip>
          </div>

          <ThemeToggle />
          <Badge variant="outline" className="text-[11px] text-muted-foreground border-border/60 bg-card font-medium hidden sm:inline-flex">
            {club.clubName}
          </Badge>

          <button
            onClick={onLogout}
            className="lg:hidden ml-auto p-2 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/5 transition-colors"
            title="退出登录"
          >
            <LogOut className="w-4.5 h-4.5" />
          </button>
        </header>

        {/* 页面内容 — 手机端底部预留导航栏高度 */}
        <main className="flex-1 overflow-auto pb-16 lg:pb-0">
          {page === 'team' && <ClubTeamManage clubId={club.id} competitionId={competitionId} teamProfileId={selectedTeamId} />}
          {page === 'register' && <ClubRegForm club={club} competitionId={competitionId} teamProfileId={selectedTeamId} />}
          {page === 'myregs' && <ClubMyRegistrations club={club} competitionId={competitionId} teamProfileId={selectedTeamId} />}
          {page === 'scorecards' && <ClubScorecards competitionId={competitionId} teamProfiles={teamProfiles} selectedTeamId={selectedTeamId} />}
        </main>
      </div>

      {/* ========== 手机端底部导航栏 ========== */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card/80 backdrop-blur-xl border-t border-border/50 flex">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className={`w-6 h-6 flex items-center justify-center rounded-lg transition-all ${
                active ? 'bg-primary/10' : ''
              }`}>
                <Icon className={`w-4.5 h-4.5 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <span className={`font-medium ${active ? 'text-primary' : ''}`}>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
