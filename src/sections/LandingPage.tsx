import { Trophy, Users, Settings, ArrowRight, Shield, Cloud, Zap, Award } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Props {
  onAdminClick: () => void;
  onClubClick: () => void;
}

export default function LandingPage({ onAdminClick, onClubClick }: Props) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-950 via-brand-900 to-slate-900 text-white">
      {/* Hero Header */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 viewBox=%220 0 60 60%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22none%22 fill-rule=%22evenodd%22%3E%3Cg fill=%22%23ffffff%22 fill-opacity=%220.03%22%3E%3Cpath d=%22M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z%22/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-40"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <nav className="flex items-center justify-between mb-12 sm:mb-20">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
                <Trophy className="w-4.5 h-4.5 sm:w-5 sm:h-5 text-white" />
              </div>
              <div>
                <div className="font-bold text-base sm:text-lg leading-tight">跳绳赛事管理系统</div>
                <div className="text-xs text-blue-300 hidden sm:block">Jump Rope Competition System</div>
              </div>
            </div>
            <Badge variant="outline" className="border-primary/40 text-blue-300 text-xs">
              v2.0 · 云端版
            </Badge>
          </nav>

          <div className="text-center pb-12 sm:pb-20">
            <div className="inline-flex items-center gap-2 bg-primary/20 border border-primary/30 rounded-full px-3 sm:px-4 py-1.5 text-xs sm:text-sm text-blue-300 mb-5 sm:mb-6">
              <Zap className="w-3.5 h-3.5 shrink-0" />
              专业赛事管理平台 · 支持500+人规模比赛
            </div>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6 leading-tight">
              让跳绳赛事
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-cyan-400">
                更专业更高效
              </span>
            </h1>
            <p className="text-slate-400 text-sm sm:text-lg max-w-2xl mx-auto mb-8 sm:mb-12 leading-relaxed px-2">
              全流程数字化赛事管理，从报名到出场顺序生成一站搞定。
              支持多赛事并行、分组限额管理、自动出场编排，
              为每一场跳绳赛事保驾护航。
            </p>

            {/* 三个入口 */}
            <div className="flex flex-col gap-3 sm:gap-4 justify-center px-2 max-w-3xl mx-auto">
              <button
                onClick={onAdminClick}
                className="group relative overflow-hidden bg-primary hover:bg-primary/90 transition-all duration-300 rounded-2xl px-6 sm:px-8 py-4 sm:py-5 text-left shadow-2xl shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent"></div>
                <div className="relative flex items-center gap-3 sm:gap-4">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                    <Settings className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div>
                    <div className="font-bold text-base sm:text-lg">后台管理系统</div>
                    <div className="text-blue-200 text-xs sm:text-sm mt-0.5">赛事 · 项目 · 分组 · 出场顺序</div>
                  </div>
                  <ArrowRight className="w-5 h-5 ml-auto opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                </div>
              </button>

              <div className="max-w-3xl mx-auto">
                <button
                  onClick={onClubClick}
                  className="group relative overflow-hidden w-full bg-slate-700/80 hover:bg-slate-600/80 border border-slate-600/50 hover:border-slate-500/50 transition-all duration-300 rounded-2xl px-5 sm:px-6 py-4 sm:py-5 text-left shadow-xl hover:-translate-y-0.5"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent"></div>
                  <div className="relative flex items-center gap-3 sm:gap-4">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                      <Users className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" />
                    </div>
                    <div>
                    <div className="font-bold text-base sm:text-lg">在线报名</div>
                    <div className="text-slate-400 text-xs sm:text-sm mt-0.5">支持俱乐部 / 学校 / 单位</div>
                    </div>
                    <ArrowRight className="w-5 h-5 ml-auto opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 特性介绍 */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-12 sm:pb-20">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {([
            { icon: <Cloud className="w-5 h-5" />, title: '云端运行', desc: '基于 CloudBase，数据实时同步，随时随地访问管理', bgClass: 'bg-blue-500/20', textClass: 'text-blue-400' },
            { icon: <Users className="w-5 h-5" />, title: '大规模支持', desc: '支持 500+ 运动员同时报名，高并发稳定可靠', bgClass: 'bg-cyan-500/20', textClass: 'text-cyan-400' },
            { icon: <Award className="w-5 h-5" />, title: '智能编排', desc: '自动生成出场顺序，一键导出比赛安排', bgClass: 'bg-violet-500/20', textClass: 'text-violet-400' },
            { icon: <Shield className="w-5 h-5" />, title: '权限管控', desc: '管理员与俱乐部账号分离，数据安全有保障', bgClass: 'bg-emerald-500/20', textClass: 'text-emerald-400' },
          ] as const).map((f, i) => (
            <Card key={i} className="bg-white/5 border-white/10 hover:bg-white/8 transition-colors">
              <CardContent className="p-5">
                <div className={`w-9 h-9 rounded-lg ${f.bgClass} flex items-center justify-center mb-3 ${f.textClass}`}>
                  {f.icon}
                </div>
                <div className="font-semibold text-white mb-1">{f.title}</div>
                <div className="text-slate-400 text-sm leading-relaxed">{f.desc}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <footer className="border-t border-white/10 py-6 text-center text-slate-500 text-sm">
        © {new Date().getFullYear()} 跳绳赛事管理系统 · 专业赛事数字化解决方案
      </footer>
    </div>
  );
}
