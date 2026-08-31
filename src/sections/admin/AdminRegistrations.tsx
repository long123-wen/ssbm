import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, Eye, LockKeyhole, Search, Swords, Unlock, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { registrationStore, teamProfileStore } from '@/lib/store';
import type { Registration, TeamProfile } from '@/types';
import * as XLSX from 'xlsx';

export default function AdminRegistrations({ competitionId, eventFilter }: { competitionId: string; eventFilter?: string }) {
  const [list, setList] = useState<Registration[]>([]);
  const [search, setSearch] = useState('');
  const [eventNameFilter, setEventNameFilter] = useState('');
  const [detail, setDetail] = useState<Registration | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [teamMap, setTeamMap] = useState<Record<string, TeamProfile>>({});
  const [expandedClubs, setExpandedClubs] = useState<Set<string>>(new Set());
  const [showByClub, setShowByClub] = useState(true);
  const [unlockingKey, setUnlockingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const pageSize = 50;

  const loadRegistrations = () => {
    if (!competitionId) return;
    registrationStore.getAdminPage({ competitionId, page, pageSize }).then(result => {
      setList(result.items);
      setTotal(result.total);
    });
  };

  useEffect(loadRegistrations, [competitionId, page]);
  useEffect(() => {
    const timer = window.setInterval(loadRegistrations, 10_000);
    return () => window.clearInterval(timer);
  }, [competitionId, page]);
  useEffect(() => { setPage(1); }, [competitionId]);
  useEffect(() => {
    if (!competitionId) return;
    teamProfileStore.getByCompetition(competitionId).then(teams => {
      const map: Record<string, TeamProfile> = {};
      teams.forEach(team => { map[team.clubId] = team; });
      setTeamMap(map);
    });
  }, [competitionId]);
  useEffect(() => {
    if (eventFilter) setEventNameFilter(eventFilter);
  }, [eventFilter]);

  const filtered = useMemo(() => list.filter(reg => {
    if (eventNameFilter && reg.eventName !== eventNameFilter) return false;
    if (!search.trim()) return true;
    const keyword = search.trim();
    return reg.clubName.includes(keyword)
      || (teamMap[reg.clubId]?.teamName || '').includes(keyword)
      || reg.eventName.includes(keyword)
      || reg.groupName.includes(keyword)
      || reg.athletes.some(athlete => athlete.name.includes(keyword));
  }), [list, search, eventNameFilter, teamMap]);

  const clubGroups = useMemo(() => {
    const groups: Record<string, { clubId: string; clubName: string; regs: Registration[] }> = {};
    for (const reg of filtered) {
      const key = `${reg.clubId}:${reg.teamProfileId || ''}`;
      if (!groups[key]) groups[key] = { clubId: reg.clubId, clubName: reg.clubName, regs: [] };
      groups[key].regs.push(reg);
    }
    return Object.entries(groups).map(([key, group]) => ({ key, ...group })).sort((a, b) => a.clubName.localeCompare(b.clubName));
  }, [filtered]);

  const registeredTeams = new Set(list.map(reg => `${reg.clubId}:${reg.teamProfileId || ''}`)).size;
  const registeredAthleteTimes = list.reduce((sum, reg) => sum + reg.athletes.length, 0);

  const unlockClubRegistration = async (group: { key: string; clubId: string; regs: Registration[] }) => {
    const first = group.regs[0];
    if (!first) return;
    setUnlockingKey(group.key);
    setActionError('');
    try {
      await registrationStore.unlockForAdmin({
        competitionId,
        clubId: group.clubId,
        ...(first.teamProfileId ? { teamProfileId: first.teamProfileId } : {}),
      });
      await loadRegistrations();
    } catch (error: any) {
      setActionError(error?.message || '解除锁定失败，请稍后重试');
    } finally {
      setUnlockingKey(null);
    }
  };

  const toggleClub = (key: string) => {
    setExpandedClubs(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExport = () => {
    const rows: (string | number)[][] = [
      ['序号', '参赛单位', '队伍', '竞赛项目', '分组', '运动员', '报名时间'],
      ...filtered.map((reg, index) => [
        index + 1,
        reg.clubName,
        teamMap[reg.clubId]?.teamName || '-',
        reg.eventName,
        reg.groupName,
        reg.athletes.map(athlete => athlete.name).join('、'),
        new Date(reg.createdAt).toLocaleString(),
      ]),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{ wch: 7 }, { wch: 28 }, { wch: 20 }, { wch: 24 }, { wch: 18 }, { wch: 28 }, { wch: 22 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '报名项目清单');
    XLSX.writeFile(workbook, `报名项目清单_${new Date().toLocaleDateString()}.xlsx`);
  };

  const RegistrationRows = ({ registrations, includeTeam = false }: { registrations: Registration[]; includeTeam?: boolean }) => (
    <tbody className="divide-y divide-slate-100">
      {registrations.map(reg => (
        <tr key={reg.id} className="hover:bg-slate-50/70 transition-colors">
          {includeTeam && <td className="px-4 py-3 font-medium text-slate-800">{teamMap[reg.clubId]?.teamName || reg.clubName}</td>}
          <td className="px-4 py-3 text-slate-700">{reg.eventName}</td>
          <td className="px-4 py-3 text-slate-600">{reg.groupName}</td>
          <td className="px-4 py-3 text-slate-600">{reg.athletes.map(athlete => athlete.name).join('、')}</td>
          <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{new Date(reg.createdAt).toLocaleDateString()}</td>
          <td className="px-4 py-3 text-right">
            <button onClick={() => setDetail(reg)} className="inline-flex p-1 text-slate-400 hover:text-blue-600 transition-colors" title="查看报名详情">
              <Eye className="w-4 h-4" />
            </button>
          </td>
        </tr>
      ))}
    </tbody>
  );

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-800">报名项目清单</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-0.5">查看、筛选并导出各参赛单位已提交的报名项目</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 text-slate-600 self-start sm:self-auto">
          <Download className="w-3.5 h-3.5" />导出 Excel
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        {[
          { label: '报名队伍', value: registeredTeams, icon: Users, cls: 'text-blue-700 bg-blue-50 border-blue-100' },
          { label: '报名项目', value: total, icon: Swords, cls: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
          { label: '运动员人次', value: registeredAthleteTimes, icon: Users, cls: 'text-violet-700 bg-violet-50 border-violet-100' },
        ].map(item => {
          const Icon = item.icon;
          return <div key={item.label} className={`rounded-xl border px-4 py-3 flex items-center gap-3 ${item.cls}`}>
            <div className="w-8 h-8 rounded-lg bg-white/70 flex items-center justify-center"><Icon className="w-4 h-4" /></div>
            <div><div className="text-xs opacity-75">{item.label}</div><div className="font-semibold text-lg leading-tight">{item.value}</div></div>
          </div>;
        })}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
        <div className="relative sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input className="pl-9 w-full bg-white rounded-xl" placeholder="搜索参赛单位、队伍、项目或运动员..." value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        <div className="flex bg-slate-100 rounded-xl p-0.5 self-start">
          <button onClick={() => setShowByClub(true)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${showByClub ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>按队伍查看</button>
          <button onClick={() => setShowByClub(false)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!showByClub ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>全部列表</button>
        </div>
      </div>

      {eventNameFilter && (
        <div className="mb-3 flex items-center gap-2">
          <Badge className="bg-blue-50 text-blue-700 border-blue-200 gap-1.5 py-1 px-2.5">
            <span>项目：{eventNameFilter}</span>
            <button onClick={() => setEventNameFilter('')} className="ml-1 text-blue-400 hover:text-blue-600">×</button>
          </Badge>
          <span className="text-xs text-slate-400">来自项目数据总览的筛选</span>
        </div>
      )}

      {actionError && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>}

      {showByClub ? (
        <div className="space-y-3">
          {!clubGroups.length ? <div className="text-center py-12 text-slate-400 bg-white rounded-xl">暂无报名项目</div> : clubGroups.map(group => {
            const expanded = expandedClubs.has(group.key);
            const team = teamMap[group.clubId];
            return <div key={group.key} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="w-full flex items-stretch">
                <button onClick={() => toggleClub(group.key)} className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/70 transition-colors">
                  <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">{group.clubName}</span>
                      {team && <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><Swords className="w-3 h-3" />{team.teamName}</span>}
                      {group.regs.some(reg => reg.editUnlocked) ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">允许修改中</span> : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">已提交</span>}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">{team?.slogan ? <span className="mr-2">{team.slogan}</span> : null}共 {group.regs.length} 个报名项目 · {group.regs.reduce((sum, reg) => sum + reg.athletes.length, 0)} 人次</div>
                  </div>
                </button>
                <div className="flex items-center border-l border-slate-100 px-3 sm:px-4">
                  {group.regs.some(reg => reg.editUnlocked) ? <span className="inline-flex items-center gap-1.5 text-xs text-amber-700"><Unlock className="w-3.5 h-3.5" />已解锁</span> : <Button size="sm" variant="outline" onClick={() => unlockClubRegistration(group)} disabled={unlockingKey === group.key} className="h-8 gap-1.5 text-xs text-amber-700 border-amber-200 hover:bg-amber-50"><LockKeyhole className="w-3.5 h-3.5" />{unlockingKey === group.key ? '解锁中...' : '取消报名界面锁定'}</Button>}
                </div>
              </div>
              {expanded && <div className="border-t border-slate-100 overflow-x-auto"><table className="w-full text-sm min-w-[620px]"><thead className="bg-slate-50/50"><tr>{['竞赛项目', '分组', '运动员', '报名时间', '详情'].map(header => <th key={header} className={`px-4 py-2 text-slate-500 font-medium text-xs whitespace-nowrap ${header === '详情' ? 'text-right' : 'text-left'}`}>{header}</th>)}</tr></thead><RegistrationRows registrations={group.regs} /></table></div>}
            </div>;
          })}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]"><thead className="bg-slate-50 border-b border-slate-200"><tr>{['队伍', '竞赛项目', '分组', '运动员', '报名时间', '详情'].map(header => <th key={header} className={`px-4 py-3 text-slate-600 font-medium whitespace-nowrap ${header === '详情' ? 'text-right' : 'text-left'}`}>{header}</th>)}</tr></thead><RegistrationRows registrations={filtered} includeTeam /></table>
          {!filtered.length && <div className="text-center py-12 text-slate-400">暂无符合条件的报名项目</div>}
        </div>
      )}

      <div className="mt-3 text-xs text-slate-400 px-1">当前页显示 {filtered.length} 条，共 {total} 个报名项目</div>

      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>报名项目详情</DialogTitle></DialogHeader>
          {detail && <div className="space-y-4 py-2 text-sm">
            {teamMap[detail.clubId] && <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 p-3 flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center"><Swords className="w-5 h-5 text-amber-500" /></div><div><div className="font-bold text-slate-800">{teamMap[detail.clubId].teamName}</div><div className="text-xs text-slate-500">{detail.clubName}</div></div></div>}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">{[['竞赛项目', detail.eventName], ['报名分组', detail.groupName], ['报名时间', new Date(detail.createdAt).toLocaleString()], ['提交状态', '已提交']].map(([label, value]) => <div key={label}><div className="text-xs text-slate-500">{label}</div><div className="font-medium text-slate-800 mt-0.5">{value}</div></div>)}</div>
            <div className="border border-slate-200 rounded-xl overflow-hidden"><div className="bg-slate-50 px-4 py-2.5 font-semibold text-slate-700">参赛运动员（{detail.athletes.length}人）</div><div className="divide-y divide-slate-100">{detail.athletes.map(athlete => <div key={athlete.athleteId} className="px-4 py-3 text-slate-700">{athlete.name}</div>)}</div></div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
