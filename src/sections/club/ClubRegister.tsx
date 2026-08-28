import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import type { ClubAccount } from '@/types';

interface Props {
  onRegister: (data: Omit<ClubAccount, 'id' | 'createdAt' | 'isApproved'>, password: string) => Promise<boolean>;
  onToLogin: () => void;
}

export default function ClubRegister({ onRegister, onToLogin }: Props) {
  const [form, setForm] = useState({ username: '', clubName: '', contactName: '', phone: '' });
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.username || !form.clubName || !form.contactName || !form.phone) {
      return setError('请填写所有必填项');
    }
    if (pass.length < 6) return setError('密码至少6位字符');
    if (pass !== pass2) return setError('两次密码不一致');
    setLoading(true);
    const ok = await onRegister(form, pass);
    if (!ok) setError('用户名已被注册，请换一个');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">

        <Card className="shadow-lg border-0">
          <CardHeader className="text-center pb-2">
            <div className="w-14 h-14 rounded-2xl bg-green-600 flex items-center justify-center mx-auto mb-4">
              <UserPlus className="w-7 h-7 text-white" />
            </div>
            <CardTitle className="text-2xl">注册参赛单位账号</CardTitle>
            <CardDescription>填写信息，完成注册后可在线报名参赛</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-700">
                带 <span className="text-red-500">*</span> 为必填项
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">登录用户名 <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" placeholder="字母数字组合" value={form.username} onChange={f('username')} required />
                </div>
                <div>
                  <Label className="text-sm">参赛单位名称 <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" placeholder="完整名称" value={form.clubName} onChange={f('clubName')} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">联系人姓名 <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" placeholder="领队或负责人" value={form.contactName} onChange={f('contactName')} required />
                </div>
                <div>
                  <Label className="text-sm">联系电话 <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" placeholder="手机号码" value={form.phone} onChange={f('phone')} required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm">登录密码 <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" type="password" placeholder="至少6位" value={pass} onChange={e => setPass(e.target.value)} required />
                </div>
                <div>
                  <Label className="text-sm">确认密码 <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" type="password" placeholder="再次输入密码" value={pass2} onChange={e => setPass2(e.target.value)} required />
                </div>
              </div>
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-red-600 text-sm">{error}</div>
              )}
              <Button type="submit" disabled={loading} className="w-full bg-green-600 hover:bg-green-700 h-11 text-base">
                {loading ? '注册中...' : '完成注册'}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <span className="text-sm text-slate-500">已有账号？</span>
              <button onClick={onToLogin} className="text-sm text-blue-600 hover:text-blue-700 font-medium ml-1">
                立即登录
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
