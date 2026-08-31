import { useState, useEffect, useMemo } from 'react';
import {
  Search, Edit2, User, GraduationCap, UserCheck, Building2,
  X, Camera, ImageIcon, ChevronRight, ChevronDown, Trash2, AlertTriangle,
  Phone, MapPin, UsersRound
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { athleteStore, coachStore, leaderStore, clubStore, registrationStore, teamProfileStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import type { Athlete, Coach, TeamLeader, ClubAccount, TeamProfile } from '@/types';
import { toast } from 'sonner';

interface Props {
  competitionId: string;
}

export default function AdminPersonnel({ competitionId }: Props) {
  // ===== 数据状态 =====
  const [clubs, setClubs] = useState<ClubAccount[]>([]);
  const [teamProfiles, setTeamProfiles] = useState<TeamProfile[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [leaders, setLeaders] = useState<TeamLeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // ===== UI 状态 =====
  const [expandedClubId, setExpandedClubId] = useState<string | null>(null);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);

  // 编辑账号弹窗
  const [editingClub, setEditingClub] = useState<ClubAccount | null>(null);
  const [editClubForm, setEditClubForm] = useState<any>(null);

  // 编辑人员弹窗
  const [editType, setEditType] = useState<'athlete' | 'coach' | 'leader' | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // 注销确认弹窗
  const [deletingClub, setDeletingClub] = useState<ClubAccount | null>(null);
  const [deletingConfirmText, setDeletingConfirmText] = useState('');
  const [deletingStep, setDeletingStep] = useState<'confirm' | 'progress'>('confirm');

  // 删除人员确认弹窗
  const [deleteTarget, setDeleteTarget] = useState<{ type: string; id: string; name: string } | null>(null);

  // ===== 数据加载 =====
  const loadAll = async () => {
    setLoading(true);
    try {
      const [allClubs, allTeams, compAthletes, compCoaches, compLeaders] = await Promise.all([
        clubStore.getAll(),
        teamProfileStore.getByCompetition(competitionId),
        athleteStore.getByCompetition(competitionId),
        coachStore.getByCompetition(competitionId),
        leaderStore.getByCompetition(competitionId),
      ]);
      setClubs(allClubs);
      setTeamProfiles(allTeams);
      setAthletes(compAthletes);
      setCoaches(compCoaches);
      setLeaders(compLeaders);
    } catch {
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [competitionId]);

  // ===== 数据聚合 =====
  const teamsByClub = useMemo(() => {
    const map: Record<string, TeamProfile[]> = {};
    teamProfiles.forEach(t => {
      if (!map[t.clubId]) map[t.clubId] = [];
      map[t.clubId].push(t);
    });
    return map;
  }, [teamProfiles]);

  const athletesByTeam = useMemo(() => {
    const map: Record<string, Athlete[]> = {};
    athletes.forEach(a => {
      const key = `${a.clubId}::${a.teamProfileId || ''}`;
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });
    return map;
  }, [athletes]);

  const coachesByTeam = useMemo(() => {
    const map: Record<string, Coach[]> = {};
    coaches.forEach(c => {
      const key = `${c.clubId}::${c.teamProfileId || ''}`;
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  }, [coaches]);

  const leadersByTeam = useMemo(() => {
    const map: Record<string, TeamLeader[]> = {};
    leaders.forEach(l => {
      const key = `${l.clubId}::${l.teamProfileId || ''}`;
      if (!map[key]) map[key] = [];
      map[key].push(l);
    });
    return map;
  }, [leaders]);

  const allAthletesByClub = useMemo(() => {
    const map: Record<string, Athlete[]> = {};
    athletes.forEach(a => { if (!map[a.clubId]) map[a.clubId] = []; map[a.clubId].push(a); });
    return map;
  }, [athletes]);

  const allCoachesByClub = useMemo(() => {
    const map: Record<string, Coach[]> = {};
    coaches.forEach(c => { if (!map[c.clubId]) map[c.clubId] = []; map[c.clubId].push(c); });
    return map;
  }, [coaches]);

  const allLeadersByClub = useMemo(() => {
    const map: Record<string, TeamLeader[]> = {};
    leaders.forEach(l => { if (!map[l.clubId]) map[l.clubId] = []; map[l.clubId].push(l); });
    return map;
  }, [leaders]);

  // 搜索过滤
  const filteredClubs = useMemo(() => {
    if (!search.trim()) return clubs;
    const q = search.trim().toLowerCase();
    return clubs.filter(c =>
      c.clubName.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q) ||
      c.contactName.toLowerCase().includes(q) ||
      c.phone.includes(q)
    );
  }, [clubs, search]);

  const getClubStats = (clubId: string) => {
    const ca = allAthletesByClub[clubId] || [];
    const cc = allCoachesByClub[clubId] || [];
    const cl = allLeadersByClub[clubId] || [];
    const ct = teamsByClub[clubId] || [];
    return { athletes: ca.length, coaches: cc.length, leaders: cl.length, teams: ct.length };
  };

  const getTeamMembers = (clubId: string, teamProfileId: string) => {
    const key = `${clubId}::${teamProfileId}`;
    return {
      athletes: athletesByTeam[key] || [],
      coaches: coachesByTeam[key] || [],
      leaders: leadersByTeam[key] || [],
    };
  };

  // ===== 账号编辑 =====
  const openEditClub = (club: ClubAccount) => {
    setEditingClub(club);
    setEditClubForm({
      clubName: club.clubName,
      contactName: club.contactName,
      phone: club.phone,
      email: club.email || '',
      province: club.province || '',
      city: club.city || '',
    });
  };

  const saveEditClub = async () => {
    if (!editingClub || !editClubForm) return;
    try {
      await clubStore.update(editingClub.id, {
        clubName: editClubForm.clubName,
        contactName: editClubForm.contactName,
        phone: editClubForm.phone,
        email: editClubForm.email || undefined,
        province: editClubForm.province || undefined,
        city: editClubForm.city || undefined,
      });
      toast.success('账号信息已更新');
      setEditingClub(null);
      await loadAll();
    } catch {
      toast.error('更新失败，请重试');
    }
  };

  // ===== 账号注销 =====
  const confirmDeleteClub = async () => {
    if (!deletingClub) return;
    const stats = getClubStats(deletingClub.id);
    if (stats.teams + stats.athletes + stats.coaches + stats.leaders > 0) {
      if (deletingConfirmText !== '确认注销') {
        toast.error('请输入"确认注销"以确认操作');
        return;
      }
    }
    setDeletingStep('progress');
    try {
      const result = await clubStore.delete(deletingClub.id);
      const detail = Object.entries(result.deleted)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${t}(${n}条)`)
        .join('、');
      toast.success(`已注销账号「${deletingClub.clubName}」${detail ? `，已删除：${detail}` : ''}`);
      if (result.errors.length > 0) {
        console.warn('[注销] 部分数据因权限未清除:', result.errors);
        toast.warning(`部分关联数据未被自动清除（RLS限制），请点击「清理孤立数据」按钮`, { duration: 5000 });
      }
      setDeletingClub(null);
      setDeletingConfirmText('');
      setDeletingStep('confirm');
      setExpandedClubId(null);
      setExpandedTeamId(null);
      await loadAll();
    } catch (err: any) {
      toast.error('注销失败：' + (err.message || '未知错误'));
      setDeletingStep('confirm');
    }
  };

  // ===== 清理孤立数据 =====
  const [cleaning, setCleaning] = useState(false);
  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const result = await clubStore.cleanupOrphanedData();
      const total = Object.values(result.cleaned).reduce((s, n) => s + n, 0);
      if (total > 0) {
        const detail = Object.entries(result.cleaned).filter(([, n]) => n > 0).map(([t, n]) => `${t}(${n}条)`).join('、');
        toast.success(`已清理 ${total} 条孤立数据：${detail}`);
      } else {
        toast.info('没有发现孤立数据');
      }
      if (result.errors.length > 0) {
        result.errors.forEach(e => console.warn('[清理] 失败:', e));
        toast.warning(`${result.errors.length} 项清理失败，详见控制台`);
      }
      await loadAll();
    } catch (err: any) {
      toast.error('清理失败：' + (err.message || '未知错误'));
    } finally {
      setCleaning(false);
    }
  };

  // ===== 人员编辑 =====
  const openEdit = (type: 'athlete' | 'coach' | 'leader', data: any) => {
    setEditType(type);
    if (type === 'athlete') {
      setEditData({ _raw: data, name: data.name, gender: data.gender, birthDate: data.birthDate, idCard: data.idCard || '', avatarUrl: data.avatarUrl || null });
      setAvatarFile(null);
      setAvatarPreview(data.avatarUrl || null);
    } else if (type === 'coach') {
      setEditData({ _raw: data, name: data.name, phone: data.phone || '' });
    } else {
      setEditData({ _raw: data, name: data.name, phone: data.phone || '', position: data.position || '' });
    }
  };

  const closeEdit = () => { setEditType(null); setEditData(null); setAvatarFile(null); setAvatarPreview(null); };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) { toast.error('仅支持 JPG 或 PNG'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('照片不能超过 2MB'); return; }
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const clearAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
    if (editData) setEditData((p: any) => ({ ...p, avatarUrl: null }));
  };

  const saveEdit = async () => {
    if (!editType || !editData) return;
    const raw = (editData as any)._raw;
    try {
      if (editType === 'athlete') {
        let avatarUrl = editData.avatarUrl || undefined;
        if (avatarFile) {
          setAvatarUploading(true);
          try {
            const fileExt = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg';
            const fileName = `${raw.clubId || 'admin'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;
            const { data: uploadData, error: uploadErr } = await supabase.storage
              .from('athlete-avatars').upload(fileName, avatarFile, { upsert: true, contentType: avatarFile.type });
            if (uploadErr) throw uploadErr;
            const { data: urlData } = supabase.storage.from('athlete-avatars').getPublicUrl(fileName);
            avatarUrl = urlData.publicUrl;
            if (raw.avatarUrl && raw.avatarUrl.includes('athlete-avatars')) {
              try {
                const oldPath = new URL(raw.avatarUrl).pathname.split('/athlete-avatars/')[1];
                if (oldPath) await supabase.storage.from('athlete-avatars').remove([oldPath]);
              } catch { /* ignore */ }
            }
          } catch {
            avatarUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(avatarFile);
            });
          } finally {
            setAvatarUploading(false);
          }
        } else if (avatarPreview === null && raw.avatarUrl) {
          avatarUrl = undefined;
        }
        await athleteStore.update(raw.id, {
          name: editData.name, gender: editData.gender, birthDate: editData.birthDate,
          idCard: editData.idCard, avatarUrl: avatarUrl as any,
        });
      } else if (editType === 'coach') {
        await coachStore.update(raw.id, { name: editData.name, phone: editData.phone });
      } else {
        await leaderStore.update(raw.id, { name: editData.name, phone: editData.phone, position: editData.position });
      }
      closeEdit();
      await loadAll();
      toast.success('保存成功');
    } catch {
      toast.error('保存失败，请重试');
    }
  };

  // ===== 人员删除 =====
  const confirmDeletePerson = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'athlete') await athleteStore.delete(deleteTarget.id);
      else if (deleteTarget.type === 'coach') await coachStore.delete(deleteTarget.id);
      else await leaderStore.delete(deleteTarget.id);
      toast.success(`已删除${deleteTarget.type === 'athlete' ? '运动员' : deleteTarget.type === 'coach' ? '教练员' : '领队'}「${deleteTarget.name}」`);
      setDeleteTarget(null);
      await loadAll();
    } catch (err: any) {
      toast.error('删除失败：' + (err.message || '未知错误'));
    }
  };

  // ===== 渲染 =====
  if (loading) {
    return <div className="p-6 flex items-center justify-center h-64"><div className="text-slate-400">加载中...</div></div>;
  }

  const stats = {
    clubs: clubs.length,
    teams: teamProfiles.length,
    athletes: athletes.length,
    coaches: coaches.length,
    leaders: leaders.length,
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-slate-800">注册账号及队伍管理</h2>
        <p className="text-slate-400 text-sm mt-0.5">管理所有注册账号及其创建的队伍、教练员、运动员和领队</p>
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[
          { label: '注册账号', count: stats.clubs, icon: <UsersRound className="w-5 h-5" />, color: 'blue' },
          { label: '参赛队伍', count: stats.teams, icon: <Building2 className="w-5 h-5" />, color: 'amber' },
          { label: '运动员', count: stats.athletes, icon: <User className="w-5 h-5" />, color: 'blue' },
          { label: '教练员', count: stats.coaches, icon: <GraduationCap className="w-5 h-5" />, color: 'emerald' },
          { label: '领队', count: stats.leaders, icon: <UserCheck className="w-5 h-5" />, color: 'violet' },
        ].map(s => {
          const bgMap: Record<string, string> = { blue: 'bg-blue-50 text-blue-600', emerald: 'bg-emerald-50 text-emerald-600', violet: 'bg-violet-50 text-violet-600', amber: 'bg-amber-50 text-amber-600' };
          return (
            <Card key={s.label} className="bg-white border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bgMap[s.color]}`}>{s.icon}</div>
                <div>
                  <div className="text-2xl font-bold text-slate-800">{s.count}</div>
                  <div className="text-sm text-slate-500">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 搜索 */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input className="pl-9" placeholder="搜索账号、单位名称、联系人..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* 注册账号列表 */}
      <div className="space-y-3">
        {filteredClubs.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">{search ? '未找到匹配的账号' : '暂无注册账号'}</div>
        ) : (
          filteredClubs.map(club => {
            const clubStats = getClubStats(club.id);
            const clubTeams = teamsByClub[club.id] || [];
            const isExpanded = expandedClubId === club.id;

            return (
              <div key={club.id} className="bg-white rounded-xl shadow-sm border-0 overflow-hidden">
                {/* 账号卡片头部 */}
                <div className="flex items-center gap-4 p-4 cursor-pointer hover:bg-slate-50/50 transition-colors" onClick={() => setExpandedClubId(isExpanded ? null : club.id)}>
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm">{club.clubName}</div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><UsersRound className="w-3 h-3" />{club.username}</span>
                      <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{club.phone}</span>
                      {club.province && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{club.province}{club.city ? ` ${club.city}` : ''}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-center hidden sm:block">
                      <div className="font-bold text-sm text-amber-600">{clubStats.teams}</div>
                      <div className="text-[10px] text-slate-400">队伍</div>
                    </div>
                    <div className="text-center hidden sm:block">
                      <div className="font-bold text-sm text-blue-600">{clubStats.athletes}</div>
                      <div className="text-[10px] text-slate-400">运动员</div>
                    </div>
                    <div className="text-center hidden sm:block">
                      <div className="font-bold text-sm text-emerald-600">{clubStats.coaches}</div>
                      <div className="text-[10px] text-slate-400">教练</div>
                    </div>
                    <div className="text-center hidden sm:block">
                      <div className="font-bold text-sm text-violet-600">{clubStats.leaders}</div>
                      <div className="text-[10px] text-slate-400">领队</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-blue-600 hover:bg-blue-50" onClick={() => openEditClub(club)}>
                      <Edit2 className="w-3 h-3" />编辑
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-red-600 hover:bg-red-50" onClick={() => { setDeletingClub(club); setDeletingConfirmText(''); setDeletingStep('confirm'); }}>
                      <Trash2 className="w-3 h-3" />注销
                    </Button>
                  </div>
                </div>

                {/* 展开内容 */}
                {isExpanded && (
                  <div className="border-t border-slate-100 bg-slate-50/30">
                    {clubTeams.length === 0 && clubStats.athletes + clubStats.coaches + clubStats.leaders === 0 ? (
                      <div className="px-16 py-8 text-center text-sm text-slate-400">该账号下暂无队伍和人员数据</div>
                    ) : (
                      <div className="px-4 py-3 space-y-2">
                        {clubTeams.map(team => {
                          const isTeamExpanded = expandedTeamId === team.id;
                          const members = getTeamMembers(club.id, team.id);

                          return (
                            <div key={team.id} className="bg-white rounded-lg border border-slate-100 overflow-hidden">
                              <div className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => setExpandedTeamId(isTeamExpanded ? null : team.id)}>
                                {isTeamExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                                <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
                                  <Building2 className="w-3.5 h-3.5 text-amber-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium text-slate-700">{team.teamName}</span>
                                </div>
                                <div className="flex items-center gap-3 text-xs">
                                  <Badge className="bg-blue-50 text-blue-600 border-0">{members.athletes.length} 人</Badge>
                                  <Badge className="bg-emerald-50 text-emerald-600 border-0">{members.coaches.length} 教</Badge>
                                  <Badge className="bg-violet-50 text-violet-600 border-0">{members.leaders.length} 领</Badge>
                                </div>
                              </div>

                              {isTeamExpanded && (
                                <div className="border-t border-slate-100 px-3 py-2">
                                  {/* 运动员 */}
                                  <div className="mb-3">
                                    <div className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1"><User className="w-3 h-3 text-blue-500" />运动员 ({members.athletes.length})</div>
                                    {members.athletes.length === 0 ? (
                                      <div className="text-xs text-slate-300 py-2 pl-1">暂无</div>
                                    ) : (
                                      <div className="space-y-1">
                                        {members.athletes.map(a => (
                                          <PersonRow key={a.id} item={a} type="athlete" onEdit={() => openEdit('athlete', a)} onDelete={() => setDeleteTarget({ type: 'athlete', id: a.id, name: a.name })} />
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* 教练员 */}
                                  <div className="mb-3">
                                    <div className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1"><GraduationCap className="w-3 h-3 text-emerald-500" />教练员 ({members.coaches.length})</div>
                                    {members.coaches.length === 0 ? (
                                      <div className="text-xs text-slate-300 py-2 pl-1">暂无</div>
                                    ) : (
                                      <div className="space-y-1">
                                        {members.coaches.map(c => (
                                          <PersonRow key={c.id} item={c} type="coach" onEdit={() => openEdit('coach', c)} onDelete={() => setDeleteTarget({ type: 'coach', id: c.id, name: c.name })} />
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  {/* 领队 */}
                                  <div>
                                    <div className="text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1"><UserCheck className="w-3 h-3 text-violet-500" />领队 ({members.leaders.length})</div>
                                    {members.leaders.length === 0 ? (
                                      <div className="text-xs text-slate-300 py-2 pl-1">暂无</div>
                                    ) : (
                                      <div className="space-y-1">
                                        {members.leaders.map(l => (
                                          <PersonRow key={l.id} item={l} type="leader" onEdit={() => openEdit('leader', l)} onDelete={() => setDeleteTarget({ type: 'leader', id: l.id, name: l.name })} />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* 未分配队伍的人员 */}
                        <UnassignedSection
                          clubId={club.id}
                          athletes={allAthletesByClub[club.id] || []}
                          coaches={allCoachesByClub[club.id] || []}
                          leaders={allLeadersByClub[club.id] || []}
                          onEdit={openEdit}
                          onDelete={setDeleteTarget}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 编辑账号弹窗 */}
      <EditClubDialog club={editingClub} form={editClubForm} setForm={setEditClubForm} onClose={() => setEditingClub(null)} onSave={saveEditClub} />

      {/* 注销确认弹窗 */}
      <DeleteClubDialog
        club={deletingClub}
        confirmText={deletingConfirmText}
        setConfirmText={setDeletingConfirmText}
        step={deletingStep}
        onClose={() => { setDeletingClub(null); setDeletingConfirmText(''); setDeletingStep('confirm'); }}
        onConfirm={confirmDeleteClub}
        getStats={getClubStats}
      />

      {/* 删除人员确认弹窗 */}
      <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle className="text-sm">确认删除</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            确定要删除{deleteTarget?.type === 'athlete' ? '运动员' : deleteTarget?.type === 'coach' ? '教练员' : '领队'}
            「{deleteTarget?.name}」吗？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" size="sm" onClick={confirmDeletePerson}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑人员弹窗 */}
      <EditPersonDialog
        type={editType}
        data={editData}
        setData={setEditData}
        avatarPreview={avatarPreview}
        avatarFile={avatarFile}
        avatarUploading={avatarUploading}
        onClose={closeEdit}
        onSave={saveEdit}
        onAvatarChange={handleAvatarChange}
        onClearAvatar={clearAvatar}
      />
    </div>
  );
}

// ===== 子组件 =====

function PersonRow({ item, type, onEdit, onDelete }: {
  item: any; type: string; onEdit: () => void; onDelete: () => void;
}) {
  const colorMap: Record<string, { bg: string; avatar: string; text: string; edit: string; del: string }> = {
    athlete: { bg: 'bg-blue-50/50', avatar: 'bg-blue-500', text: 'text-blue-600', edit: 'hover:bg-blue-100', del: 'hover:bg-red-100' },
    coach: { bg: 'bg-emerald-50/50', avatar: 'bg-emerald-500', text: 'text-emerald-600', edit: 'hover:bg-emerald-100', del: 'hover:bg-red-100' },
    leader: { bg: 'bg-violet-50/50', avatar: 'bg-violet-500', text: 'text-violet-600', edit: 'hover:bg-violet-100', del: 'hover:bg-red-100' },
  };
  const c = colorMap[type] || colorMap.athlete;
  const extra = type === 'athlete'
    ? <span className="text-[10px] text-slate-400">{(item as Athlete).gender === 'male' ? '男' : '女'} · {(item as Athlete).birthDate}</span>
    : type === 'leader'
      ? <span className="text-[10px] text-slate-400">{(item as TeamLeader).position} · {(item as TeamLeader).phone}</span>
      : <span className="text-[10px] text-slate-400">{(item as Coach).phone}</span>;

  return (
    <div className={`flex items-center gap-2 py-1.5 px-2 rounded-md ${c.bg} group`}>
      {type === 'athlete' && (item as Athlete).avatarUrl ? (
        <img src={(item as Athlete).avatarUrl!} alt={item.name} className="w-6 h-6 rounded-full object-cover border border-slate-200" />
      ) : (
        <div className={`w-6 h-6 rounded-full ${c.avatar} flex items-center justify-center text-white text-[10px] font-bold`}>{item.name[0]}</div>
      )}
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-slate-700">{item.name}</span>
        <span className="ml-2">{extra}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button size="sm" variant="ghost" className={`h-6 px-1.5 text-[10px] ${c.text} ${c.edit}`} onClick={onEdit}><Edit2 className="w-2.5 h-2.5" /></Button>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-red-500" onClick={onDelete}><Trash2 className="w-2.5 h-2.5" /></Button>
      </div>
    </div>
  );
}

function UnassignedSection({ clubId, athletes, coaches, leaders, onEdit, onDelete }: {
  clubId: string; athletes: Athlete[]; coaches: Coach[]; leaders: TeamLeader[];
  onEdit: (type: 'athlete' | 'coach' | 'leader', data: any) => void;
  onDelete: (target: { type: string; id: string; name: string } | null) => void;
}) {
  const unassignedAthletes = athletes.filter(a => !a.teamProfileId);
  const unassignedCoaches = coaches.filter(c => !c.teamProfileId);
  const unassignedLeaders = leaders.filter(l => !l.teamProfileId);
  const hasAny = unassignedAthletes.length + unassignedCoaches.length + unassignedLeaders.length > 0;
  if (!hasAny) return null;

  return (
    <div className="bg-white rounded-lg border border-dashed border-slate-200 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
          <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-slate-500">未分配队伍的人员</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {unassignedAthletes.length > 0 && <Badge className="bg-blue-50 text-blue-500 border-0">{unassignedAthletes.length} 人</Badge>}
          {unassignedCoaches.length > 0 && <Badge className="bg-emerald-50 text-emerald-500 border-0">{unassignedCoaches.length} 教</Badge>}
          {unassignedLeaders.length > 0 && <Badge className="bg-violet-50 text-violet-500 border-0">{unassignedLeaders.length} 领</Badge>}
        </div>
      </div>
      <div className="border-t border-slate-100 px-3 py-2 space-y-1">
        {unassignedAthletes.map(a => (
          <PersonRow key={a.id} item={a} type="athlete" onEdit={() => onEdit('athlete', a)} onDelete={() => onDelete({ type: 'athlete', id: a.id, name: a.name })} />
        ))}
        {unassignedCoaches.map(c => (
          <PersonRow key={c.id} item={c} type="coach" onEdit={() => onEdit('coach', c)} onDelete={() => onDelete({ type: 'coach', id: c.id, name: c.name })} />
        ))}
        {unassignedLeaders.map(l => (
          <PersonRow key={l.id} item={l} type="leader" onEdit={() => onEdit('leader', l)} onDelete={() => onDelete({ type: 'leader', id: l.id, name: l.name })} />
        ))}
      </div>
    </div>
  );
}

function EditClubDialog({ club, form, setForm, onClose, onSave }: {
  club: ClubAccount | null; form: any; setForm: (f: any) => void; onClose: () => void; onSave: () => void;
}) {
  return (
    <Dialog open={!!club} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>编辑账号信息</DialogTitle>
          <DialogDescription>修改注册账号的基本信息</DialogDescription>
        </DialogHeader>
        {form && club && (
          <div className="space-y-3 py-2">
            <div>
              <Label>参赛单位名称</Label>
              <Input className="mt-1" value={form.clubName} onChange={e => setForm((p: any) => ({ ...p, clubName: e.target.value }))} />
            </div>
            <div>
              <Label>登录用户名</Label>
              <Input className="mt-1 bg-slate-50" value={club.username} disabled />
              <p className="text-[10px] text-slate-400 mt-0.5">用户名不可修改</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>联系人</Label>
                <Input className="mt-1" value={form.contactName} onChange={e => setForm((p: any) => ({ ...p, contactName: e.target.value }))} />
              </div>
              <div>
                <Label>联系电话</Label>
                <Input className="mt-1" value={form.phone} onChange={e => setForm((p: any) => ({ ...p, phone: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>省份</Label>
                <Input className="mt-1" value={form.province} onChange={e => setForm((p: any) => ({ ...p, province: e.target.value }))} placeholder="如：广东省" />
              </div>
              <div>
                <Label>城市</Label>
                <Input className="mt-1" value={form.city} onChange={e => setForm((p: any) => ({ ...p, city: e.target.value }))} placeholder="如：深圳市" />
              </div>
            </div>
            <div>
              <Label>邮箱（选填）</Label>
              <Input className="mt-1" type="email" value={form.email} onChange={e => setForm((p: any) => ({ ...p, email: e.target.value }))} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={onSave} className="bg-blue-600 hover:bg-blue-700 text-white">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteClubDialog({ club, confirmText, setConfirmText, step, onClose, onConfirm, getStats }: {
  club: ClubAccount | null; confirmText: string; setConfirmText: (t: string) => void;
  step: 'confirm' | 'progress'; onClose: () => void; onConfirm: () => void;
  getStats: (id: string) => { athletes: number; coaches: number; leaders: number; teams: number };
}) {
  const stats = club ? getStats(club.id) : { athletes: 0, coaches: 0, leaders: 0, teams: 0 };
  const hasData = stats.athletes + stats.coaches + stats.leaders + stats.teams > 0;

  return (
    <Dialog open={!!club} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600"><AlertTriangle className="w-5 h-5" />注销账号</DialogTitle>
        </DialogHeader>
        {club && step === 'confirm' && (
          <div className="space-y-4 py-2">
            <div className="p-3 bg-red-50 rounded-lg border border-red-100">
              <p className="text-sm font-medium text-red-700">即将注销以下账号及其所有关联数据：</p>
              <p className="text-sm font-bold text-red-800 mt-1">{club.clubName}</p>
            </div>
            <div className="text-sm text-slate-600 space-y-1">
              <p>该账号下将一并清除：</p>
              <ul className="ml-4 list-disc space-y-0.5 text-slate-500">
                <li>所有创建的队伍</li>
                <li>所有运动员数据</li>
                <li>所有教练员数据</li>
                <li>所有领队数据</li>
                <li>所有报名记录</li>
              </ul>
            </div>
            {hasData && (
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-100">
                <p className="text-xs text-amber-700">当前关联 {stats.teams} 个队伍、{stats.athletes} 名运动员、{stats.coaches} 名教练、{stats.leaders} 名领队</p>
                <div className="mt-2">
                  <Label className="text-xs text-slate-600">请输入 <strong>"确认注销"</strong> 以继续</Label>
                  <Input className="mt-1" placeholder="确认注销" value={confirmText} onChange={e => setConfirmText(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}
        {club && step === 'progress' && (
          <div className="py-8 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"></div>
            <p className="text-sm text-slate-600">正在注销账号并清除关联数据...</p>
          </div>
        )}
        {step === 'confirm' && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button variant="destructive" onClick={onConfirm} disabled={hasData && confirmText !== '确认注销'}>确认注销</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditPersonDialog({ type, data, setData, avatarPreview, avatarFile, avatarUploading, onClose, onSave, onAvatarChange, onClearAvatar }: {
  type: 'athlete' | 'coach' | 'leader' | null; data: any; setData: (d: any) => void;
  avatarPreview: string | null; avatarFile: File | null; avatarUploading: boolean;
  onClose: () => void; onSave: () => void;
  onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void; onClearAvatar: () => void;
}) {
  return (
    <Dialog open={!!type} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{type === 'athlete' ? '编辑运动员' : type === 'coach' ? '编辑教练员' : '编辑领队'}</DialogTitle>
        </DialogHeader>

        {type === 'athlete' && data && (
          <div className="space-y-3 py-2">
            <div className="flex flex-col items-center gap-2">
              <div className="relative group">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="运动员照片" className="w-24 h-24 rounded-full object-cover border-2 border-slate-200 shadow-sm" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-slate-300" />
                  </div>
                )}
                <label className="absolute bottom-0 right-0 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center cursor-pointer shadow hover:bg-blue-700 transition-colors">
                  <Camera className="w-3.5 h-3.5 text-white" />
                  <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={onAvatarChange} />
                </label>
                {avatarPreview && (
                  <button onClick={onClearAvatar} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white shadow hover:bg-red-600 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400">免冠照片（JPG/PNG，≤2MB）</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>姓名 *</Label>
                <Input className="mt-1" value={data.name} onChange={e => setData((p: any) => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <Label>性别</Label>
                <Select value={data.gender} onValueChange={v => setData((p: any) => ({ ...p, gender: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">男</SelectItem>
                    <SelectItem value="female">女</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>出生日期 *</Label>
              <Input className="mt-1" type="date" value={data.birthDate} onChange={e => setData((p: any) => ({ ...p, birthDate: e.target.value }))} />
            </div>
            <div>
              <Label>身份证号 *</Label>
              <Input className="mt-1" value={data.idCard} onChange={e => setData((p: any) => ({ ...p, idCard: e.target.value }))} />
            </div>
          </div>
        )}

        {type === 'coach' && data && (
          <div className="space-y-3 py-2">
            <div><Label>姓名 *</Label><Input className="mt-1" value={data.name} onChange={e => setData((p: any) => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>联系电话 *</Label><Input className="mt-1" value={data.phone} onChange={e => setData((p: any) => ({ ...p, phone: e.target.value }))} /></div>
          </div>
        )}

        {type === 'leader' && data && (
          <div className="space-y-3 py-2">
            <div><Label>姓名 *</Label><Input className="mt-1" value={data.name} onChange={e => setData((p: any) => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>联系电话 *</Label><Input className="mt-1" value={data.phone} onChange={e => setData((p: any) => ({ ...p, phone: e.target.value }))} /></div>
            <div><Label>职位 *</Label><Input className="mt-1" value={data.position} onChange={e => setData((p: any) => ({ ...p, position: e.target.value }))} placeholder="如：领队、副领队" /></div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={onSave} disabled={avatarUploading} className="bg-blue-600 hover:bg-blue-700 text-white">
            {avatarUploading ? '上传中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
