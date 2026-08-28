import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Calendar, MapPin, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { competitionStore } from '@/lib/store';
import type { Competition, RegistrationStatus } from '@/types';

const statusMap: Record<RegistrationStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-slate-100 text-slate-600' },
  open: { label: '报名中', color: 'bg-green-100 text-green-700' },
  closed: { label: '已截止', color: 'bg-amber-100 text-amber-700' },
  completed: { label: '已结束', color: 'bg-blue-100 text-blue-700' },
};

const emptyForm: Omit<Competition, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '', subtitle: '', venue: '', startDate: '', endDate: '',
  registrationDeadline: '', status: 'draft', description: '',
};

export default function AdminCompetitions({ activeComp }: { activeComp?: Competition; }) {
  const [list, setList] = useState<Competition[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = () => competitionStore.getAll().then(setList);
  useEffect(() => { load(); }, []);

  const handleOpen = (comp?: Competition) => {
    if (comp) { setEditId(comp.id); setForm({ ...comp }); }
    else { setEditId(null); setForm({ ...emptyForm }); }
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.venue || !form.startDate) return;
    try {
      if (editId) await competitionStore.update(editId, form);
      else await competitionStore.create(form);
      setOpen(false);
      load();
      toast.success(editId ? '赛事已更新' : '赛事已创建');
    } catch (err: any) {
      toast.error('保存失败：' + (err?.message || '未知错误'));
    }
  };

  const handleDelete = (id: string) => setDeleteId(id);
  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await competitionStore.delete(deleteId);
      load();
      toast.success('赛事已删除');
    } catch (err: any) {
      toast.error('删除失败：' + (err?.message || '未知错误'));
    }
    setDeleteId(null);
  };

  const f = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-800">赛事管理</h2>
          <p className="text-slate-400 text-sm mt-0.5">创建和管理跳绳赛事基本信息</p>
        </div>
        <Button onClick={() => handleOpen()} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
          <Plus className="w-4 h-4" />创建赛事
        </Button>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>暂无赛事，点击右上角创建第一个赛事</p>
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(comp => {
            const st = statusMap[comp.status];
            return (
              <Card key={comp.id} className="bg-white border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-800 text-base">{comp.name}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.color}`}>
                          {st.label}
                        </span>
                      </div>
                      {comp.subtitle && <p className="text-sm text-slate-500 mt-0.5">{comp.subtitle}</p>}
                      <div className="flex flex-wrap gap-4 mt-3 text-sm text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-blue-400" />{comp.venue}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-blue-400" />
                          {comp.startDate} 至 {comp.endDate}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          报名截止：{comp.registrationDeadline}
                        </span>
                        {(comp.maxIndividualEvents || comp.maxTeamEvents) && (
                          <span className="flex items-center gap-1.5 text-purple-500">
                            限报：{comp.maxIndividualEvents ? `个人${comp.maxIndividualEvents}项` : ''}{comp.maxIndividualEvents && comp.maxTeamEvents ? ' / ' : ''}{comp.maxTeamEvents ? `集体${comp.maxTeamEvents}项` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => handleOpen(comp)} className="gap-1.5">
                        <Edit2 className="w-3.5 h-3.5" />编辑
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleDelete(comp.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 border-red-200 gap-1.5">
                        <Trash2 className="w-3.5 h-3.5" />删除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? '编辑赛事' : '创建新赛事'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 gap-4">
              <div>
                <Label>赛事名称 <span className="text-red-500">*</span></Label>
                <Input className="mt-1" placeholder="如：2024年全国青少年跳绳锦标赛" value={form.name} onChange={e => f('name', e.target.value)} />
              </div>
              <div>
                <Label>副标题</Label>
                <Input className="mt-1" placeholder="主办单位等信息" value={form.subtitle || ''} onChange={e => f('subtitle', e.target.value)} />
              </div>
              <div>
                <Label>比赛场地 <span className="text-red-500">*</span></Label>
                <Input className="mt-1" placeholder="如：国家体育馆综合训练中心" value={form.venue} onChange={e => f('venue', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>开始日期 <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" type="date" value={form.startDate} onChange={e => f('startDate', e.target.value)} />
                </div>
                <div>
                  <Label>结束日期</Label>
                  <Input className="mt-1" type="date" value={form.endDate} onChange={e => f('endDate', e.target.value)} />
                </div>
              </div>
              <div>
                <Label>报名截止日期</Label>
                <Input className="mt-1" type="date" value={form.registrationDeadline} onChange={e => f('registrationDeadline', e.target.value)} />
              </div>
              <div>
                <Label>赛事状态</Label>
                <Select value={form.status} onValueChange={v => f('status', v)}>
                  <SelectTrigger className="mt-1">
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
                <Label>赛事说明</Label>
                <Textarea className="mt-1" rows={3} placeholder="赛事简介、注意事项等" value={form.description || ''} onChange={e => f('description', e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white">
              {editId ? '保存修改' : '创建赛事'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除赛事确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除赛事？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后所有关联的报名数据仍需手动清理，此操作不可撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
