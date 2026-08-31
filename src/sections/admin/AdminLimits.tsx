import { useState, useEffect, useMemo } from 'react';
import { Save, RotateCcw, AlertTriangle, Shield, Users, Flag, Layers, Loader2, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { limitConfigStore, teamProfileStore, eventStore, groupStore, registrationStore, competitionStore } from '@/lib/store';
import type { LimitConfig, TeamProfile, Event, EventGroup } from '@/types';

interface Props { competitionId: string }

export default function AdminLimits({ competitionId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [teams, setTeams] = useState<TeamProfile[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [allGroups, setAllGroups] = useState<EventGroup[]>([]);
  const [configs, setConfigs] = useState<LimitConfig[]>([]);
  // 实时统计（每个维度当前已报名人数）
  const [liveStats, setLiveStats] = useState<Record<string, number>>({});

  // 本地编辑状态：key = `${scope}:${targetId}` → maxRegistrations
  const [editMap, setEditMap] = useState<Record<string, number | null>>({});

  // 每人限报项数（赛事级配置）
  const [perPersonForm, setPerPersonForm] = useState({ maxIndividualEvents: undefined as number | undefined, maxTeamEvents: undefined as number | undefined });
  const [savingPerPerson, setSavingPerPerson] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      teamProfileStore.getByCompetition(competitionId),
      eventStore.getByCompetition(competitionId),
      (async () => {
        const evs = await eventStore.getByCompetition(competitionId);
        const allGrps = await Promise.all(evs.map(ev => groupStore.getByEvent(ev.id)));
        return allGrps.flat();
      })(),
      limitConfigStore.getByCompetition(competitionId),
      registrationStore.getByCompetition(competitionId),
      competitionStore.getById(competitionId),
    ]).then(([tm, ev, grps, cfgs, regs, c]) => {
      setTeams(tm);
      setEvents(ev.sort((a, b) => a.orderIndex - b.orderIndex));
      setAllGroups(grps);
      setConfigs(cfgs);
      if (c) {
        setPerPersonForm({ maxIndividualEvents: c.maxIndividualEvents, maxTeamEvents: c.maxTeamEvents });
      }

      // 初始化编辑表单
      const map: Record<string, number | null> = {};
      for (const c of cfgs) {
        map[`${c.scope}:${c.targetId}`] = c.maxRegistrations;
      }

      // 实时统计
      const stats: Record<string, number> = {};
      for (const r of regs) {
        if (r.status !== 'pending' && r.status !== 'confirmed') continue;
        // 队伍维度
        if (r.teamProfileId) {
          stats[`team:${r.teamProfileId}`] = (stats[`team:${r.teamProfileId}`] || 0) + 1;
        }
        // 项目维度
        stats[`event:${r.eventId}`] = (stats[`event:${r.eventId}`] || 0) + 1;
      }
      setLiveStats(stats);
      setEditMap(map);
      setLoading(false);
    }).catch(err => {
      console.error('[AdminLimits]', err);
      setLoading(false);
    });
  }, [competitionId]);

  // 获取维度编辑值
  const getEditVal = (scope: 'team' | 'event' | 'group', targetId: string): string => {
    const v = editMap[`${scope}:${targetId}`];
    if (v === null || v === undefined) return '';
    return String(v);
  };

  const setEditVal = (scope: 'team' | 'event' | 'group', targetId: string, val: string) => {
    const num = val === '' ? null : Math.max(1, parseInt(val) || 0);
    setEditMap(prev => ({ ...prev, [`${scope}:${targetId}`]: num }));
  };

  // 保存单个维度
  const saveOne = async (scope: 'team' | 'event' | 'group', targetId: string) => {
    setSaving(true);
    try {
      const val = editMap[`${scope}:${targetId}`];
      await limitConfigStore.set(competitionId, scope, targetId, val ?? null);
      // 刷新 configs
      const newConfigs = await limitConfigStore.getByCompetition(competitionId);
      setConfigs(newConfigs);
      toast.success(`${scopeLabel(scope)}限报人数已保存`);
    } catch (e: any) {
      toast.error('保存失败：' + (e.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  // 删除配置
  const removeOne = async (scope: 'team' | 'event' | 'group', targetId: string) => {
    setSaving(true);
    try {
      const cfg = configs.find(c => c.scope === scope && c.targetId === targetId);
      if (cfg) {
        await limitConfigStore.remove(cfg.id, competitionId);
        const newConfigs = configs.filter(c => c.id !== cfg.id);
        setConfigs(newConfigs);
        setEditMap(prev => { const m = { ...prev }; delete m[`${scope}:${targetId}`]; return m; });
        toast.success('已取消限制');
      }
    } catch (e: any) {
      toast.error('操作失败：' + (e.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  // 保存每人限报项数（赛事级）
  const savePerPersonLimits = async () => {
    setSavingPerPerson(true);
    try {
      await competitionStore.update(competitionId, {
        maxIndividualEvents: perPersonForm.maxIndividualEvents ?? (null as any),
        maxTeamEvents: perPersonForm.maxTeamEvents ?? (null as any),
      });
      toast.success('每人限报项数已保存');
    } catch (e: any) {
      toast.error('保存失败：' + (e.message || '未知错误'));
    } finally {
      setSavingPerPerson(false);
    }
  };

  const scopeLabel = (s: 'team' | 'event' | 'group') =>
    s === 'team' ? '队伍' : s === 'event' ? '项目' : '分组';

  const scopeIcon = (s: 'team' | 'event' | 'group') =>
    s === 'team' ? Users : s === 'event' ? Flag : Layers;

  const getCurrentCount = (scope: 'team' | 'event' | 'group', targetId: string): number => {
    return liveStats[`${scope}:${targetId}`] || 0;
  };

  const getGroupName = (groupId: string): string => {
    return allGroups.find(g => g.id === groupId)?.name || groupId;
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-100 flex items-center justify-center">
          <Shield className="w-4 h-4 text-orange-600" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800">限报人数配置</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            按队伍、项目、分组三个维度设置最大报名人数上限，留空或0表示不限制
          </p>
        </div>
      </div>

      {/* === 每人限报项数（赛事级配置） === */}
      <Card className="border-purple-200 bg-purple-50/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-purple-100 flex items-center justify-center">
              <UserCheck className="w-3 h-3 text-purple-600" />
            </div>
            <span className="text-sm font-semibold text-slate-700">每人限报项数</span>
            <span className="text-xs text-slate-400">留空或填0表示不限制</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-500">个人项目限报项数</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                placeholder="不限制"
                value={perPersonForm.maxIndividualEvents ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  setPerPersonForm(p => ({ ...p, maxIndividualEvents: v === '' ? undefined : Number(v) }));
                }}
              />
              <p className="text-[10px] text-slate-400 mt-1">每名运动员最多报几项个人项目</p>
            </div>
            <div>
              <Label className="text-xs text-slate-500">集体项目限报项数</Label>
              <Input
                className="mt-1"
                type="number"
                min={0}
                placeholder="不限制"
                value={perPersonForm.maxTeamEvents ?? ''}
                onChange={e => {
                  const v = e.target.value;
                  setPerPersonForm(p => ({ ...p, maxTeamEvents: v === '' ? undefined : Number(v) }));
                }}
              />
              <p className="text-[10px] text-slate-400 mt-1">每名运动员最多报几项集体项目</p>
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-purple-100/50">
            <Button size="sm" onClick={savePerPersonLimits} disabled={savingPerPerson} className="gap-1.5 bg-purple-600 hover:bg-purple-700">
              <Save className="w-3.5 h-3.5" />
              {savingPerPerson ? '保存中...' : '保存限报设置'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 三级 Tab 切换 */}
      <div className="flex gap-2">
        {(['team', 'event', 'group'] as const).map(s => (
          <button
            key={s}
            onClick={() => document.getElementById(`limit-section-${s}`)?.scrollIntoView({ behavior: 'smooth' })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border bg-white hover:bg-slate-50 text-slate-600 border-slate-200 transition-colors"
          >
            {(() => { const Icon = scopeIcon(s); return <Icon className="w-3.5 h-3.5" />; })()}
            {scopeLabel(s)}
          </button>
        ))}
      </div>

      {/* === 队伍维度 === */}
      <div id="limit-section-team">
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-500" /> 队伍维度
        </h3>
        {teams.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">暂无队伍</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {teams.map(team => {
              const cur = getCurrentCount('team', team.id);
              const max = editMap[`team:${team.id}`] ?? null;
              const full = max !== null && max > 0 && cur >= max;
              return (
                <Card key={team.id} className={`${full ? 'border-red-200 bg-red-50/30' : ''}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 truncate max-w-[180px]">
                        {team.teamName}
                      </span>
                      <Badge variant={full ? 'destructive' : 'outline'} className="text-[11px]">
                        已报 {cur} 人{max && max > 0 ? ` / ${max}` : ''}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={1} placeholder="不限"
                        className="h-8 text-sm w-24"
                        value={getEditVal('team', team.id)}
                        onChange={e => setEditVal('team', team.id, e.target.value)}
                      />
                      <span className="text-xs text-slate-400">人</span>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => saveOne('team', team.id)} disabled={saving}>
                        <Save className="w-3 h-3 mr-1" />保存
                      </Button>
                      {max !== null && max > 0 && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500"
                          onClick={() => removeOne('team', team.id)} disabled={saving}>
                          取消
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* === 项目维度 === */}
      <div id="limit-section-event">
        <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <Flag className="w-4 h-4 text-green-500" /> 项目维度
        </h3>
        {events.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">暂无项目</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {events.map(ev => {
              const cur = getCurrentCount('event', ev.id);
              const max = editMap[`event:${ev.id}`] ?? null;
              const full = max !== null && max > 0 && cur >= max;
              return (
                <Card key={ev.id} className={`${full ? 'border-red-200 bg-red-50/30' : ''}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 truncate max-w-[180px]">
                        {ev.name}
                      </span>
                      <Badge variant={full ? 'destructive' : 'outline'} className="text-[11px]">
                        已报 {cur} 人{max && max > 0 ? ` / ${max}` : ''}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={1} placeholder="不限"
                        className="h-8 text-sm w-24"
                        value={getEditVal('event', ev.id)}
                        onChange={e => setEditVal('event', ev.id, e.target.value)}
                      />
                      <span className="text-xs text-slate-400">人</span>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => saveOne('event', ev.id)} disabled={saving}>
                        <Save className="w-3 h-3 mr-1" />保存
                      </Button>
                      {max !== null && max > 0 && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500"
                          onClick={() => removeOne('event', ev.id)} disabled={saving}>
                          取消
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* === 分组维度 === */}
      <div id="limit-section-group">
          <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-500" /> 分组维度
            <span className="text-xs text-slate-400 font-normal">（在 limit_configs 中独立配置，与分组自身属性无关）</span>
          </h3>
        {allGroups.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">暂无分组</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {allGroups.map(grp => {
              const ev = events.find(e => e.id === grp.eventId);
              const max = editMap[`group:${grp.id}`] ?? null;
              const cur = grp.currentCount;
              const full = max !== null && max > 0 && cur >= max;
              return (
                <Card key={grp.id} className={`${full ? 'border-red-200 bg-red-50/30' : ''}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-slate-700 truncate block">
                          {grp.name}
                        </span>
                        {ev && <span className="text-[11px] text-slate-400">{ev.name}</span>}
                      </div>
                      <Badge variant={full ? 'destructive' : 'outline'} className="text-[11px] shrink-0 ml-2">
                        已报 {cur}{max !== null && max > 0 ? ` / ${max}` : ''}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={1} placeholder="不限"
                        className="h-8 text-sm w-24"
                        value={getEditVal('group', grp.id)}
                        onChange={e => setEditVal('group', grp.id, e.target.value)}
                      />
                      <span className="text-xs text-slate-400">人</span>
                      <div className="flex-1" />
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => saveOne('group', grp.id)} disabled={saving}>
                        <Save className="w-3 h-3 mr-1" />保存
                      </Button>
                      {max !== null && max > 0 && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500"
                          onClick={() => removeOne('group', grp.id)} disabled={saving}>
                          取消
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 提示信息 */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-700 space-y-1">
          <p><strong>限报校验规则：</strong></p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>每人限报项数：限制每名运动员可报个人/集体项目的最大项数（顶部紫色卡片）</li>
            <li>队伍维度：统计该队伍下所有 pending/confirmed 报名总数</li>
            <li>项目维度：统计该项目下所有 pending/confirmed 报名总数</li>
            <li>分组维度：统计该分组下所有 pending/confirmed 报名总数（与项目-分组自身属性无关，仅以本处配置为准）</li>
            <li>任一超限即阻止报名，并提示具体原因</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
