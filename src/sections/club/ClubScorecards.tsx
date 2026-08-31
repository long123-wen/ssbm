import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, Search, Users, UserRound, Printer, Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { scorecardStore, type ScorecardEntry } from '@/lib/store';
import { toast } from 'sonner';
import type { TeamProfile } from '@/types';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

interface Props { competitionId: string; teamProfiles: TeamProfile[]; selectedTeamId: string; }

function displayNames(names: string[]): string {
  if (!names.length) return '';
  return names.length >= 3 ? `${names[0]}等` : names.join('、');
}

const TEMPLATE_URL = '/templates/scorecard-template.pdf';

type FieldBox = { left: number; right: number; bottom: number; top: number; padding?: number };

function drawCenteredFittedText(page: import('pdf-lib').PDFPage, font: import('pdf-lib').PDFFont, value: unknown, box: FieldBox, preferredSize = 10.5) {
  const text = String(value ?? '').trim();
  if (!text) return;
  const padding = box.padding ?? 6;
  const maxWidth = Math.max(1, box.right - box.left - padding * 2);
  // 保持单行：根据单元格可用宽度缩小字号，避免文字换行或越界。
  let size = preferredSize;
  while (size > 7 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.25;
  const textWidth = font.widthOfTextAtSize(text, size);
  const textHeight = font.heightAtSize(size, { descender: true });
  const x = box.left + (box.right - box.left - textWidth) / 2;
  // drawText 的 y 是基线；使用包含下沉部的字体高度，并补偿基线位置实现视觉垂直居中。
  const y = box.bottom + ((box.top - box.bottom - textHeight) / 2) + size * 0.18;
  page.drawText(text, { x, y, size, font, color: rgb(0.08, 0.08, 0.08), maxWidth });
}

// 原模板是一页 A4 纵向三联。坐标取自模板实际表格分隔线，使用 PDF 左下角坐标。
const PANEL_HEIGHT = 257.5;
const PANEL_FIELDS = {
  event: { left: 120.2, right: 494.1, bottom: 745.3, top: 771.1 },
  team: { left: 120.2, right: 307.4, bottom: 718.0, top: 744.3 },
  round: { left: 401.0, right: 494.1, bottom: 718.0, top: 744.3 },
  group: { left: 120.2, right: 307.4, bottom: 690.8, top: 717.1 },
  name: { left: 401.0, right: 494.1, bottom: 690.8, top: 717.1 },
} as const;

async function createFromTemplate(rows: ScorecardEntry[]): Promise<Uint8Array> {
  const [template, fontBytes] = await Promise.all([
    fetch(TEMPLATE_URL).then(response => { if (!response.ok) throw new Error(`模板加载失败（${response.status}）`); return response.arrayBuffer(); }),
    fetch('/fonts/simhei.ttf').then(response => { if (!response.ok) throw new Error(`中文字体加载失败（${response.status}）`); return response.arrayBuffer(); }),
  ]);
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  const source = await PDFDocument.load(template);
  const [templatePage] = await output.embedPages([source.getPage(0)]);
  const font = await output.embedFont(fontBytes);
  for (let offset = 0; offset < rows.length; offset += 3) {
    const page = output.addPage([595.2, 841.68]);
    page.drawPage(templatePage, { x: 0, y: 0, width: 595.2, height: 841.68 });
    rows.slice(offset, offset + 3).forEach((row, panelIndex) => {
      const dy = -panelIndex * PANEL_HEIGHT;
      const shiftBox = (box: FieldBox): FieldBox => ({ ...box, bottom: box.bottom + dy, top: box.top + dy });
      drawCenteredFittedText(page, font, row.event_name, shiftBox(PANEL_FIELDS.event));
      drawCenteredFittedText(page, font, row.team_name || row.club_name, shiftBox(PANEL_FIELDS.team));
      drawCenteredFittedText(page, font, row.session_label, shiftBox(PANEL_FIELDS.round));
      drawCenteredFittedText(page, font, row.group_name, shiftBox(PANEL_FIELDS.group));
      drawCenteredFittedText(page, font, displayNames(row.athlete_names), shiftBox(PANEL_FIELDS.name));
    });
  }
  return output.save();
}

export default function ClubScorecards({ competitionId, teamProfiles, selectedTeamId }: Props) {
  const [mode, setMode] = useState<'team' | 'athlete'>('team');
  const [teamId, setTeamId] = useState(selectedTeamId);
  const [athleteName, setAthleteName] = useState('');
  const [entries, setEntries] = useState<ScorecardEntry[]>([]);
  const [imported, setImported] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ url: string; blob: Blob; rows: number } | null>(null);
  const isMobileBrowser = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  useEffect(() => { setTeamId(selectedTeamId); }, [selectedTeamId]);
  useEffect(() => { void load(); }, [competitionId, mode, teamId]);

  const load = async () => {
    setLoading(true);
    try {
      // 无论按队伍还是按姓名查询，都必须绑定当前选中的队伍；姓名只是当前队伍内的二次筛选。
      const result = await scorecardStore.getForClub(competitionId, teamId, mode === 'athlete' ? athleteName : undefined);
      setImported(result.imported); setEntries(result.entries); setSelected({});
    } catch (error: any) { toast.error(error?.message || '读取计分表数据失败'); }
    finally { setLoading(false); }
  };

  const allAthleteNames = useMemo(() => Array.from(new Set(entries.flatMap(entry => entry.athlete_names.map(name => String(name))))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [entries]);
  const selectedEntries = entries.filter(entry => selected[entry.id]);
  const selectedCount = selectedEntries.length;
  const allSelected = entries.length > 0 && selectedCount === entries.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const allRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = someSelected; }, [someSelected]);
  const toggleAll = () => {
    setSelected(previous => {
      if (allSelected) return {};
      const next: Record<string, boolean> = { ...previous };
      entries.forEach(entry => { next[entry.id] = true; });
      return next;
    });
  };

  const generatePreview = async (rows: ScorecardEntry[]) => {
    if (!rows.length) { toast.error('请先选择至少一条出场记录'); return; }
    setExporting(true);
    try {
      const bytes = await createFromTemplate(rows);
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPreview(previous => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { url, blob, rows: rows.length };
      });
    } catch (error) { console.error(error); toast.error('计分表预览生成失败，请重试'); }
    finally { setExporting(false); }
  };

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const confirmExport = async () => {
    if (!preview) return;
    const current = preview;
    // 移动端不可靠地支持 a[download] 和 iframe 内嵌 PDF，优先使用系统分享/保存面板。
    if (isMobileBrowser && typeof navigator.share === 'function' && typeof File !== 'undefined') {
      try {
        const file = new File([current.blob], '计分表.pdf', { type: 'application/pdf' });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: '计分表.pdf' });
          toast.success('已打开系统分享/保存面板');
          return;
        }
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    }
    if (!isMobileBrowser) {
      const anchor = document.createElement('a');
      anchor.href = current.url;
      anchor.download = '计分表.pdf';
      anchor.click();
      const url = current.url;
      setPreview(null);
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(`已导出 ${current.rows} 条计分表记录`);
      return;
    }
    // 兜底：在用户点击动作内打开 PDF，交给微信/浏览器的原生 PDF 查看器处理保存。
    const opened = window.open(current.url, '_blank', 'noopener,noreferrer');
    if (opened) {
      toast.success('已打开 PDF，请在系统查看器中保存或分享');
      return;
    }
    // 当前页面无法新开窗口时，保留预览并提示用户使用浏览器菜单保存。
    toast.info('浏览器阻止了新窗口，请点击浏览器右上角菜单选择“在浏览器中打开”后保存');
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5"><div><h2 className="text-lg sm:text-xl font-bold text-slate-800">计分表自助生成</h2><p className="text-xs sm:text-sm text-slate-500 mt-1">按队伍或运动员查询出场顺序，选择后自动填充并导出打印版 PDF。</p></div>{imported && <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700"><ClipboardCheck className="w-3.5 h-3.5" />已加载第 {String(imported.source_order_book_version || '-')} 版数据</div>}</div>
      <Card className="border-slate-200 shadow-sm mb-4"><CardContent className="p-4"><div className="flex flex-wrap gap-2 mb-4"><Button variant={mode === 'team' ? 'default' : 'outline'} onClick={() => setMode('team')} className="gap-1.5"><Users className="w-4 h-4" />按队伍查询</Button><Button variant={mode === 'athlete' ? 'default' : 'outline'} onClick={() => setMode('athlete')} className="gap-1.5"><UserRound className="w-4 h-4" />按运动员姓名</Button></div>{mode === 'team' ? <div><Label>选择队伍</Label><select value={teamId} onChange={event => setTeamId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">{teamProfiles.map(team => <option key={team.id} value={team.id}>{team.teamName}</option>)}</select></div> : <div><Label>运动员姓名</Label><div className="flex gap-2 mt-1"><Input value={athleteName} onChange={event => setAthleteName(event.target.value)} placeholder="输入姓名，如：周嘉怡" onKeyDown={event => { if (event.key === 'Enter') void load(); }} /><Button onClick={() => void load()} className="gap-1.5"><Search className="w-4 h-4" />查询</Button></div>{allAthleteNames.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{allAthleteNames.map(name => <button key={name} onClick={() => { setAthleteName(name); setTimeout(() => void load(), 0); }} className="text-xs rounded-full border border-slate-200 px-2.5 py-1 text-slate-600 hover:border-blue-300 hover:text-blue-600">{name}</button>)}</div>}</div>}</CardContent></Card>
      <div className="flex items-center justify-between mb-3"><span className="text-sm text-slate-500">{loading ? '正在查询...' : `共 ${entries.length} 条出场记录`}<span className="ml-3 text-slate-400">已选 {selectedCount} 条</span></span><Button onClick={() => void generatePreview(selectedEntries.length ? selectedEntries : entries)} disabled={loading || exporting || !entries.length} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"><Printer className="w-4 h-4" />{exporting ? '正在生成预览...' : (selectedCount ? `预览已选 ${selectedCount} 条` : '预览计分表')}</Button></div>
      {entries.length > 0 && <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"><label className="inline-flex cursor-pointer items-center gap-2"><input ref={allRef} type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-blue-600" /><span>{allSelected ? '取消全选' : someSelected ? '全选当前列表' : '全选当前列表'}</span></label><span className="text-xs text-slate-400">（{entries.length} 条）</span>{selectedCount > 0 && <button type="button" onClick={() => setSelected({})} className="ml-auto text-xs text-slate-500 hover:text-blue-600">清空选择</button>}</div>}
      {!imported ? <div className="rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center text-sm text-slate-400"><ClipboardCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />管理员尚未导入计分表数据</div> : !entries.length && !loading ? <div className="rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center text-sm text-slate-400">没有匹配的出场记录</div> : <div className="space-y-2">{entries.map(entry => <label key={entry.id} className={`flex items-start gap-3 rounded-lg border bg-white p-3 cursor-pointer transition-colors ${selected[entry.id] ? 'border-blue-400 bg-blue-50/50' : 'border-slate-200 hover:border-blue-200'}`}><input type="checkbox" checked={!!selected[entry.id]} onChange={event => setSelected(prev => ({ ...prev, [entry.id]: event.target.checked }))} className="mt-1 h-4 w-4 accent-blue-600" /><div className="min-w-0 flex-1"><div className="font-semibold text-slate-800">{entry.event_name}</div><div className="text-sm text-slate-600 mt-1">{entry.group_name} · {entry.session_label} · {entry.team_name || entry.club_name}</div><div className="text-sm text-slate-500 mt-1">姓名：{displayNames(entry.athlete_names)}</div></div></label>)}</div>}
      {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="计分表导出预览"><div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div><div className="font-semibold text-slate-800">计分表预览</div><div className="text-xs text-slate-500 mt-0.5">请确认文字位置、字号和三联版式无误后再导出</div></div><Button variant="ghost" size="icon" onClick={closePreview} aria-label="关闭预览"><X className="h-5 w-5" /></Button></div>{isMobileBrowser ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-slate-100 p-6 text-center"><div className="rounded-xl bg-white p-5 shadow-sm"><Printer className="mx-auto mb-3 h-10 w-10 text-blue-600" /><div className="font-semibold text-slate-800">手机浏览器不支持页面内嵌 PDF 预览</div><div className="mt-2 text-sm leading-6 text-slate-500">点击下方按钮，在微信/系统 PDF 查看器中打开原版三联计分表。</div><Button onClick={() => { const opened = window.open(preview.url, '_blank', 'noopener,noreferrer'); if (!opened) toast.info('请点击浏览器右上角菜单，选择“在浏览器中打开”'); }} className="mt-2 gap-1.5 bg-blue-600 text-white hover:bg-blue-700"><Printer className="h-4 w-4" />打开 PDF 预览</Button></div></div> : <iframe title="计分表 PDF 预览" src={preview.url} className="min-h-0 flex-1 bg-slate-100" />}<div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3"><Button variant="outline" onClick={closePreview}>返回修改</Button><Button onClick={() => void confirmExport()} className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700"><Download className="h-4 w-4" />{isMobileBrowser ? '打开系统保存/分享' : '确认并导出 PDF'}</Button></div></div></div>}
    </div>
  );
}
