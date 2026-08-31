import { useState, useEffect, useMemo } from 'react';
import { Users, Trophy, ClipboardList, TrendingUp, Building2, MapPin, Calendar, CheckCircle2, Clock, BarChart3, Lock, Unlock, User, GraduationCap, UserCheck, Shield, Swords } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  competitionStore, registrationStore,
  eventStore, athleteStore, coachStore, leaderStore, clubStore,
  teamProfileStore,
} from '@/lib/store';
import type { TeamProfile } from '@/types';

interface OverviewStats {
  openCompetition: any;
  totalRegistrations: number;
  confirmedRegistrations: number;
  pendingRegistrations: number;
  rejectedRegistrations: number;
  totalClubs: number;
  totalAthletes: number;
  totalEvents: number;
  totalTeams: number;
  byEvent: { name: string; count: number }[];
  byClub: { name: string; clubId: string; count: number; confirmed: number; teamName?: string; teamSlogan?: string }[];
}

const defaultStats: OverviewStats = {
  openCompetition: null,
  totalRegistrations: 0,
  confirmedRegistrations: 0,
  pendingRegistrations: 0,
  rejectedRegistrations: 0,
  totalClubs: 0,
  totalAthletes: 0,
  totalEvents: 0,
  totalTeams: 0,
  byEvent: [],
  byClub: [],
};

interface Props {
  competitionId: string;
  onNavigate?: (page: string, eventName?: string) => void;
}

