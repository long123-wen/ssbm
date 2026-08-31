import { useState, useEffect } from 'react';
import { Trophy, MapPin, Calendar, Clock, Search, ChevronRight, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { competitionStore } from '@/lib/store';
import ThemeToggle from '@/components/ThemeToggle';
import type { Competition, ClubAccount } from '@/types';

const STORAGE_KEY = 'club_selected_competition_id';

export function getStoredCompetitionId(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredCompetitionId(id: string) {
  localStorage.setItem(STORAGE_KEY, id);
}

export function clearStoredCompetitionId() {
  localStorage.removeItem(STORAGE_KEY);
}

const statusLabel: Record<string, { label: string; cls: string }> = {
  open: { label: '报名中', cls: 'bg-green-100 text-green-700 border-green-200' },
  draft: { label: '筹备中', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  closed: { label: '已截止', cls: 'bg-red-100 text-red-600 border-red-200' },
  completed: { label: '已结束', cls: 'bg-blue-100 text-blue-600 border-blue-200' },
};

interface Props {
  club: ClubAccount;
  onSelect: (competitionId: string, competition: Competition) => void;
  onLogout: () => void;
}

export default function ClubCompetitionSelect({ club, onSelect, onLogout }: Props) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    competitionStore.getAll().then(list => {
      setCompetitions(list);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? competitions.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.venue && c.venue.toLowerCase().includes(search.toLowerCase()))
      )
    : competitions;

  const openComps = filtered.filter(c => c.status === 'open');
  const otherComps = filtered.filter(c => c.status !== 'open');

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="text-sm text-slate-400">加载赛事列表...</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="h-14 bg-white/80 backdrop-blur-sm border-b border-slate-200/80 flex items-center px-4 lg:px-6 gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Trophy className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm text-slate-800">选择赛事</h1>
            <p className="text-[11px] text-slate-400">{club.clubName}</p>
          </div>
        </div>
        <div className="flex-1" />
        <ThemeToggle />
        <Badge variant="outline" className="text-[11px] text-slate-600 border-slate-300 bg-white font-medium hidden sm:inline-flex">
          {club.clubName}
        </Badge>
        <button
          onClick={onLogout}
          className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="退出登录"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-4 lg:p-8 max-w-4xl mx-auto w-full">
        {/* Welcome banner */}
        <div className="mb-6 lg:mb-8">
          <h2 className="text-xl lg:text-2xl font-bold text-slate-800 mb-1">欢迎，{club.contactName}</h2>
          <p className="text-sm text-slate-500">请选择一个赛事以继续报名和管理</p>
        </div>

        {/* Search */}
        {competitions.length > 6 && (
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="搜索赛事名称或地点..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-white"
            />
          </div>
        )}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Trophy className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <p className="text-slate-400 text-sm">
              {search ? '没有匹配的赛事' : '暂无可选赛事'}
            </p>
            {search && (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setSearch('')}>
                清除搜索
              </Button>
            )}
          </div>
        )}

        {/* Open competitions — highlighted first */}
        {openComps.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <h3 className="text-sm font-semibold text-slate-600">可报名赛事</h3>
              <Badge variant="secondary" className="text-[11px]">{openComps.length}</Badge>
            </div>
            <div className="grid gap-3">
              {openComps.map(comp => (
                <CompetitionCard key={comp.id} competition={comp} onSelect={() => onSelect(comp.id, comp)} />
              ))}
            </div>
          </div>
        )}

        {/* Other competitions */}
        {otherComps.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              <h3 className="text-sm font-semibold text-slate-600">其他赛事</h3>
              <Badge variant="secondary" className="text-[11px]">{otherComps.length}</Badge>
            </div>
            <div className="grid gap-3">
              {otherComps.map(comp => (
                <CompetitionCard key={comp.id} competition={comp} onSelect={() => onSelect(comp.id, comp)} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function CompetitionCard({ competition: c, onSelect }: { competition: Competition; onSelect: () => void }) {
  const st = statusLabel[c.status] || statusLabel.draft;
  const isOpen = c.status === 'open';

  return (
    <Card
      className={`
        p-4 lg:p-5 cursor-pointer transition-all duration-200 group
        hover:shadow-md hover:border-blue-200
        ${isOpen ? 'border-green-200 bg-gradient-to-r from-white to-green-50/30' : ''}
      `}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h4 className="font-semibold text-sm lg:text-base text-slate-800 group-hover:text-blue-600 transition-colors truncate">
              {c.name}
            </h4>
            <Badge className={`text-[11px] px-1.5 py-0 border ${st.cls}`}>
              {st.label}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            {c.venue && (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {c.venue}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {c.startDate} ~ {c.endDate}
            </span>
            {c.registrationDeadline && (
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                报名截止：{c.registrationDeadline}
              </span>
            )}
          </div>

          {/* Competition ID */}
          <p className="text-[11px] text-slate-400 mt-1.5 font-mono">
            ID: {c.id}
          </p>

          {c.subtitle && (
            <p className="text-xs text-slate-400 mt-1 line-clamp-1">{c.subtitle}</p>
          )}
        </div>

        <div className="shrink-0 self-center">
          <div className={`
            w-8 h-8 rounded-full flex items-center justify-center transition-all
            ${isOpen
              ? 'bg-green-100 text-green-600 group-hover:bg-green-200 group-hover:scale-110'
              : 'bg-slate-100 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500'
            }
          `}>
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </Card>
  );
}
