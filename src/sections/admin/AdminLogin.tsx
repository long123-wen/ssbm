import { useState } from 'react';
import { Eye, EyeOff, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Props {
  onLogin: (user: string, pass: string) => Promise<boolean>;
}

export default function AdminLogin({ onLogin }: Props) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const ok = await onLogin(user, pass);
    if (!ok) setError('用户名或密码错误，请重试');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <Card className="bg-slate-800/80 border-slate-700 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <CardTitle className="text-2xl text-white">管理员登录</CardTitle>
            <CardDescription className="text-slate-400">
              后台管理系统 · 仅限授权人员访问
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label className="text-slate-300 text-sm">管理员账号</Label>
                <Input
                  value={user}
                  onChange={e => setUser(e.target.value)}
                  placeholder="请输入管理员账号"
                  className="mt-1.5 bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <Label className="text-slate-300 text-sm">登录密码</Label>
                <div className="relative mt-1.5">
                  <Input
                    type={showPass ? 'text' : 'password'}
                    value={pass}
                    onChange={e => setPass(e.target.value)}
                    placeholder="请输入登录密码"
                    className="bg-slate-700 border-slate-600 text-white placeholder:text-slate-500 focus:border-blue-500 pr-10"
                    required
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? '隐藏密码' : '显示密码'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="bg-red-500/15 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-sm">
                  {error}
                </div>
              )}
              <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-white h-11 text-base mt-2">
                {loading ? '登录中...' : '立即登录'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
