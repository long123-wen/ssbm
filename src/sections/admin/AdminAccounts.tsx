import { useState, useEffect, useCallback } from 'react';
import { Shield, UserPlus, Pencil, Trash2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { adminUserStore, adminAuth } from '@/lib/store';
import type { AdminUser } from '@/types';

export default function AdminAccounts() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'organizer' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const currentUser = adminAuth.getCurrentUser();

  const loadAdmins = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await adminUserStore.getAll();
      setAdmins(data.filter(a => a.id)); // filter out bad data
    } catch {
      setError('加载管理员列表失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAdmins(); }, [loadAdmins]);

  const openAdd = () => {
    setEditing(null);
    setForm({ username: '', password: '', displayName: '', role: 'organizer' });
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (admin: AdminUser) => {
    setEditing(admin);
    setForm({
      username: admin.username,
      password: '',
      displayName: admin.displayName,
      role: admin.role,
    });
    setFormError('');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.username.trim()) { setFormError('请输入用户名'); return; }
    if (!form.displayName.trim()) { setFormError('请输入显示名称'); return; }
    if (!editing && !form.password.trim()) { setFormError('请输入密码'); return; }

    setSaving(true);
    setFormError('');

    try {
      if (editing) {
        const patch: any = { displayName: form.displayName, role: form.role };
        if (form.password.trim()) patch.password = form.password;
        await adminUserStore.update(editing.id, patch);
      } else {
        await adminUserStore.create({
          username: form.username.trim(),
          password: form.password,
          displayName: form.displayName.trim(),
          role: form.role,
        });
      }
      setDialogOpen(false);
      await loadAdmins();
    } catch (err: any) {
      setFormError(err.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminUserStore.delete(deleteTarget.id);
      setDeleteTarget(null);
      await loadAdmins();
    } catch {
      setFormError('删除失败，请重试');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (admin: AdminUser) => {
    try {
      await adminUserStore.update(admin.id, { isActive: !admin.isActive });
      await loadAdmins();
    } catch {
      toast.error('操作失败，请重试');
    }
  };

  const isSelf = (admin: AdminUser) => {
    if (currentUser) return currentUser.id === admin.id;
    return admin.username === 'admin'; // 兜底：不允许删除默认 admin
  };

  return (
    <div className="p-4 lg:p-6 max-w-5xl">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="w-5 h-5 text-blue-600" />
              授权管理员
            </CardTitle>
            <CardDescription>管理系统后台的授权管理员账号</CardDescription>
          </div>
          <Button onClick={openAdd} size="sm" className="bg-blue-600 hover:bg-blue-500">
            <UserPlus className="w-4 h-4 mr-1.5" />
            添加管理员
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
              <Button variant="outline" size="sm" onClick={loadAdmins} className="ml-auto">重试</Button>
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-slate-500">
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              加载管理员列表...
            </div>
          ) : admins.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
              暂无管理员账号，点击上方按钮添加
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-3 font-medium text-slate-500">用户名</th>
                    <th className="text-left py-3 px-3 font-medium text-slate-500">显示名称</th>
                    <th className="text-left py-3 px-3 font-medium text-slate-500">角色</th>
                    <th className="text-left py-3 px-3 font-medium text-slate-500">状态</th>
                    <th className="text-left py-3 px-3 font-medium text-slate-500">创建时间</th>
                    <th className="text-right py-3 px-3 font-medium text-slate-500">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map(admin => (
                    <tr key={admin.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-3 font-medium text-slate-800">{admin.username}</td>
                      <td className="py-3 px-3 text-slate-600">{admin.displayName}</td>
                      <td className="py-3 px-3">
                        <Badge variant={admin.role === 'admin' ? 'default' : 'secondary'} className="text-xs">
                          {admin.role === 'admin' ? '超级管理员' : '赛事管理员'}
                        </Badge>
                      </td>
                      <td className="py-3 px-3">
                        <button
                          onClick={() => handleToggleActive(admin)}
                          disabled={isSelf(admin)}
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
                            isSelf(admin) ? 'cursor-not-allowed opacity-60' : ''
                          } ${
                            admin.isActive
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${admin.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {admin.isActive ? '启用' : '禁用'}
                        </button>
                      </td>
                      <td className="py-3 px-3 text-slate-400 text-xs">
                        {new Date(admin.createdAt).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(admin)}
                            className="h-8 px-2 text-slate-500 hover:text-blue-600">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(admin)}
                            disabled={isSelf(admin)}
                            className={`h-8 px-2 ${isSelf(admin) ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-red-600'}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑管理员' : '添加管理员'}</DialogTitle>
            <DialogDescription>
              {editing ? '修改管理员信息和权限' : '创建一个新的管理员账号'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm">用户名</Label>
              <Input
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                disabled={!!editing}
                placeholder="登录用户名"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">
                {editing ? '新密码（留空则不修改）' : '登录密码'}
              </Label>
              <Input
                type="password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder={editing ? '留空保持原密码' : '请输入密码'}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">显示名称</Label>
              <Input
                value={form.displayName}
                onChange={e => setForm({ ...form, displayName: e.target.value })}
                placeholder="例如：张三"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">角色权限</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">超级管理员 - 全部权限</SelectItem>
                  <SelectItem value="organizer">赛事管理员 - 赛事运营权限</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {formError}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-500">
              {saving ? '保存中...' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              确认删除
            </DialogTitle>
            <DialogDescription>
              确定要删除管理员 <span className="font-medium text-slate-800">{deleteTarget?.displayName}</span>（{deleteTarget?.username}）吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-500">
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
