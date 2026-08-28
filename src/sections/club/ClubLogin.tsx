import { useState } from 'react';
import { Users, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Props {
  onLogin: (user: string, pass: string) => Promise<boolean>;
  onToRegister: () => void;
}

export default function ClubLogin({ onLogin, onToRegister }: Props) {
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
    if (!ok) setError('账号或密码错误，请重试');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-background flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">

        <Card className="shadow-elevated border-border/50">
          <CardHeader className="text-center pb-2">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mx-auto mb-4 shadow-glow">
              <Users className="w-7 h-7 text-white" />
            </div>
            <CardTitle className="text-2xl">参赛单位登录</CardTitle>
            <CardDescription>
              在线自助报名系统 · 参赛单位通用
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>登录账号</Label>
                <Input className="mt-1.5" placeholder="请输入用户名" value={user} onChange={e => setUser(e.target.value)} required />
              </div>
              <div>
                <Label>登录密码</Label>
                <div className="relative mt-1.5">
                  <Input type={showPass ? 'text' : 'password'} placeholder="请输入密码" value={pass}
                    onChange={e => setPass(e.target.value)} className="pr-10" required />
                  <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? '隐藏密码' : '显示密码'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-destructive text-sm">{error}</div>
              )}
              <Button type="submit" disabled={loading} size="lg" className="w-full h-11 text-base mt-2">
                {loading ? '登录中...' : '登录'}
              </Button>
            </form>
            <div className="mt-4 text-center">
              <span className="text-sm text-muted-foreground">还没有账号？</span>
              <button onClick={onToRegister} className="text-sm text-primary hover:text-primary/80 font-medium ml-1 transition-colors">
                立即注册
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