export default function AdminOverview({ competitionId, onNavigate }: Props) {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<OverviewStats>(defaultStats);
  const [togglingStatus, setTogglingStatus] = useState(false);

  // 参赛单位详情弹窗
  const [clubDetailOpen, setClubDetailOpen] = useState(false);
  const [clubDetailName, setClubDetailName] = useState('');
  const [clubDetailClubId, setClubDetailClubId] = useState('');
  const [clubDetailRegs, setClubDetailRegs] = useState<any[]>([]);
  const [clubDetailAthletes, setClubDetailAthletes] = useState<any[]>([]);
  const [clubDetailCoaches, setClubDetailCoaches] = useState<any[]>([]);
  const [clubDetailLeaders, setClubDetailLeaders] = useState<any[]>([]);
  const [clubDetailTeams, setClubDetailTeams] = useState<TeamProfile[]>([]);
  const [clubDetailLoading, setClubDetailLoading] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([
      competitionStore.getById(competitionId),
      registrationStore.getByCompetition(competitionId),
      eventStore.getByCompetition(competitionId),
      athleteStore.getByCompetition(competitionId),
      teamProfileStore.getByCompetition(competitionId),
      clubStore.getAll(),
    ]).then(([comp, compRegs, events, compAthletes, teams, allClubs]) => {
      // 构建 clubId → clubName 映射（用于仅有队伍无报名的俱乐部）
      const clubNameById: Record<string, string> = {};
      allClubs.forEach(c => { clubNameById[c.id] = c.clubName; });
      // 构建 clubId → team 映射
      const teamByClub: Record<string, TeamProfile> = {};
      teams.forEach(t => { teamByClub[t.clubId] = t; });

      const byEventMap: Record<string, number> = {};
      compRegs.forEach(r => {
        byEventMap[r.eventName] = (byEventMap[r.eventName] || 0) + 1;
      });

      const byClubMap: Record<string, { name: string; clubId: string; count: number; confirmed: number; teamName?: string; teamSlogan?: string }> = {};
      const regClubIds = new Set<string>();
      const regAthleteIds = new Set<string>();
      compRegs.forEach(r => {
        if (!byClubMap[r.clubId]) {
          const team = teamByClub[r.clubId];
          byClubMap[r.clubId] = { name: r.clubName, clubId: r.clubId, count: 0, confirmed: 0, teamName: team?.teamName, teamSlogan: team?.slogan };
        }
        byClubMap[r.clubId].count++;
        if (r.status === 'confirmed') byClubMap[r.clubId].confirmed++;
        regClubIds.add(r.clubId);
        r.athletes.forEach(a => regAthleteIds.add(a.athleteId));
      });

      // 把只有队伍资料（无报名记录）的俱乐部也纳入统计
      teams.forEach(t => {
        regClubIds.add(t.clubId);
        if (!byClubMap[t.clubId]) {
          const clubName = clubNameById[t.clubId] || t.teamName;
          byClubMap[t.clubId] = { name: clubName, clubId: t.clubId, count: 0, confirmed: 0, teamName: t.teamName, teamSlogan: t.slogan };
        }
      });

      // 俱乐部数 = 有报名或有队伍的并集
      const totalClubs = regClubIds.size;
      // 运动员数：取直接按赛事创建和报名的并集
      const totalAthletes = new Set([
        ...regAthleteIds,
        ...compAthletes.map(a => a.id),
      ]).size;

      setStats({
        openCompetition: comp,
        totalRegistrations: compRegs.length,
        confirmedRegistrations: compRegs.filter(r => r.status === 'confirmed').length,
        pendingRegistrations: compRegs.filter(r => r.status === 'pending').length,
        rejectedRegistrations: compRegs.filter(r => r.status === 'rejected').length,
        totalClubs,
        totalAthletes,
        totalEvents: events.length,
        totalTeams: teams.length,
        byEvent: Object.entries(byEventMap)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
        byClub: Object.values(byClubMap)
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(load, [competitionId]);

  const openClubDetail = async (clubName: string, clubId?: string) => {
    setClubDetailName(clubName);
    setClubDetailClubId(clubId || '');
    setClubDetailOpen(true);
    setClubDetailLoading(true);
    setClubDetailTeams([]);
    try {
      // 并行加载报名、人员、队伍数据
      const promises: Promise<any>[] = [
        registrationStore.getByCompetition(competitionId),
        athleteStore.getByCompetition(competitionId),
        coachStore.getByCompetition(competitionId),
        leaderStore.getByCompetition(competitionId),
      ];
      if (clubId) {
        promises.push(teamProfileStore.getByCompetitionAndClub(competitionId, clubId));
      }

      const results = await Promise.all(promises);
      const regs = results[0] as any[];
      const compAthletes = results[1] as any[];
      const compCoaches = results[2] as any[];
      const compLeaders = results[3] as any[];
      const teams = clubId ? (results[4] as TeamProfile[]) : [];

      const clubRegs = regs.filter((r: any) => r.clubName === clubName);
      setClubDetailRegs(clubRegs);
      setClubDetailAthletes(compAthletes.filter((a: any) => a.clubName === clubName));
      setClubDetailCoaches(compCoaches.filter((c: any) => c.clubName === clubName));
      setClubDetailLeaders(compLeaders.filter((l: any) => l.clubName === clubName));
      setClubDetailTeams(teams);
    } catch {
      toast.error('加载参赛单位详情失败');
    } finally {
      setClubDetailLoading(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!stats.openCompetition || togglingStatus) return;
    const current = stats.openCompetition.status;
    const next = current === 'open' ? 'closed' : 'open';
    const nextLabel = next === 'open' ? '开放' : '截止';
    setTogglingStatus(true);
    try {
      await competitionStore.update(competitionId, { status: next });
      toast.success(`报名已${nextLabel}`);
      load();
    } catch (err: any) {
      toast.error('操作失败：' + (err?.message || '请重试'));
    } finally {
      setTogglingStatus(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <div className="text-slate-400">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <OverviewHeader
        competition={stats.openCompetition}
        togglingStatus={togglingStatus}
        onToggleStatus={handleToggleStatus}
      />

      <OverviewStatCards stats={stats} onNavigate={onNavigate} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OverviewReviewPanel stats={stats} />
        <OverviewEventDistribution
          byEvent={stats.byEvent}
          onNavigate={onNavigate}
        />
      </div>

      <OverviewClubRanking byClub={stats.byClub} onOpenDetail={openClubDetail} />

      <OverviewQuickGuide onNavigate={onNavigate} />

      <ClubDetailDialog
        open={clubDetailOpen}
        onOpenChange={setClubDetailOpen}
        clubName={clubDetailName}
        regs={clubDetailRegs}
        athletes={clubDetailAthletes}
        coaches={clubDetailCoaches}
        leaders={clubDetailLeaders}
        teams={clubDetailTeams}
        loading={clubDetailLoading}
      />
    </div>
  );
}

// ============================================================================
// 子组件（按职责拆分；同文件内联以保留 AdminPersonnel 风格的内聚性）
// ============================================================================

/**
 * 顶部赛事横幅 + 状态切换按钮
 */
interface OverviewHeaderProps {
  competition: any;
  togglingStatus: boolean;
  onToggleStatus: () => void;
}

function OverviewHeader({ competition, togglingStatus, onToggleStatus }: OverviewHeaderProps) {
  if (!competition) return null;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800 via-slate-900 to-blue-950 p-6 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-blue-500/10 via-transparent to-transparent" />
      <div className="relative flex items-center gap-5">
        <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur flex items-center justify-center shrink-0 ring-1 ring-white/20">
          <Trophy className="w-7 h-7 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-blue-300/80 uppercase tracking-wider mb-1">当前管理赛事</div>
          <div className="font-bold text-xl truncate">{competition.name}</div>
          <div className="text-slate-400 text-sm mt-1.5 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            {competition.venue}
            <span className="text-slate-600 mx-1">·</span>
            <Calendar className="w-3.5 h-3.5" />
            {competition.startDate} ~ {competition.endDate}
          </div>
        </div>
        <button
          onClick={onToggleStatus}
          disabled={togglingStatus}
          className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 cursor-pointer ${
            competition.status === 'open'
              ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30 border-emerald-400/30 hover:bg-emerald-500/30'
              : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/30 border-amber-400/30 hover:bg-amber-500/30'
          } ${togglingStatus ? 'opacity-50 cursor-wait' : ''}`}
          title={competition.status === 'open' ? '点击截止报名' : '点击开放报名'}
        >
          {togglingStatus ? (
            <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : competition.status === 'open' ? (
            <Unlock className="w-3.5 h-3.5" />
          ) : (
            <Lock className="w-3.5 h-3.5" />
          )}
          {competition.status === 'open' ? '报名开放中' :
           competition.status === 'closed' ? '报名已截止' :
           competition.status === 'completed' ? '赛事已结束' :
           competition.status === 'draft' ? '草稿' : competition.status}
        </button>
      </div>
    </div>
  );
}

/**
 * 顶部 4 张统计卡片
 */
interface OverviewStatCardsProps {
  stats: OverviewStats;
  onNavigate?: (page: string) => void;
}

function OverviewStatCards({ stats, onNavigate }: OverviewStatCardsProps) {
  const cards = useMemo(() => [
    {
      label: '参赛队伍', value: stats.totalClubs, unit: '支',
      icon: <Building2 className="w-5 h-5" />,
      bgClass: 'bg-blue-50', textClass: 'text-blue-600',
      change: `队伍 ${stats.totalTeams} 支 · 运动员 ${stats.totalAthletes} 人`,
      navigateTo: 'personnel' as const,
    },
    {
      label: '报名总数', value: stats.totalRegistrations, unit: '条',
      icon: <ClipboardList className="w-5 h-5" />,
      bgClass: 'bg-cyan-50', textClass: 'text-cyan-600',
      change: `已确认 ${stats.confirmedRegistrations} 条`,
      navigateTo: 'registrations' as const,
    },
    {
      label: '待审核', value: stats.pendingRegistrations, unit: '条',
      icon: <Clock className="w-5 h-5" />,
      bgClass: stats.pendingRegistrations > 0 ? 'bg-amber-50' : 'bg-emerald-50',
      textClass: stats.pendingRegistrations > 0 ? 'text-amber-600' : 'text-emerald-600',
      change: stats.pendingRegistrations > 0 ? '需要处理' : '全部已处理',
      navigateTo: 'registrations' as const,
    },
    {
      label: '竞赛项目', value: stats.totalEvents, unit: '项',
      icon: <Trophy className="w-5 h-5" />,
      bgClass: 'bg-violet-50', textClass: 'text-violet-600',
      change: '当前赛事',
      navigateTo: 'events' as const,
    },
  ], [stats.totalClubs, stats.totalTeams, stats.totalAthletes, stats.totalRegistrations, stats.confirmedRegistrations, stats.pendingRegistrations, stats.totalEvents]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((s, i) => (
        <Card
          key={i}
          className="relative overflow-hidden bg-white border border-slate-200/60 shadow-sm hover:shadow-md hover:border-slate-300 hover:-translate-y-0.5 cursor-pointer transition-all duration-200"
          onClick={() => onNavigate?.(s.navigateTo)}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.bgClass} ${s.textClass} ring-1 ring-black/5`}>
                {s.icon}
              </div>
            </div>
            <div className="text-[28px] font-bold text-slate-800 tracking-tight leading-none">
              {s.value}
              <span className="text-sm font-normal text-slate-400 ml-1">{s.unit}</span>
            </div>
            <div className="text-sm text-slate-500 mt-1.5 font-medium">{s.label}</div>
            <div className={`text-xs mt-2.5 flex items-center gap-1 ${s.textClass}`}>
              <div className="w-1 h-1 rounded-full bg-current opacity-50" />
              {s.change}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * 审核进度面板（已处理/待审/已确认/已拒绝 + 确认率）
 */
interface OverviewReviewPanelProps {
  stats: OverviewStats;
}

function OverviewReviewPanel({ stats }: OverviewReviewPanelProps) {
  const { reviewPct, confirmPct } = useMemo(() => {
    const total = stats.totalRegistrations;
    return {
      reviewPct: total > 0
        ? Math.round(((stats.confirmedRegistrations + stats.rejectedRegistrations) / total) * 100)
        : 0,
      confirmPct: total > 0
        ? Math.round((stats.confirmedRegistrations / total) * 100)
        : 0,
    };
  }, [stats.totalRegistrations, stats.confirmedRegistrations, stats.rejectedRegistrations]);

  if (stats.totalRegistrations === 0) return null;

  return (
    <Card className="bg-white border border-slate-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-blue-500" />审核进度
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-slate-600 font-medium">已处理</span>
            <span className="text-slate-700 font-bold">{reviewPct}%</span>
          </div>
          <div className="bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div className="h-2.5 rounded-full bg-blue-500 transition-all duration-700" style={{ width: `${reviewPct}%` }} />
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {stats.confirmedRegistrations + stats.rejectedRegistrations} / {stats.totalRegistrations} 条已处理
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: '待审核', count: stats.pendingRegistrations, cls: 'bg-amber-50 text-amber-700 border-amber-100' },
            { label: '已确认', count: stats.confirmedRegistrations, cls: 'bg-green-50 text-green-700 border-green-100' },
            { label: '已拒绝', count: stats.rejectedRegistrations, cls: 'bg-red-50 text-red-600 border-red-100' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl border p-3 text-center ${s.cls}`}>
              <div className="text-xl font-bold">{s.count}</div>
              <div className="text-xs mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-slate-600">确认率</span>
            <span className="text-emerald-600 font-bold">{confirmPct}%</span>
          </div>
          <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
            <div className="h-2 rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${confirmPct}%` }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 各项目报名分布（条形图）
 */
interface OverviewEventDistributionProps {
  byEvent: { name: string; count: number }[];
  onNavigate?: (page: string, eventName?: string) => void;
}

function OverviewEventDistribution({ byEvent, onNavigate }: OverviewEventDistributionProps) {
  if (byEvent.length === 0) return null;
  const max = byEvent[0]?.count || 1;
  const colors = ['bg-blue-500', 'bg-cyan-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500'];

  return (
    <Card className="bg-white border border-slate-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-500" />各项目报名分布
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3.5">
          {byEvent.map((item, i) => {
            const pct = Math.round((item.count / max) * 100);
            const color = colors[i % colors.length];
            return (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <button
                    className="text-sm text-slate-700 font-medium truncate max-w-[60%] hover:text-blue-600 hover:underline cursor-pointer text-left"
                    onClick={() => onNavigate?.('registrations', item.name)}
                    title="点击查看该项目报名"
                  >
                    {item.name}
                  </button>
                  <span className="text-sm font-bold text-slate-600 tabular-nums">{item.count} <span className="text-xs text-slate-400 font-normal">条</span></span>
                </div>
                <div className="bg-slate-100 rounded-full h-2.5 overflow-hidden">
                  <div className={`h-2.5 rounded-full transition-all duration-700 ease-out ${color}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 队伍报名排行（前 8）
 */
interface OverviewClubRankingProps {
  byClub: OverviewStats['byClub'];
  onOpenDetail: (clubName: string, clubId: string) => void;
}

function OverviewClubRanking({ byClub, onOpenDetail }: OverviewClubRankingProps) {
  if (byClub.length === 0) return null;
  const max = byClub[0]?.count || 1;
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <Card className="bg-white border border-slate-200/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-500" />队伍报名排行
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {byClub.map((item, i) => {
            const pct = Math.round((item.count / max) * 100);
            const confirmRate = item.count > 0 ? Math.round((item.confirmed / item.count) * 100) : 0;
            return (
              <div key={i} className="flex items-center gap-3">
                <div className="w-7 text-center text-sm">
                  {i < 3 ? medals[i] : <span className="text-slate-400 text-xs font-medium">{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="min-w-0">
                      <button
                        className="text-sm font-medium text-slate-700 truncate hover:text-blue-600 hover:underline cursor-pointer text-left block max-w-full"
                        onClick={() => onOpenDetail(item.name, item.clubId)}
                        title="点击查看详情"
                      >
                        {item.name}
                      </button>
                      {item.teamName && (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Swords className="w-3 h-3 text-amber-500 shrink-0" />
                          <span className="text-xs text-amber-600 font-medium truncate">{item.teamName}</span>
                          {item.teamSlogan && (
                            <span className="text-xs text-slate-400 truncate hidden sm:inline">— {item.teamSlogan}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-xs text-slate-400">{confirmRate}% 已确认</span>
                      <span className="text-sm font-bold text-slate-700">{item.count}</span>
                    </div>
                  </div>
                  <div className="bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div className="h-1.5 rounded-full bg-blue-400 transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 快速操作指引（首次进入引导）
 */
interface OverviewQuickGuideProps {
  onNavigate?: (page: string) => void;
}

function OverviewQuickGuide({ onNavigate }: OverviewQuickGuideProps) {
  const steps = [
    { text: '在「选择赛事」页创建新赛事', nav: null },
    { text: '在「项目 & 分组」中添加竞赛项目与分组', nav: 'events' },
    { text: '在「限报配置」中设置各分组限报数量', nav: 'limits' },
    { text: '在「报名审核」中确认各参赛单位报名', nav: 'registrations' },
    { text: '在「出场顺序」中生成并导出出场顺序表', nav: 'orderbook' },
  ];

  return (
    <Card className="border border-slate-200/60 shadow-sm bg-gradient-to-br from-slate-50 to-white">
      <CardContent className="p-6">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <div className="font-semibold text-slate-700">快速操作指引</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 text-sm text-slate-500">
          {steps.map((step, i) => (
            <div
              key={i}
              onClick={() => step.nav && onNavigate?.(step.nav)}
              className={`flex items-start gap-2.5 ${step.nav ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''}`}
            >
              <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
              {step.text}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 参赛单位详情弹窗（队伍资料 + 人员统计 + 报名项目 + 人员名单）
 *
 * 数据由父组件异步加载并以 props 传入——本组件为纯渲染，
 * 不持有任何 useState（除 onOpenChange）。
 */
interface ClubDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubName: string;
  regs: any[];
  athletes: any[];
  coaches: any[];
  leaders: any[];
  teams: TeamProfile[];
  loading: boolean;
}

function ClubDetailDialog({
  open, onOpenChange, clubName, regs, athletes, coaches, leaders, teams, loading,
}: ClubDetailDialogProps) {
  // 报名项目按 eventName 聚合
  const eventDistribution = useMemo(() => {
    const map: Record<string, { count: number; confirmed: number; groupSet: Set<string> }> = {};
    regs.forEach(r => {
      if (!map[r.eventName]) map[r.eventName] = { count: 0, confirmed: 0, groupSet: new Set() };
      map[r.eventName].count++;
      if (r.status === 'confirmed') map[r.eventName].confirmed++;
      map[r.eventName].groupSet.add(r.groupName);
    });
    return map;
  }, [regs]);

  // 人员统计卡片数据
  const peopleStats = useMemo(() => [
    { label: '运动员', count: athletes.length, icon: <User className="w-4 h-4" />, color: 'blue' },
    { label: '教练员', count: coaches.length, icon: <GraduationCap className="w-4 h-4" />, color: 'emerald' },
    { label: '领队', count: leaders.length, icon: <UserCheck className="w-4 h-4" />, color: 'violet' },
  ], [athletes.length, coaches.length, leaders.length]);

  const bgMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600" />
            {clubName}
            <Badge className="ml-2 bg-blue-100 text-blue-700 border-0">{regs.length} 条报名</Badge>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">加载中...</div>
        ) : (
          <div className="space-y-5">
            {teams.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">参赛队伍 ({teams.length})</div>
                {teams.map(team => (
                  <div key={team.id} className="rounded-xl border border-amber-200/60 bg-gradient-to-br from-amber-50 to-orange-50 p-3">
                    <div className="flex items-center gap-3">
                      {team.logoUrl ? (
                        <img src={team.logoUrl} alt={team.teamName} className="w-10 h-10 rounded-xl object-cover ring-2 ring-amber-200 shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 ring-2 ring-amber-200">
                          <Shield className="w-5 h-5 text-amber-500" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Swords className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="font-bold text-slate-800 text-sm truncate">{team.teamName}</span>
                        </div>
                        {team.slogan && (
                          <div className="text-xs text-slate-500 mt-0.5 truncate">{team.slogan}</div>
                        )}
                        <div className="text-xs text-slate-400 mt-0.5">
                          创建于 {new Date(team.createdAt).toLocaleDateString('zh-CN')}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
              {peopleStats.map(s => (
                <div key={s.label} className="rounded-xl border border-slate-100 p-3 text-center">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center mx-auto mb-1.5 ${bgMap[s.color]}`}>
                    {s.icon}
                  </div>
                  <div className="text-xl font-bold text-slate-800">{s.count}</div>
                  <div className="text-xs text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>

            {regs.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2.5">报名项目</div>
                <div className="space-y-2">
                  {Object.entries(eventDistribution).map(([evName, data]) => (
                    <div key={evName} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50">
                      <div>
                        <div className="text-sm font-medium text-slate-700">{evName}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {Array.from(data.groupSet).join('、')} · {data.confirmed}/{data.count} 已确认
                        </div>
                      </div>
                      <Badge className={`text-xs border-0 ${data.confirmed === data.count ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                        {data.confirmed === data.count ? '全部确认' : '待审核'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {athletes.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2.5">运动员名单</div>
                <div className="flex flex-wrap gap-1.5">
                  {athletes.map(a => (
                    <Badge key={a.id} className={`text-xs border-0 ${a.gender === 'male' ? 'bg-blue-50 text-blue-600' : 'bg-pink-50 text-pink-600'}`}>
                      {a.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {(coaches.length > 0 || leaders.length > 0) && (
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2.5">工作人员</div>
                <div className="space-y-1.5">
                  {coaches.map(c => (
                    <div key={c.id} className="flex items-center gap-2 text-sm text-slate-600">
                      <GraduationCap className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{c.name}</span>
                      <span className="text-xs text-slate-400">{c.phone}</span>
                    </div>
                  ))}
                  {leaders.map(l => (
                    <div key={l.id} className="flex items-center gap-2 text-sm text-slate-600">
                      <UserCheck className="w-3.5 h-3.5 text-violet-500" />
                      <span>{l.name}</span>
                      <span className="text-xs text-slate-400">{l.phone}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
