import { useState, useEffect, useMemo } from 'react';
import { FileCheck2, CheckCircle2, XCircle, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';
import { liabilityAgreementStore, teamProfileStore, clubStore } from '@/lib/store';
import { AGREEMENT_VERSION } from '@/lib/liabilityAgreement';
import type { LiabilityAgreement } from '@/types';

export default function AdminAgreements({ competitionId }: { competitionId: string }) {
  const [records, setRecords] = useState<LiabilityAgreement[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string; clubId: string }[]>([]);
  const [clubs, setClubs] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [recs, teamList, clubList] = await Promise.all([
        liabilityAgreementStore.getByCompetition(competitionId),
        teamProfileStore.getByCompetition(competitionId),
        clubStore.getAll().catch(() => []),
      ]);
      setRecords(recs);
      setTeams(teamList.map(t => ({ id: t.id, name: t.teamName, clubId: t.clubId })));
      setClubs(new Map(clubList.map(c => [c.id, c.clubName])));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [competitionId]);

  const signedMap = useMemo(() => new Map(records.map(r => [r.teamProfileId, r])), [records]);

  const rows = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return teams
      .filter(t => !kw || t.name.toLowerCase().includes(kw) || (clubs.get(t.clubId) || '').toLowerCase().includes(kw) || (signedMap.get(t.id)?.signerName || '').toLowerCase().includes(kw))
      .map(t => ({ team: t, agreement: signedMap.get(t.id) || null }))
      .sort((a, b) => Number(Boolean(b.agreement)) - Number(Boolean(a.agreement)));
  }, [teams, clubs, signedMap, search]);

  const signedCount = teams.filter(t => signedMap.has(t.id)).length;

  const handleExport = () => {
    const data = rows.map(({ team, agreement }) => ({
      '参赛单位': clubs.get(team.clubId) || '',
      '代表队': team.name,
      '签署状态': agreement ? '已签署' : '未签署',
      '签署人': agreement?.signerName || '',
      '签署身份': agreement?.signerRole || '',
      '签署时间': agreement ? new Date(agreement.signedAt).toLocaleString('zh-CN') : '',
      '责任书版本': agreement?.agreementVersion || '',
    }));
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ '提示': '暂无队伍数据' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '责任书签署');
    XLSX.writeFile(wb, `责任书签署情况_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400"><RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />加载中...</div>;
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">责任书签署</h2>
          <p className="text-slate-400 text-sm mt-0.5">已签署 {signedCount} / {teams.length} 支队伍 · 责任书版本 {AGREEMENT_VERSION}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" />刷新</Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5"><Download className="w-3.5 h-3.5" />导出 Excel</Button>
        </div>
      </div>

      <Input placeholder="搜索队伍 / 单位 / 签署人" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />

      {rows.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-slate-400">暂无队伍数据</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {rows.map(({ team, agreement }) => (
            <Card key={team.id} className="bg-white border-0 shadow-sm">
              <CardContent className="p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{team.name}</span>
                    <span className="text-xs text-slate-400">{clubs.get(team.clubId) || ''}</span>
                  </div>
                  {agreement && (
                    <div className="text-xs text-slate-500 mt-1">
                      签署人：{agreement.signerName} · {agreement.signerRole} · {new Date(agreement.signedAt).toLocaleString('zh-CN')}
                    </div>
                  )}
                </div>
                {agreement ? (
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1"><CheckCircle2 className="w-3 h-3" />已签署</Badge>
                ) : (
                  <Badge className="bg-amber-50 text-amber-700 border-amber-200 gap-1"><XCircle className="w-3 h-3" />未签署</Badge>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400 flex items-center gap-1"><FileCheck2 className="w-3.5 h-3.5" />签署记录用于赛事备查；队伍签署一次即全队生效。</p>
    </div>
  );
}
