import { useState, useEffect } from 'react';
import { Download, Trash2, CheckCircle, FileText, Edit3, AlertTriangle, ListTree, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  competitionStore, registrationStore, eventStore, groupStore,
  athleteStore, coachStore,
} from '@/lib/store';
import type { Competition, Event as EventType, Registration, EventGroup, Athlete, Coach, ClubAccount } from '@/types';

interface Props { club: ClubAccount; competitionId: string; teamProfileId: string }

export default function ClubMyRegistrations({ club, competitionId, teamProfileId }: Props) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [events, setEvents] = useState<EventType[]>([]);
  const [selCompId, setSelCompId] = useState(competitionId || 'all');
  const [viewMode, setViewMode] = useState<'event' | 'athlete'>('event');
  const [list, setList] = useState<Registration[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // ---- 修改重提交弹窗 ----
  const [editTarget, setEditTarget] = useState<Registration | null>(null);
  const [editGroups, setEditGroups] = useState<EventGroup[]>([]);
  const [editAthletes, setEditAthletes] = useState<Athlete[]>([]);
  const [editCoaches, setEditCoaches] = useState<Coach[]>([]);
  const [editing, setEditing] = useState(false);
  // 表单临时态
  const [editAthleteIds, setEditAthleteIds] = useState<string[]>([]);
  const [editCoachId, setEditCoachId] = useState('_none_');

  const load = () => {
    Promise.all([
      competitionStore.getAll(),
      registrationStore.getByClubAndTeam(club.id, teamProfileId),
      eventStore.getAll(),
    ]).then(([comps, regs, evts]) => {
      setCompetitions(comps);
      setList(regs.sort((a: Registration, b: Registration) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setEvents(evts);
    });
  };
  useEffect(load, [club.id, competitionId, teamProfileId]);
  // 当父组件 competitionId 变化时同步筛选器
  useEffect(() => { setSelCompId(competitionId || 'all'); }, [competitionId]);

  const filtered = selCompId === 'all' ? list : list.filter(r => r.competitionId === selCompId);
  const eventGroups = Object.values(filtered.reduce<Record<string, { eventId: string; eventName: string; entries: Registration[] }>>((groups, registration) => {
    const group = groups[registration.eventId] || { eventId: registration.eventId, eventName: registration.eventName, entries: [] };
    group.entries.push(registration);
    groups[registration.eventId] = group;
    return groups;
  }, {}));

  const athleteGroups = Object.values(filtered.reduce<Record<string, { athleteId: string; name: string; entries: Array<{ registration: Registration; eventName: string; groupName: string }> }>>((groups, registration) => {
    registration.athletes.forEach(athlete => {
      const group = groups[athlete.athleteId] || { athleteId: athlete.athleteId, name: athlete.name, entries: [] };
      group.entries.push({ registration, eventName: registration.eventName, groupName: registration.groupName });
      groups[athlete.athleteId] = group;
    });
    return groups;
  }, {})).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const handleDelete = (id: string) => setDeleteId(id);
  const handleResubmit = async (id: string) => {
    try {
      await registrationStore.resubmit(id);
      load();
      toast.success('报名已重新提交，等待审核');
    } catch (err: any) {
      toast.error('重新提交失败：' + (err?.message || '请稍后重试'));
    }
  };
  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await registrationStore.delete(deleteId);
      load();
      toast.success('报名已撤销');
    } catch (err: any) {
      toast.error('撤销失败：' + (err?.message || '未知错误'));
    }
    setDeleteId(null);
  };

  // 待审核报名允许只修改运动员与教练；项目、分组、状态均由服务端状态机保护。
  const openEdit = async (reg: Registration) => {
    setEditTarget(reg);
    setEditing(true);
    try {
      const [athletes, coaches] = await Promise.all([
        athleteStore.getByClubAndTeam(club.id, teamProfileId),
        coachStore.getByClubAndTeam(club.id, teamProfileId),
      ]);
      setEditAthletes(athletes);
      setEditCoaches(coaches);
      setEditAthleteIds(reg.athletes.map(a => a.athleteId));
      setEditCoachId(reg.coachId || '_none_');
    } catch {
      setEditAthletes([]);
      setEditCoaches([]);
      setEditAthleteIds(reg.athletes.map(a => a.athleteId));
      setEditCoachId(reg.coachId || '_none_');
    } finally {
      setEditing(false);
    }
  };

  const toggleEditAthlete = (id: string, maxCount: number) => {
    setEditAthleteIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) :
        prev.length < maxCount ? [...prev, id] : prev
    );
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    if (!editAthleteIds.length) { toast('请至少选择一名运动员'); return; }
    const athleteDetails = editAthletes.filter(a => editAthleteIds.includes(a.id)).map(a => ({ athleteId: a.id, name: a.name }));
    try {
      await registrationStore.update(editTarget.id, {
        athletes: athleteDetails,
        coachId: editCoachId === '_none_' ? null : editCoachId,
      });
      setEditTarget(null);
      load();
      toast.success('修改已保存，报名仍在审核中');
    } catch (err: any) {
      toast.error('修改提交失败：' + (err?.message || '请稍后重试'));
    }
  };

  // 获取项目最大运动员数
  const getMaxAthletes = (reg: Registration) => {
    const ev = events.find(e => e.id === reg.eventId);
    return ev?.maxAthletes || 1;
  };

  const handleExport = () => {
    if (!filtered.length) return;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const comp = selCompId !== 'all' ? competitions.find(c => c.id === selCompId) : null;
    let html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${esc(club.clubName)} - 报名详情</title>
  <style>
    body { font-family: '微软雅黑', sans-serif; color: #1e293b; max-width: 900px; margin: 0 auto; padding: 30px; }
    h1 { font-size: 22px; color: #1e40af; border-bottom: 2px solid #2563eb; padding-bottom: 8px; }
    .meta { color: #64748b; font-size: 13px; margin: 10px 0 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #1e40af; color: white; padding: 8px 12px; text-align: left; }
    td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #f8fafc; }
  </style>
</head>
<body>
  <h1>${esc(club.clubName)} 报名详情表</h1>
  <div class="meta">
    ${comp ? `赛事：${esc(comp.name)} · ` : ''}导出时间：${new Date().toLocaleString()}
    · 共 ${filtered.length} 条报名记录
  </div>
  <table>
    <thead><tr><th>竞赛项目</th><th>报名分组</th><th>参赛运动员</th><th>带队教练</th><th>报名时间</th></tr></thead>
    <tbody>
      ${filtered.map(r => `
        <tr>
          <td>${esc(r.eventName)}</td>
          <td>${esc(r.groupName)}</td>
          <td>${esc(r.athletes.map(a => a.name).join(' / '))}</td>
          <td>${r.coachName ? esc(r.coachName) : '—'}</td>
          <td>${new Date(r.createdAt).toLocaleDateString()}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${club.clubName}_报名详情.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6 gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-800">我的报名</h2>
          <p className="text-slate-500 text-xs sm:text-sm mt-0.5">按项目和运动员查看已提交项目清单，支持导出</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length} className="gap-1.5 shrink-0">
          <Download className="w-4 h-4" /><span className="hidden sm:inline">导出报名表</span><span className="sm:hidden">导出</span>
        </Button>
      </div>

      {/* 赛事与查看方式 */}
      <div className="mb-3 sm:mb-4 space-y-3">
        <Select value={selCompId} onValueChange={setSelCompId}>
          <SelectTrigger className="w-full sm:w-72 bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部赛事</SelectItem>
            {competitions.filter(c => c.id).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="报名清单查看方式">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'event'}
            onClick={() => setViewMode('event')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors active:scale-[0.98] ${viewMode === 'event' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <ListTree className="h-4 w-4" />按项目查看
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'athlete'}
            onClick={() => setViewMode('athlete')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors active:scale-[0.98] ${viewMode === 'athlete' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Users className="h-4 w-4" />按运动员查看
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-400 bg-white rounded-xl border border-dashed">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-25" />
          <p>暂无报名记录</p>
        </div>
      ) : viewMode === 'event' ? (
        <div className="space-y-3">
          {eventGroups.map(eventGroup => (
            <section key={eventGroup.eventId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-3 py-2.5 sm:px-4">
                <h3 className="font-semibold leading-5 text-slate-800 break-words">{eventGroup.eventName}</h3>
                <p className="mt-0.5 text-xs text-slate-500">已提交 {eventGroup.entries.length} 个报名项</p>
              </div>
              <div className="divide-y divide-slate-100">
                {eventGroup.entries.map(r => (
                  <div key={r.id} className="px-3 py-2.5 sm:px-4 sm:py-3">
                    <div className="grid gap-x-2 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-5 text-slate-700 break-words">{r.groupName}</p>
                        <p className="mt-0.5 text-sm leading-5 text-slate-500 break-words">运动员：{r.athletes.map(a => a.name).join(' / ')}</p>
                      </div>
                      <span className="text-xs leading-5 text-slate-400 sm:pt-0.5">{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                    {(r.status === 'rejected' && r.rejectReason) || r.coachName || r.startOrder ? (
                      <div className="mt-1 flex items-center gap-2 text-xs min-w-0">
                        {r.status === 'rejected' && r.rejectReason && (
                          <span className="inline-flex items-center gap-1 min-w-0 text-red-600 truncate"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{r.rejectReason}</span>
                        )}
                        {r.coachName && <span className="text-slate-500 break-words">教练：{r.coachName}</span>}
                        {r.startOrder && <span className="text-blue-700 shrink-0">序号 #{r.startOrder}{r.bibNumber ? ` · ${r.bibNumber}` : ''}</span>}
                      </div>
                    ) : null}
                    {r.status === 'rejected' && (
                      <div className="mt-2">
                        <Button size="sm" variant="outline" className="h-7 text-xs text-blue-600 border-blue-300 hover:bg-blue-50 gap-1" onClick={() => handleResubmit(r.id)}>
                          <CheckCircle className="w-3.5 h-3.5" />重新提交
                        </Button>
                      </div>
                    )}
                    {r.status === 'pending' && (
                      <div className="mt-2 flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs text-blue-600 border-blue-300 hover:bg-blue-50 gap-1" onClick={() => openEdit(r)}>
                          <Edit3 className="w-3.5 h-3.5" />修改
                        </Button>
                        <button onClick={() => handleDelete(r.id)} className="p-1 text-slate-400 hover:text-red-500 shrink-0" title="撤销报名">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {athleteGroups.map(group => (
            <Card key={group.athleteId} className="bg-white border-0 shadow-sm overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">{group.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">已提交 {group.entries.length} 个项目</p>
                  </div>
                  <div className="h-9 w-9 shrink-0 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center font-semibold">
                    {group.name.slice(0, 1)}
                  </div>
                </div>
                <div className="pt-2.5 space-y-2">
                  {group.entries.map(({ registration, eventName, groupName }) => (
                    <div key={`${registration.id}:${group.athleteId}`} className="flex items-start gap-2 text-sm">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-700">{eventName}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{groupName}{registration.coachName ? ` · 教练：${registration.coachName}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 修改重提交弹窗 */}
      <Dialog open={!!editTarget} onOpenChange={() => setEditTarget(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>修改报名并重新提交</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-2 text-sm pr-1">
              <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">
                <span className="font-medium text-slate-800">{editTarget.eventName}</span>
                <span className="text-slate-400">— 分组：{editTarget.groupName}</span>
              </div>
              <p className="text-xs text-slate-500">待审核报名仅可修改运动员和教练；项目、分组及审核状态由服务端状态机维护。</p>

              {/* 选择运动员 */}
              <div>
                <Label className="text-sm font-medium text-slate-700 mb-2 block">
                  修改参赛运动员
                  <span className="text-slate-400 font-normal ml-2">已选 {editAthleteIds.length}/{getMaxAthletes(editTarget)}</span>
                </Label>
                {editAthletes.length === 0 ? (
                  <div className="text-sm text-slate-400 py-3 text-center border border-dashed rounded-lg">暂无运动员数据</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {editAthletes.map(a => {
                      const selected = editAthleteIds.includes(a.id);
                      const maxCount = getMaxAthletes(editTarget);
                      const disabled = !selected && editAthleteIds.length >= maxCount;
                      return (
                        <button
                          key={a.id}
                          disabled={disabled}
                          onClick={() => toggleEditAthlete(a.id, maxCount)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border transition-all ${
                            disabled ? 'opacity-40 cursor-not-allowed bg-slate-50 border-slate-200 text-slate-500' :
                            selected ? 'bg-blue-600 text-white border-blue-600' :
                            'bg-white border-slate-200 hover:border-blue-300 text-slate-700'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                            selected ? 'bg-white/30 text-white' : a.gender === 'male' ? 'bg-blue-100 text-blue-600' : 'bg-pink-100 text-pink-600'
                          }`}>{a.name[0]}</div>
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 选择教练 */}
              {editCoaches.length > 0 && (
                <div>
                  <Label className="text-sm font-medium text-slate-700 mb-2 block">修改带队教练（可选）</Label>
                  <Select value={editCoachId} onValueChange={setEditCoachId}>
                    <SelectTrigger className="w-56 bg-white">
                      <SelectValue placeholder="选择教练员" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_">不指定</SelectItem>
                      {editCoaches.filter(c => c.id).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditTarget(null)}>取消</Button>
                <Button onClick={submitEdit} disabled={!editAthleteIds.length} className="bg-blue-600 hover:bg-blue-700 text-white gap-1">
                  <CheckCircle className="w-4 h-4" />提交审核
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 撤销报名确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认撤销报名？</AlertDialogTitle>
            <AlertDialogDescription>
              撤销后该条报名记录将被删除，此操作不可撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              确认撤销
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
