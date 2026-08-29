import { useState } from 'react';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { adminAuth, adminUserStore } from '@/lib/store';

type Props = { onComplete: () => void; onLogout: () => void };

export default function AdminPasswordReset({ onComplete, onLogout }: Props) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('新密码至少需要 12 位');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setSaving(true);
    try {
      const user = await adminUserStore.resetPassword(password, confirmPassword);
      adminAuth._currentUser = user;
      localStorage.setItem('rj_admin_token', 'authenticated');
      localStorage.setItem('rj_admin_user', JSON.stringify(user));
      onComplete();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '密码修改失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-slate-800/90 border-slate-700 shadow-2xl">
        <CardHeader className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center mx-auto mb-3">
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <CardTitle className="text-2xl text-white">首次登录请修改密码</CardTitle>
          <CardDescription className="text-slate-400">为了保障管理后台安全，必须设置新密码后才能继续</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label className="text-slate-300 text-sm">新密码</Label>
              <div className="relative mt-1.5">
                <Input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="至少 12 位" className="bg-slate-700 border-slate-600 text-white pr-10" required minLength={12} />
                <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </div>
            <div>
              <Label className="text-slate-300 text-sm">确认新密码</Label>
              <div className="relative mt-1.5">
                <Input type={showConfirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" className="bg-slate-700 border-slate-600 text-white pr-10" required minLength={12} />
                <button type="button" onClick={() => setShowConfirm(value => !value)} aria-label={showConfirm ? '隐藏密码' : '显示密码'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
              </div>
            </div>
            {error && <div className="bg-red-500/15 border border-red-500/30 rounded-lg px-3 py-2 text-red-300 text-sm">{error}</div>}
            <Button type="submit" disabled={saving} className="w-full bg-amber-500 hover:bg-amber-400 text-white h-11">{saving ? '保存中...' : '保存新密码'}</Button>
            <Button type="button" variant="ghost" onClick={onLogout} className="w-full text-slate-400 hover:text-white">退出登录</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
