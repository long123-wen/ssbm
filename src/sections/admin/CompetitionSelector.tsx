import { useState, useEffect } from 'react';
import { Trophy, Calendar, MapPin, ChevronRight, LogOut, Plus, Pencil, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { competitionStore, adminAuth } from '@/lib/store';
import { toast } from 'sonner';
import type { Competition } from '@/types';

interface Props {
  onSelect: (comp: Competition) => void;
  onLogout: () => void;
}

const statusMap: Record<string, { label: string; cls: string }> = {
  draft: { label: '草稿', cls: 'bg-slate-100 text-slate-600' },
  open: { label: '报名中', cls: 'bg-green-100 text-green-700' },
  closed: { label: '已截止', cls: 'bg-amber-100 text-amber-700' },
  completed: { label: '已结束', cls: 'bg-blue-100 text-blue-700' },
};

const emptyForm = {
  name: '', subtitle: '', venue: '', startDate: '', endDate: '',
  registrationDeadline: '', status: 'draft' as Competition['status'], description: '',
};

export default function CompetitionSelector({ onSelect, onLogout }: Props) {
  const [comps, setComps] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建 / 编辑 共用弹窗
  const [showModal, setShowModal] = useState(false);
  const [editingComp, setEditingComp] = useState<Competition | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);

  // 删除确认
  const [deletingComp, setDeletingComp] = useState<Competition | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadComps = () => {
    competitionStore.getAll().then(c => {
      setComps(c);
      setLoading(false);
    });
  };

  useEffect(loadComps, []);

  const openCreate = () => {
    setEditingComp(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (comp: Competition) => {
    setEditingComp(comp);
    setForm({
      name: comp.name || '',
      subtitle: comp.subtitle || '',
      venue: comp.venue || '',
      startDate: comp.startDate || '',
      endDate: comp.endDate || '',
      registrationDeadline: comp.registrationDeadline || '',
      status: comp.status || 'draft',
      description: comp.description || '',
    });
    setShowModal(true);
  };

  const handleDelete = async () => {
    if (!deletingComp) return;
    setDeleting(true);
    try {
      await competitionStore.delete(deletingComp.id);
      toast.success('赛事已删除');
      setDeletingComp(null);
      loadComps();
    } catch {
      toast.error('删除失败，请重试');
    } finally {
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.venue.trim() || !form.startDate || !form.endDate) {
      toast.error('请填写赛事名称、场地和日期');
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        subtitle: form.subtitle.trim() || undefined,
        venue: form.venue.trim(),
        startDate: form.startDate,
        endDate: form.endDate,
        registrationDeadline: form.registrationDeadline || form.endDate,
        status: form.status,
        description: form.description.trim() || undefined,
      };

      if (editingComp) {
        await competitionStore.update(editingComp.id, payload);
        toast.success('赛事已更新');
      } else {
        const created = await competitionStore.create(payload);
        toast.success('赛事创建成功');
        setShowModal(false);
        onSelect(created);
        return;
      }
      setShowModal(false);
      loadComps();
    } catch {
      toast.error(editingComp ? '更新失败，请重试' : '创建失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const currentAdmin = adminAuth.getCurrentUser();
  const hasComps = comps.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 sm:px-6 gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
            <Trophy className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="font-semibold text-slate-800 text-sm">选择赛事</div>
            <div className="text-xs text-slate-400">Select Competition</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {currentAdmin && (
            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">{currentAdmin.displayName}</span>
          )}
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-400 hover:text-red-500 gap-1">
            <LogOut className="w-3.5 h-3.5" />退出
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-2xl">
          {/* Title */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
              <Trophy className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-1">选择要管理的赛事</h1>
            <p className="text-slate-500 text-sm">
              {loading ? '加载中...' :
               hasComps ? '选择一个赛事进入管理后台，不同赛事数据完全隔离' :
               '还没有创建任何赛事'}
            </p>
            <div className="mt-4">
              <Button onClick={openCreate} className="gap-1.5">
                <Plus className="w-4 h-4" />新建赛事
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-16">
              <div className="text-slate-400">加载赛事列表...</div>
            </div>
          ) : !hasComps ? (
            /* 空状态 */
            <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-200">
              <Calendar className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="text-slate-500 mb-2">还没有创建任何赛事</p>
              <p className="text-slate-400 text-sm">
                点击上方「新建赛事」按钮创建第一个赛事，各赛事数据完全隔离
              </p>
            </div>
          ) : (
            /* 赛事列表 */
            <div className="space-y-3">
              {comps.map(comp => {
                const st = statusMap[comp.status] || statusMap.draft;
                return (
                  <div
                    key={comp.id}
                    className="bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-md hover:shadow-blue-100/50 transition-all group flex items-center gap-4"
                  >
                    <button
                      onClick={() => onSelect(comp)}
                      className="flex-1 flex items-center gap-4 p-5 text-left cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition-colors">
                        <Trophy className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-slate-800 group-hover:text-blue-700 transition-colors">{comp.name}</h3>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
                        </div>
                        {comp.subtitle && (
                          <p className="text-sm text-slate-500 mt-0.5 truncate">{comp.subtitle}</p>
                        )}
                        <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-400">
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{comp.venue}</span>
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{comp.startDate} ~ {comp.endDate}</span>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-500 group-hover:translate-x-1 transition-all shrink-0" />
                    </button>
                    {/* 操作按钮 */}
                    <div className="pr-3 flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); openEdit(comp); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 text-slate-300 hover:text-blue-600 transition-colors"
                        title="编辑赛事"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeletingComp(comp); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                        title="删除赛事"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-xs text-slate-400">
        Jump Rope Admin · 赛事管理后台
      </footer>

      {/* 创建/编辑赛事弹窗（共用） */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingComp ? '编辑赛事' : '创建新赛事'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">赛事名称 <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="如：2024年全国青少年跳绳锦标赛"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">副标题</label>
              <input
                type="text"
                value={form.subtitle}
                onChange={e => setForm(p => ({ ...p, subtitle: e.target.value }))}
                placeholder="主办单位等信息"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">比赛场地 <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={form.venue}
                onChange={e => setForm(p => ({ ...p, venue: e.target.value }))}
                placeholder="如：国家体育馆综合训练中心"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">开始日期 <span className="text-red-400">*</span></label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">结束日期 <span className="text-red-400">*</span></label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">报名截止日期</label>
              <input
                type="date"
                value={form.registrationDeadline}
                onChange={e => setForm(p => ({ ...p, registrationDeadline: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">赛事状态</label>
              <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v as Competition['status'] }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">草稿</SelectItem>
                  <SelectItem value="open">报名中</SelectItem>
                  <SelectItem value="closed">已截止</SelectItem>
                  <SelectItem value="completed">已结束</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">赛事说明</label>
              <Textarea
                rows={3}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="赛事简介、注意事项等"
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : editingComp ? <><Save className="w-4 h-4" />保存修改</> : <><Plus className="w-4 h-4" />创建赛事</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deletingComp} onOpenChange={() => setDeletingComp(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除赛事？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，将删除赛事及其所有相关数据
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">
            赛事名称：<strong>{deletingComp?.name}</strong>
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
