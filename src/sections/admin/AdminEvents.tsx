import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Edit2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { eventStore, groupStore } from '@/lib/store';
import {
  PRESET_COMBINED_GROUPS,
  PRESET_EVENTS,
  getEventCategoryTree,
  detectNamingSystem,
  type CombinedGroupPreset,
  type PresetEvent,
} from '@/lib/presets';
import type { Event, EventGroup } from '@/types';

export default function AdminEvents({ competitionId }: { competitionId: string }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [groupMap, setGroupMap] = useState<Record<string, EventGroup[]>>({});

  // ====== 预设选择状态 ======
  // 分组预设对话框
  const [grpDialog, setGrpDialog] = useState(false);
  const [grpEventId, setGrpEventId] = useState('');
  const [grpEdit, setGrpEdit] = useState<EventGroup | null>(null);
  // 编辑模式的表单（只保留名称和出场顺序；限报在「限报配置」单独设置）
  const [grpEditForm, setGrpEditForm] = useState({ name: '', orderIndex: 0 });
  // 预设勾选：{ age_1: true, age_2: true, gender_m: true, ... }
  const [selGroupPresets, setSelGroupPresets] = useState<Record<string, boolean>>({});
  // 命名体系选择（'zh' 中文 / 'u' U系列）；赛事已有分组时会被自动锁定
  const [manualNamingSystem, setManualNamingSystem] = useState<'zh' | 'u'>('zh');

  // 项目预设对话框
  const [evDialog, setEvDialog] = useState(false);
  const [evEdit, setEvEdit] = useState<Event | null>(null);
  // 编辑模式的表单
  const [evEditForm, setEvEditForm] = useState({ name: '', code: '', category: '', maxAthletes: 1, orderIndex: 0, description: '' });
  // 预设勾选
  const [selEventPresets, setSelEventPresets] = useState<Record<string, boolean>>({});

  // 保存状态
  const [savingEvents, setSavingEvents] = useState(false);
  const [savingGroups, setSavingGroups] = useState(false);
  // 删除确认弹窗
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);

  // 展开的类别（项目 / 分组）
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [expandedGroupCats, setExpandedGroupCats] = useState<Record<string, boolean>>({ male: true, female: true, mixed: true, standalone: true, none: true });

  useEffect(() => {
    if (!competitionId) return;
    eventStore.getByCompetition(competitionId).then(evs => {
      const sorted = [...evs].sort((a, b) => a.orderIndex - b.orderIndex);
      setEvents(sorted);
      const gm: Record<string, EventGroup[]> = {};
      const groupPromises = sorted.map(e =>
        groupStore.getByEvent(e.id).then(grps => {
          gm[e.id] = [...grps].sort((a, b) => a.orderIndex - b.orderIndex);
        })
      );
      Promise.all(groupPromises).then(() => setGroupMap(gm));
    });
  }, [competitionId, evDialog, grpDialog]);

  const loadGroups = useCallback(() => {
    const gm: Record<string, EventGroup[]> = {};
    const groupPromises = events.map(e =>
      groupStore.getByEvent(e.id).then(grps => {
        gm[e.id] = [...grps].sort((a, b) => a.orderIndex - b.orderIndex);
      })
    );
    Promise.all(groupPromises).then(() => setGroupMap(gm));
  }, [events]);

  // ====== 事件操作 ======

  // 打开项目预设对话框
  const openEvPresetDialog = () => {
    setEvEdit(null);
    setSelEventPresets({});
    setEvDialog(true);
  };

  // 编辑已有项目（简化表单）
  const openEvEditDialog = (ev: Event) => {
    setEvEdit(ev);
    setEvEditForm({
      name: ev.name,
      code: ev.code,
      category: ev.category,
      maxAthletes: ev.maxAthletes,
      orderIndex: ev.orderIndex,
      description: ev.description || '',
    });
    setEvDialog(true);
  };

  // 保存项目（编辑模式）
  const saveEventEdit = async () => {
    if (!evEditForm.name || !competitionId || !evEdit) return;
    try {
      await eventStore.update(evEdit.id, evEditForm);
      setEvDialog(false);
      toast.success('项目已更新');
    } catch (err: any) {
      toast.error('保存失败：' + (err?.message || '未知错误'));
    }
  };

  // 批量添加预设项目
  const savePresetEvents = async () => {
    const selectedIds = Object.entries(selEventPresets)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (selectedIds.length === 0) return;

    const selectedEvents = PRESET_EVENTS.filter(ev =>
      selectedIds.includes(ev.id) && !alreadyAddedEventCodes.has(ev.code)
    );
    if (selectedEvents.length === 0) {
      toast('所选项目均已添加，无需重复添加');
      return;
    }

    setSavingEvents(true);
    try {
      let orderIndex = events.length;
      for (const pe of selectedEvents) {
        await eventStore.create({
          competitionId: competitionId,
          name: pe.name,
          code: pe.code,
          category: pe.category,
          description: pe.description || pe.note || '',
          maxAthletes: pe.maxAthletes,
          isIndividual: pe.isIndividual,
          orderIndex: orderIndex++,
        });
      }
      setEvDialog(false);
      toast.success(`成功添加 ${selectedEvents.length} 个项目`);
    } catch (err: any) {
      toast.error('添加失败：' + (err?.message || '未知错误'));
    } finally {
      setSavingEvents(false);
    }
  };

  // 删除项目（含级联删除分组）
  const deleteEvent = (id: string) => setDeleteEventId(id);
  const confirmDeleteEvent = async () => {
    if (!deleteEventId) return;
    try {
      const grps = await groupStore.getByEvent(deleteEventId);
      for (const g of grps) await groupStore.delete(g.id);
      await eventStore.delete(deleteEventId);
      setEvents(prev => prev.filter(e => e.id !== deleteEventId));
      toast.success('项目已删除');
    } catch (err: any) {
      toast.error('删除失败：' + (err?.message || '未知错误'));
    }
    setDeleteEventId(null);
  };

  // ====== 分组操作 ======

  // 打开分组预设对话框
  const openGrpPresetDialog = (eventId: string) => {
    setGrpEventId(eventId);
    setGrpEdit(null);
    setSelGroupPresets({});
    setGrpDialog(true);
  };

  // 编辑已有分组
  const openGrpEditDialog = (eventId: string, grp: EventGroup) => {
    setGrpEventId(eventId);
    setGrpEdit(grp);
    setGrpEditForm({
      name: grp.name,
      orderIndex: grp.orderIndex,
    });
    setGrpDialog(true);
  };

  // 保存分组编辑
  const saveGroupEdit = async () => {
    if (!grpEditForm.name || !grpEdit) return;
    try {
      await groupStore.update(grpEdit.id, {
        name: grpEditForm.name,
        orderIndex: grpEditForm.orderIndex,
      });
      setGrpDialog(false);
      loadGroups();
      toast.success('分组已更新');
    } catch (err: any) {
      toast.error('保存失败：' + (err?.message || '未知错误'));
    }
  };

  // 批量添加预设分组（组合式：年龄+性别），自动去重
  const savePresetGroups = async () => {
    const selectedIds = Object.entries(selGroupPresets)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (selectedIds.length === 0) return;

    // 只取当前体系（或通用）的分组，避免两套命名混用
    const selected = visibleCombinedGroups.filter(g =>
      selectedIds.includes(g.id) && !alreadyAddedGroupNames.has(g.name)
    );
    if (selected.length === 0) {
      toast('所选分组均已添加，无需重复添加');
      return;
    }

    // 兜底校验：确保没有混入另一套体系（防止旧勾选状态残留）
    const conflicting = selected.filter(
      g => g.namingSystem !== 'common' && g.namingSystem !== activeNamingSystem,
    );
    if (conflicting.length > 0) {
      toast.error(`命名体系冲突：不能同时添加「${conflicting[0].name}」等另一套体系的分组`);
      return;
    }

    setSavingGroups(true);
    try {
      const existingGroups = groupMap[grpEventId] || [];
      let orderIdx = existingGroups.length;

      for (const pg of selected) {
        await groupStore.create({
          eventId: grpEventId,
          name: pg.name,
          type: pg.type,
          gender: pg.gender,
          ageMin: pg.ageMin,
          ageMax: pg.ageMax,
          // maxRegistrations 沿用数据库 DEFAULT 20，后续在「限报配置」单独设置
          currentCount: 0,
          orderIndex: orderIdx++,
        });
      }
      setGrpDialog(false);
      loadGroups();
      toast.success(`成功添加 ${selected.length} 个分组`);
    } catch (err: any) {
      toast.error('添加失败：' + (err?.message || '未知错误'));
    } finally {
      setSavingGroups(false);
    }
  };

  // 删除分组
  const deleteGroup = (id: string) => setDeleteGroupId(id);
  const confirmDeleteGroup = async () => {
    if (!deleteGroupId) return;
    try {
      await groupStore.delete(deleteGroupId);
      loadGroups();
      toast.success('分组已删除');
    } catch (err: any) {
      toast.error('删除失败：' + (err?.message || '未知错误'));
    }
    setDeleteGroupId(null);
  };

  // ====== 勾选辅助函数 ======
  const toggleGroupPreset = (id: string) => {
    setSelGroupPresets(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEventPreset = (id: string) => {
    setSelEventPresets(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const selectAllInCategory = (category: string, subCategory: string, evts: PresetEvent[]) => {
    setSelEventPresets(prev => {
      const next = { ...prev };
      const available = evts.filter(ev => !alreadyAddedEventCodes.has(ev.code));
      const allSelected = available.every(ev => prev[ev.id]);
      const action = !allSelected;
      for (const ev of available) next[ev.id] = action;
      return next;
    });
  };

  const selectAllGroupsInCategory = (category: 'male' | 'female' | 'mixed' | 'standalone' | 'none') => {
    setSelGroupPresets(prev => {
      const next = { ...prev };
      const groups = visibleCombinedGroups.filter(g => {
        if (category === 'standalone') return g.isStandalone && !alreadyAddedGroupNames.has(g.name);
        if (category === 'mixed') return g.gender === 'mixed' && !alreadyAddedGroupNames.has(g.name);
        if (category === 'none') return g.type === 'age' && !g.gender && !g.isStandalone && !alreadyAddedGroupNames.has(g.name);
        return g.gender === category && !alreadyAddedGroupNames.has(g.name);
      });
      const allSelected = groups.every(g => prev[g.id]);
      for (const g of groups) next[g.id] = !allSelected;
      return next;
    });
  };

  // 计算选中数量
  const selectedGroupCount = Object.values(selGroupPresets).filter(Boolean).length;
  const selectedEventCount = Object.values(selEventPresets).filter(Boolean).length;

  // ---- 命名体系互斥：同一场比赛只能用一套（中文 / U 系列）----
  // 汇总该赛事下所有已有分组名（跨项目），据此锁定体系
  const allGroupNamesInComp = useMemo(
    () => Object.values(groupMap).flat().map(g => g.name),
    [groupMap],
  );
  const lockedNamingSystem = useMemo(
    () => detectNamingSystem(allGroupNamesInComp),
    [allGroupNamesInComp],
  );
  // 实际生效的体系：赛事已锁定则用锁定的，否则用用户当前选择的
  const activeNamingSystem = lockedNamingSystem || manualNamingSystem;
  // 可见的预设分组：只显示当前体系 + 通用组别
  const visibleCombinedGroups = useMemo(
    () => PRESET_COMBINED_GROUPS.filter(
      g => g.namingSystem === 'common' || g.namingSystem === activeNamingSystem,
    ),
    [activeNamingSystem],
  );

  // ---- 去重：已添加的项目 / 分组 ----
  const alreadyAddedEventCodes = new Set(events.map(e => e.code));
  const alreadyAddedGroupNames = new Set((groupMap[grpEventId] || []).map(g => g.name));

  // 可用（未添加）的预设项
  const availableEvents = PRESET_EVENTS.filter(ev => !alreadyAddedEventCodes.has(ev.code));
  const availableGroups = visibleCombinedGroups.filter(g => !alreadyAddedGroupNames.has(g.name));
  const alreadyAddedEventCount = PRESET_EVENTS.length - availableEvents.length;
  const alreadyAddedGroupCount = visibleCombinedGroups.length - availableGroups.length;

  // 项目分类树
  const eventTree = getEventCategoryTree();

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">项目 & 分组管理</h2>
          <p className="text-slate-400 text-sm mt-0.5">从竞赛预设中勾选项目与分组，快速配置</p>
        </div>
      </div>

      {/* 项目列表 */}
      {competitionId && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold text-slate-700">竞赛项目</span>
              <span className="text-xs text-slate-400 ml-2">{events.length} 项</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={openEvPresetDialog} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
                <Plus className="w-3.5 h-3.5" />从预设添加项目
              </Button>
            </div>
          </div>

          {events.length === 0 ? (
            <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
              暂无项目，点击「从预设添加项目」开始配置
            </div>
          ) : (
            events.map(ev => (
              <EventListCard
                key={ev.id}
                event={ev}
                groups={groupMap[ev.id] || []}
                expanded={expandedEvent === ev.id}
                onToggleExpand={() => setExpandedEvent(prev => prev === ev.id ? null : ev.id)}
                onAddGroups={() => openGrpPresetDialog(ev.id)}
                onEditEvent={() => openEvEditDialog(ev)}
                onDeleteEvent={() => deleteEvent(ev.id)}
                onEditGroup={(g) => openGrpEditDialog(ev.id, g)}
                onDeleteGroup={deleteGroup}
              />
            ))
          )}
        </div>
      )}

      {/* ====================== 项目预设对话框 ====================== */}
      <Dialog open={evDialog} onOpenChange={setEvDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>{evEdit ? '编辑项目' : '从预设选择竞赛项目'}</DialogTitle>
            {!evEdit && (
              <p className="text-sm text-slate-500 mt-1">
                勾选需要添加的项目，已选中 <span className="font-semibold text-blue-600">{selectedEventCount}</span> 项
                {alreadyAddedEventCount > 0 && (
                  <span className="text-slate-400 ml-1">（已添加 <span className="font-semibold">{alreadyAddedEventCount}</span> 项）</span>
                )}
              </p>
            )}
          </DialogHeader>

          {evEdit ? (
            /* ---- 编辑模式 ---- */
            <div className="space-y-3 py-2">
              <div><Label>项目名称 *</Label><Input className="mt-1" value={evEditForm.name} onChange={e => setEvEditForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>项目编码</Label><Input className="mt-1" value={evEditForm.code} onChange={e => setEvEditForm(p => ({ ...p, code: e.target.value }))} /></div>
                <div><Label>项目类别</Label><Input className="mt-1" value={evEditForm.category} onChange={e => setEvEditForm(p => ({ ...p, category: e.target.value }))} /></div>
              </div>
            </div>
          ) : (
            /* ---- 预设勾选模式 ---- */
            <ScrollArea className="h-[55vh] pr-2">
              <div className="space-y-4 py-1">
                {Object.entries(eventTree).map(([category, subCats]) => {
                  const catEvents = Object.values(subCats).flat();
                  const catAvailable = catEvents.filter(ev => !alreadyAddedEventCodes.has(ev.code));
                  const catSelected = catAvailable.filter(ev => selEventPresets[ev.id]).length;
                  const catAdded = catEvents.length - catAvailable.length;
                  const catKey = `cat_${category}`;
                  const isExpanded = expandedCategories[catKey] !== false;

                  return (
                    <div key={category} className="border border-slate-200 rounded-xl overflow-hidden">
                      {/* 类别标题 */}
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                        onClick={() => setExpandedCategories(prev => ({ ...prev, [catKey]: !isExpanded }))}
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                        <span className="font-semibold text-slate-800">{category}</span>
                        <Badge className="text-xs bg-blue-50 text-blue-600 border-0 ml-auto">{catSelected}/{catAvailable.length}</Badge>
                        {catAdded > 0 && <Badge className="text-xs bg-slate-100 text-slate-400 border-0">已添加 {catAdded}</Badge>}
                      </button>

                      {isExpanded && (
                        <div className="px-4 py-3 space-y-3">
                          {Object.entries(subCats).map(([subName, evts]) => {
                            const subAvailable = evts.filter(ev => !alreadyAddedEventCodes.has(ev.code));
                            const subAdded = evts.length - subAvailable.length;
                            return (
                            <div key={subName}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-slate-600">{subName}</span>
                                <div className="flex items-center gap-1.5">
                                  {subAvailable.length > 0 && (
                                    <button
                                      type="button"
                                      className="text-xs text-blue-600 hover:text-blue-700"
                                      onClick={() => selectAllInCategory(category, subName, subAvailable)}
                                    >
                                      {subAvailable.every(ev => selEventPresets[ev.id]) ? '取消全选' : '全选'}
                                    </button>
                                  )}
                                  {subAdded > 0 && <span className="text-xs text-slate-400">已添加 {subAdded}</span>}
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                {evts.map(ev => {
                                  const isAdded = alreadyAddedEventCodes.has(ev.code);
                                  return (
                                  <label
                                    key={ev.id}
                                    className={`flex items-start gap-2 px-2.5 py-2 rounded-lg transition-colors
                                      ${isAdded ? 'bg-slate-50 border border-slate-200 cursor-not-allowed opacity-60' :
                                        selEventPresets[ev.id] ? 'bg-blue-50 border border-blue-200 cursor-pointer' : 'hover:bg-slate-50 border border-transparent cursor-pointer'}`}
                                  >
                                    <Checkbox
                                      checked={isAdded ? true : (selEventPresets[ev.id] || false)}
                                      disabled={isAdded}
                                      onCheckedChange={isAdded ? undefined : () => toggleEventPreset(ev.id)}
                                      className="mt-0.5 shrink-0"
                                    />
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm text-slate-700 truncate">{ev.name}</span>
                                        {isAdded && <Badge className="text-[10px] bg-green-50 text-green-600 border-green-200 shrink-0">已添加</Badge>}
                                      </div>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <code className="text-[10px] bg-slate-100 px-1 rounded text-slate-500">{ev.code}</code>
                                        <span className="text-[10px] text-slate-400">{ev.maxAthletes}人</span>
                                        {ev.note && <span className="text-[10px] text-amber-500">{ev.note}</span>}
                                        {ev.description && <span className="text-[10px] text-slate-400">({ev.description})</span>}
                                      </div>
                                    </div>
                                  </label>
                                  );
                                })}
                              </div>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setEvDialog(false)}>取消</Button>
            {evEdit ? (
              <Button onClick={saveEventEdit} className="bg-blue-600 hover:bg-blue-700 text-white">保存修改</Button>
            ) : (
              <Button onClick={savePresetEvents} disabled={selectedEventCount === 0 || savingEvents} className="bg-blue-600 hover:bg-blue-700 text-white">
                {savingEvents ? '添加中...' : `添加选中项目（${selectedEventCount}）`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ====================== 分组预设对话框 ====================== */}
      <Dialog open={grpDialog} onOpenChange={setGrpDialog}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle>{grpEdit ? '编辑分组' : '从预设选择分组'}</DialogTitle>
            {!grpEdit && (
              <p className="text-sm text-slate-500 mt-1">
                勾选需要的分组，已选中 <span className="font-semibold text-blue-600">{selectedGroupCount}</span> 组
                {alreadyAddedGroupCount > 0 && (
                  <span className="text-slate-400 ml-1">（已添加 <span className="font-semibold">{alreadyAddedGroupCount}</span> 组）</span>
                )}
              </p>
            )}
          </DialogHeader>

          {grpEdit ? (
            /* ---- 编辑模式 ---- */
            <div className="space-y-3 py-2">
              <div><Label>分组名称 *</Label><Input className="mt-1" value={grpEditForm.name} onChange={e => setGrpEditForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><Label>出场顺序</Label><Input className="mt-1" type="number" min={0} value={grpEditForm.orderIndex} onChange={e => setGrpEditForm(p => ({ ...p, orderIndex: +e.target.value }))} /></div>
              <p className="text-xs text-slate-400">限报规则在「限报配置」页单独设置</p>
            </div>
          ) : (
            /* ---- 预设勾选模式（折叠面板，与项目对话框风格一致） ---- */
            <>
            {/* 命名体系切换（同一场比赛只能用一套） */}
            <div className="shrink-0 mb-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500">命名体系</span>
                {([['zh', '中文命名'], ['u', 'U 系列命名']] as const).map(([sys, label]) => {
                  const disabled = lockedNamingSystem !== null && lockedNamingSystem !== sys;
                  const active = activeNamingSystem === sys;
                  return (
                    <button
                      key={sys}
                      type="button"
                      disabled={disabled}
                      onClick={() => { setManualNamingSystem(sys); setSelGroupPresets({}); }}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'
                      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                      title={disabled ? '本场比赛已使用另一套命名体系，不能混用' : undefined}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">
                {lockedNamingSystem
                  ? `本场赛事已使用「${lockedNamingSystem === 'u' ? 'U 系列命名' : '中文命名'}」，不能混用另一套。如需切换，请先删除现有年龄分组。`
                  : '同一场比赛只能使用一套命名体系，选定后不可混用。'}
              </p>
            </div>

            {/* 提示 */}
            <p className="text-xs text-slate-400 mb-2 shrink-0">
              已选中 <span className="font-semibold text-blue-600">{selectedGroupCount}</span> 组，共 {availableGroups.length} 组可选
              {alreadyAddedGroupCount > 0 && <span className="ml-1">（已添加 <span className="font-semibold">{alreadyAddedGroupCount}</span> 组）</span>}
            </p>

            {/* 原生 overflow-y-auto，替代 Radix ScrollArea（在 flex 嵌套中其 Viewport 无法正确继承高度） */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-2">
                <div className="space-y-3 py-1">
                  {[
                    { key: 'male', label: '男子组', color: 'blue', groups: visibleCombinedGroups.filter(g => g.gender === 'male') },
                    { key: 'female', label: '女子组', color: 'pink', groups: visibleCombinedGroups.filter(g => g.gender === 'female') },
                    { key: 'mixed', label: '混合组', color: 'amber', groups: visibleCombinedGroups.filter(g => g.gender === 'mixed'), subtitle: '男女混合' },
                    { key: 'standalone', label: '亲子组', color: 'purple', groups: visibleCombinedGroups.filter(g => g.isStandalone && g.id !== 'comb_none'), subtitle: '不区分性别' },
                    { key: 'none', label: '不分组别', color: 'slate', groups: visibleCombinedGroups.filter(g => g.id === 'comb_none'), subtitle: '不区分年龄和性别' },
                  ].filter(cat => cat.groups.length > 0).map(cat => {
                    const avail = cat.groups.filter(g => !alreadyAddedGroupNames.has(g.name));
                    const added = cat.groups.length - avail.length;
                    const sel = cat.groups.filter(g => selGroupPresets[g.id]).length;
                    const isExpanded = expandedGroupCats[cat.key] !== false;

                    return (
                    <div key={cat.key} className="border border-slate-200 rounded-xl overflow-hidden">
                      {/* 类别标题 */}
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                        onClick={() => setExpandedGroupCats(prev => ({ ...prev, [cat.key]: !isExpanded }))}
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          cat.key === 'male' ? 'bg-blue-400' :
                          cat.key === 'female' ? 'bg-pink-400' :
                          cat.key === 'mixed' ? 'bg-amber-400' :
                          cat.key === 'none' ? 'bg-slate-400' :
                          'bg-purple-400'
                        }`} />
                        <span className="font-semibold text-slate-800">{cat.label}</span>
                        {cat.subtitle && <span className="text-xs text-slate-400 ml-0.5">{cat.subtitle}</span>}
                        <Badge className="text-xs bg-blue-50 text-blue-600 border-0 ml-auto">{sel}/{avail.length}</Badge>
                        {added > 0 && <Badge className="text-xs bg-slate-100 text-slate-400 border-0 ml-0.5">已添加 {added}</Badge>}
                      </button>

                      {/* 全选操作行 */}
                      <div className="flex justify-end px-4 py-1.5 border-b border-slate-100">
                        {avail.length > 0 ? (
                          <button type="button" className="text-xs text-blue-600 hover:text-blue-700" onClick={() => selectAllGroupsInCategory(cat.key as 'male' | 'female' | 'mixed' | 'standalone' | 'none')}>
                            {avail.every(g => selGroupPresets[g.id]) ? '取消全选' : '全选'}
                          </button>
                        ) : (
                          <span className="text-xs text-green-500">已全部添加</span>
                        )}
                      </div>

                      {isExpanded && (
                        <div className="px-3 py-2.5">
                          <div className="grid grid-cols-2 gap-1.5">
                            {cat.groups.map(g => {
                              const isAdded = alreadyAddedGroupNames.has(g.name);
                              return (
                              <label
                                key={g.id}
                                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors
                                  ${isAdded ? 'bg-slate-50 border border-slate-200 cursor-not-allowed opacity-60' :
                                    selGroupPresets[g.id] ? 'bg-blue-50 border border-blue-200 cursor-pointer' : 'hover:bg-slate-50 border border-transparent cursor-pointer'}`}
                              >
                                <Checkbox
                                  checked={isAdded ? true : (selGroupPresets[g.id] || false)}
                                  disabled={isAdded}
                                  onCheckedChange={isAdded ? undefined : () => toggleGroupPreset(g.id)}
                                  className="shrink-0"
                                />
                                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                  <span className="text-sm text-slate-700 truncate">{g.name}</span>
                                  {isAdded && <Badge className="text-[10px] bg-green-50 text-green-600 border-green-200 shrink-0">已添加</Badge>}
                                </div>
                                <span className="text-xs text-slate-400 shrink-0">{g.description}</span>
                              </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>

            </>
          )}

          <DialogFooter className="shrink-0 mt-2">
            <Button variant="outline" onClick={() => setGrpDialog(false)}>取消</Button>
            {grpEdit ? (
              <Button onClick={saveGroupEdit} className="bg-blue-600 hover:bg-blue-700 text-white">保存修改</Button>
            ) : (
              <Button onClick={savePresetGroups} disabled={selectedGroupCount === 0 || savingGroups} className="bg-blue-600 hover:bg-blue-700 text-white">
                {savingGroups ? '添加中...' : `添加选中分组（${selectedGroupCount}）`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除项目确认 */}
      <AlertDialog open={!!deleteEventId} onOpenChange={() => setDeleteEventId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除项目？</AlertDialogTitle>
            <AlertDialogDescription>
              项目删除后，其下所有分组也将被删除，此操作不可撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteEvent} className="bg-red-600 hover:bg-red-700">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除分组确认 */}
      <AlertDialog open={!!deleteGroupId} onOpenChange={() => setDeleteGroupId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除分组？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后已报名该分组的记录不会被自动删除，但将无法继续报名此分组。此操作不可撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteGroup} className="bg-red-600 hover:bg-red-700">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// 子组件（按职责拆分；同文件内联以保留 AdminPersonnel 风格的内聚性）
// ============================================================================

/**
 * 事件列表卡片（单事件行 + 展开后的分组网格）
 *
 * 数据与回调由父组件传入——本组件为纯渲染。
 * 4 个 Dialog 的内部状态保留在主组件（批次 3 再做 Dialog 拆分）。
 */
interface EventListCardProps {
  event: Event;
  groups: EventGroup[];
  expanded: boolean;
  onToggleExpand: () => void;
  onAddGroups: () => void;
  onEditEvent: () => void;
  onDeleteEvent: () => void;
  onEditGroup: (group: EventGroup) => void;
  onDeleteGroup: (groupId: string) => void;
}

function EventListCard({
  event, groups, expanded,
  onToggleExpand, onAddGroups, onEditEvent, onDeleteEvent,
  onEditGroup, onDeleteGroup,
}: EventListCardProps) {
  return (
    <Card className="bg-white border-0 shadow-sm">
      <CardHeader className="py-0">
        <div className="flex items-center gap-3 py-3.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-sm shrink-0">
            {event.orderIndex + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-800">{event.name}</span>
              <Badge variant="outline" className="text-xs text-slate-500">{event.code}</Badge>
              <Badge className="text-xs bg-blue-50 text-blue-600 border-0">{event.category}</Badge>
              {event.description && <span className="text-xs text-slate-400">({event.description})</span>}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {groups.length} 个分组
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" variant="ghost" onClick={onAddGroups} className="text-xs gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50">
              <Plus className="w-3.5 h-3.5" />预设分组
            </Button>
            <Button size="sm" variant="ghost" onClick={onEditEvent} className="text-slate-500 hover:text-slate-700">
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDeleteEvent} className="text-red-400 hover:text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onToggleExpand}>
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 pb-3 px-4">
          <Separator className="mb-3" />
          {groups.length === 0 ? (
            <div className="text-center py-4 text-slate-400 text-sm">
              暂无分组，点击「预设分组」快速添加
            </div>
          ) : (
            <GroupGridCard groups={groups} onEditGroup={onEditGroup} onDeleteGroup={onDeleteGroup} />
          )}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * 分组网格卡片（展开后展示该事件下所有分组）
 */
interface GroupGridCardProps {
  groups: EventGroup[];
  onEditGroup: (group: EventGroup) => void;
  onDeleteGroup: (groupId: string) => void;
}

function GroupGridCard({ groups, onEditGroup, onDeleteGroup }: GroupGridCardProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {groups.map(g => (
        <div key={g.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2.5">
          <div className={`w-2 h-2 rounded-full shrink-0 ${g.gender === 'male' ? 'bg-blue-400' : g.gender === 'female' ? 'bg-pink-400' : g.type === 'age' ? 'bg-amber-400' : 'bg-purple-400'}`} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-700 truncate">{g.name}</div>
          </div>
          <div className="flex gap-1">
            <button onClick={() => onEditGroup(g)} className="p-1 text-slate-400 hover:text-slate-600">
              <Edit2 className="w-3 h-3" />
            </button>
            <button onClick={() => onDeleteGroup(g.id)} className="p-1 text-slate-400 hover:text-red-500">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
