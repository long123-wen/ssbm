import { useState, useEffect, useRef, useMemo } from 'react';
import { Download, FileText, Trophy, Printer, MapPin, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { competitionStore, orderStore, registrationStore, teamProfileStore } from '@/lib/store';
import { toast } from 'sonner';
import type { Competition, OrderEntry, TeamProfile } from '@/types';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const DEFAULT_VENUES = 8;

export default function AdminOrderBook({ competitionId }: { competitionId: string }) {
  const [comp, setComp] = useState<Competition | null>(null);
  const [entries, setEntries] = useState<OrderEntry[]>([]);
  const [generated, setGenerated] = useState(false);
  const [generationMeta, setGenerationMeta] = useState<{ version: number; entryCount: number; stale: boolean } | null>(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [venueCount, setVenueCount] = useState(DEFAULT_VENUES);

  // 队伍资料映射（clubId → TeamName）
  const [teamMap, setTeamMap] = useState<Record<string, string>>({});

  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [showExcelPreview, setShowExcelPreview] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    competitionStore.getById(competitionId).then(c => setComp(c));
    loadExisting(competitionId);
    // 加载队伍资料
    if (competitionId) {
      teamProfileStore.getByCompetition(competitionId).then(teams => {
        const map: Record<string, string> = {};
        teams.forEach(t => { map[t.clubId] = t.teamName; });
        setTeamMap(map);
      });
    }
  }, [competitionId]);

  const loadExisting = (cid: string) => {
    orderStore.getByCompetition(cid).then(existing => {
      if (existing.length) { setEntries(existing); setGenerated(true); }
      else { setEntries([]); setGenerated(false); }
    });
    registrationStore.getByCompetition(cid).then(regs => {
      setConfirmedCount(regs.filter(r => r.status === 'confirmed').length);
    });
  };

  const handleGenerate = async () => {
    if (!competitionId) return;
    try {
      const result = await orderStore.generate(competitionId, venueCount);
      setGenerationMeta({ version: result.version, entryCount: result.entryCount, stale: result.stale });
      const currentEntries = await orderStore.getByCompetition(competitionId);
      setEntries(currentEntries);
      setGenerated(currentEntries.length > 0);
      toast.success(`出场顺序表已发布（第${result.version}版，${venueCount}个场地，共${result.entryCount}条记录）`);
      loadExisting(competitionId);
    } catch (error: any) {
      toast.error(`生成失败：${error?.message || '请稍后重试'}`);
    }
  };

  const handleExportExcel = () => {
    if (!entries.length || !comp) return;
    const rows: any[][] = [];
    const merges: XLSX.Range[] = [];

    // 表头（第0行）
    rows.push(['项目', '年龄分组', '性别分组', '场次', '单位', '运动员']);

    const map = tableData;
    const sortedEvents = Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], 'zh'));

    for (const [eventName, subGroups] of sortedEvents) {
      const sortedSub = [...subGroups].sort((a, b) => {
        const ageCompare = a.ageGroup.localeCompare(b.ageGroup, 'zh');
        if (ageCompare !== 0) return ageCompare;
        return genderOrder(a.gender) - genderOrder(b.gender);
      });

      // 项目总行数（不含表头，即该项目下所有 entry 行数）
      const eventTotalRows = sortedSub.reduce((sum, g) => sum + g.entries.length, 0);
      const eventStartRow = rows.length; // 当前项目第一行（数据行，不含表头）

      sortedSub.forEach(sg => {
        const sgRowCount = sg.entries.length;
        const sgStartRow = rows.length; // 该组别第一行

        sg.entries.forEach((e, idx) => {
          rows.push([
            // 项目列：该项目第一行写项目名，其余留空（由合并单元格处理）
            idx === 0 && sgStartRow === eventStartRow ? eventName : '',
            // 年龄分组列：该组别第一行写，其余留空
            idx === 0 ? sg.ageGroup : '',
            // 性别分组列：该组别第一行写，其余留空
            idx === 0 ? sg.gender : '',
            e.sessionLabel,
            getUnitName(e),
            e.athletes.join('、'),
          ]);
        });

        // 年龄分组列合并
        if (sgRowCount > 1) {
          merges.push({
            s: { r: sgStartRow, c: 1 },
            e: { r: sgStartRow + sgRowCount - 1, c: 1 },
          });
        }
        // 性别分组列合并
        if (sgRowCount > 1) {
          merges.push({
            s: { r: sgStartRow, c: 2 },
            e: { r: sgStartRow + sgRowCount - 1, c: 2 },
          });
        }
      });

      // 项目列合并（表头是第0行，数据行从第1行开始，所以 eventStartRow 已经是 1-based）
      if (eventTotalRows > 1) {
        merges.push({
          s: { r: eventStartRow, c: 0 },
          e: { r: eventStartRow + eventTotalRows - 1, c: 0 },
        });
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // 应用合并单元格
    ws['!merges'] = merges;

    // 列宽
    ws['!cols'] = [
      { wch: 26 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 28 },
    ];

    // 给所有单元格加边框和居中样式
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < 6; c++) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' };
        const isHeader = r === 0;
        ws[cellRef].s = {
          border: {
            top:    { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left:   { style: 'thin', color: { rgb: '000000' } },
            right:  { style: 'thin', color: { rgb: '000000' } },
          },
          alignment: {
            horizontal: (c === 0 || c === 1 || c === 2 || c === 3) ? 'center' : 'left',
            vertical: 'center',
            wrapText: true,
          },
          ...(isHeader ? {
            font: { bold: true, sz: 11, color: { rgb: '374151' } },
            fill: { fgColor: { rgb: 'F1F5F9' } },
          } : {}),
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '出场顺序表');
    XLSX.writeFile(wb, `${comp?.name}_出场顺序表.xlsx`);
  };

  const handleExportPdf = async (previewOnly = false) => {
    if (!printRef.current || !comp) return;
    if (!previewOnly) setExportingPdf(true);
    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth - 20;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 10;

      pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - 20);

      while (heightLeft > 0) {
        position = -(pageHeight - 20 - position);
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
        heightLeft -= (pageHeight - 20);
      }

      if (previewOnly) {
        // 生成 blob URL 用于预览
        const blob = pdf.output('blob');
        const url = URL.createObjectURL(blob);
        setPdfPreviewUrl(url);
        setShowPdfPreview(true);
      } else {
        pdf.save(`${comp.name}_出场顺序表.pdf`);
        toast.success('PDF 导出成功');
      }
    } catch {
      toast.error('PDF 导出失败，请重试');
    } finally {
      if (!previewOnly) setExportingPdf(false);
    }
  };

  const extractGender = (groupName: string): string => {
    if (groupName.includes('男子')) return '男子组';
    if (groupName.includes('女子')) return '女子组';
    if (groupName.includes('混合')) return '混合组';
    return groupName;
  };

  const extractAgeGroup = (groupName: string): string => {
    const withoutGender = groupName.replace(/(男子|女子|混合)组?/g, '');
    return withoutGender.endsWith('组') ? withoutGender : withoutGender + '组';
  };

  const genderOrder = (g: string) => g === '男子组' ? 1 : g === '女子组' ? 2 : 3;

  /** 获取单位显示名称（优先队伍名，回退俱乐部名） */
  const getUnitName = (e: OrderEntry) => teamMap[e.clubId] || e.clubName;

  // ====== 表数据与统计（缓存 entries 派生，entries 未变时复用同一引用） ======
  const tableData = useMemo(() => {
    const map: Record<string, { eventName: string; gender: string; ageGroup: string; entries: OrderEntry[] }[]> = {};
    entries.forEach(e => {
      const evName = e.eventName;
      if (!map[evName]) map[evName] = [];
      const gender = extractGender(e.groupName);
      const ageGroup = extractAgeGroup(e.groupName);
      let group = map[evName].find(g => g.gender === gender && g.ageGroup === ageGroup);
      if (!group) {
        group = { eventName: evName, gender, ageGroup, entries: [] };
        map[evName].push(group);
      }
      group.entries.push(e);
    });
    return map;
  }, [entries]);

  const totalSessions = useMemo(
    () => entries.length > 0 ? Math.max(...entries.map(e => e.sessionNumber)) : 0,
    [entries]
  );

  const eventCount = useMemo(
    () => {
      const map: Record<string, number> = {};
      entries.forEach(e => { map[e.eventName] = (map[e.eventName] || 0) + 1; });
      return Object.keys(map).length;
    },
    [entries]
  );

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-800">出场顺序表</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-0.5">
            场地分配算法：项目 → 年龄分组 → 性别分组(男子→女子→混合) → 场次-场地编号
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {generated && (
            <>
              <Button variant="outline" onClick={handleExportExcel} className="gap-1.5 text-slate-600">
                <Download className="w-4 h-4" />Excel
              </Button>
              <Button variant="outline" onClick={() => setShowExcelPreview(true)} className="gap-1.5 text-slate-600">
                <Eye className="w-4 h-4" />Excel预览
              </Button>
              <Button variant="outline" onClick={() => handleExportPdf(true)} className="gap-1.5 text-slate-600">
                <Eye className="w-4 h-4" />PDF预览
              </Button>
              <Button variant="outline" onClick={() => handleExportPdf(false)} disabled={exportingPdf} className="gap-1.5 text-slate-600">
                <Printer className="w-4 h-4" />{exportingPdf ? '导出中...' : 'PDF导出'}
              </Button>
            </>
          )}
          <Button onClick={handleGenerate} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
            <FileText className="w-4 h-4" />{generated ? '重新生成' : '生成出场顺序表'}
          </Button>
        </div>
      </div>

      {/* 场地数配置 & 统计 */}
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-slate-600 whitespace-nowrap">
            <MapPin className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
            比赛场地数：
          </Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={venueCount}
            onChange={e => setVenueCount(Math.max(1, Math.min(20, +e.target.value || 1)))}
            className="w-20 h-8 text-sm"
          />
        </div>
        {competitionId && (
          <span className="text-sm text-slate-500">
            已确认报名：<strong className="text-slate-700">{confirmedCount}</strong> 条
          </span>
        )}
        {generated && (
          <>
            <span className="text-sm text-slate-400">|</span>
            <span className="text-sm text-slate-500">
              共 <strong className="text-slate-700">{totalSessions}</strong> 个场次
              · <strong className="text-slate-700">{eventCount}</strong> 个项目
              · <strong className="text-slate-700">{entries.length}</strong> 条记录
            </span>
          </>
        )}
      </div>

      {!generated ? (
        <div className="text-center py-24 text-slate-400 bg-white rounded-xl border border-dashed border-slate-200">
          <FileText className="w-14 h-14 mx-auto mb-4 opacity-25" />
          <p className="text-base">点击「生成出场顺序表」自动编排</p>
          <p className="text-sm mt-2 text-slate-400">
            编排规则：项目顺序 → 年龄分组 → 性别分组 → 报名时间 → {venueCount}场地分配
          </p>
        </div>
      ) : (
        <>
          {/* 在线预览 */}
          <div ref={printRef} className="bg-white rounded-xl shadow-sm overflow-hidden" id="orderbook-preview">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-800 text-center">
                {comp?.name} — 出场顺序表
              </h3>
              <p className="text-sm text-slate-500 text-center mt-1">
                {venueCount} 个比赛场地 · 共 {totalSessions} 场次
              </p>
            </div>
            <div className="space-y-0">
              {Object.entries(tableData).map(([eventName, subGroups]) => {
                const sortedSub = [...subGroups].sort((a, b) => {
                  const ageCompare = a.ageGroup.localeCompare(b.ageGroup, 'zh');
                  if (ageCompare !== 0) return ageCompare;
                  return genderOrder(a.gender) - genderOrder(b.gender);
                });

                return (
                  <div key={eventName} className="border-b border-slate-200 last:border-0">
                    {/* 项目标题 */}
                    <div className="px-5 py-2.5 bg-blue-600 text-white flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-blue-200" />
                      <span className="font-semibold text-sm">{eventName}</span>
                      <Badge className="bg-white/20 text-white border-0 text-xs ml-auto">
                        {sortedSub.reduce((s, g) => s + g.entries.length, 0)} 条
                      </Badge>
                    </div>
              <div className="overflow-x-auto">
                      <table className="w-full text-sm border-collapse" style={{ borderCollapse: 'collapse' }}>
                        <thead className="bg-slate-50" style={{ borderCollapse: 'collapse' }}>
                          <tr>
                            <th className="text-center px-3 py-2 text-slate-600 font-medium text-xs w-[18%]" style={{ border: '1px solid #000000' }}>项目</th>
                            <th className="text-center px-3 py-2 text-slate-600 font-medium text-xs w-[10%]" style={{ border: '1px solid #000000' }}>年龄分组</th>
                            <th className="text-center px-3 py-2 text-slate-600 font-medium text-xs w-[8%]" style={{ border: '1px solid #000000' }}>性别分组</th>
                            <th className="text-center px-3 py-2 text-slate-600 font-medium text-xs w-[10%]" style={{ border: '1px solid #000000' }}>场次</th>
                            <th className="text-center px-3 py-2 text-slate-600 font-medium text-xs w-[22%]" style={{ border: '1px solid #000000' }}>单位</th>
                            <th className="text-center px-3 py-2 text-slate-600 font-medium text-xs" style={{ border: '1px solid #000000' }}>运动员</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedSub.map((sg, sgIdx) => {
                            // 计算该项目的总行数（用于项目列 rowspan）
                            const totalRowsInEvent = sortedSub.reduce((sum, g) => sum + g.entries.length, 0);
                            // 该组别行数
                            const sgRowCount = sg.entries.length;
                            return sg.entries.map((e, idx) => (
                              <tr key={e.id} className="hover:bg-slate-50" style={{ borderCollapse: 'collapse' }}>
                                {/* 项目列 - 仅第一行显示，rowspan 合并 */}
                                {sgIdx === 0 && idx === 0 && (
                                  <td
                                    className="px-3 py-2 text-slate-700 text-sm text-center align-middle font-medium"
                                    rowSpan={totalRowsInEvent}
                                    style={{ border: '1px solid #000000', verticalAlign: 'middle' }}
                                  >
                                    {eventName}
                                  </td>
                                )}
                                {/* 年龄分组列 - 仅该组别第一行显示，rowspan 合并 */}
                                {idx === 0 && (
                                  <td
                                    className="px-3 py-2 text-slate-700 text-sm text-center align-middle"
                                    rowSpan={sgRowCount}
                                    style={{ border: '1px solid #000000', verticalAlign: 'middle' }}
                                  >
                                    {sg.ageGroup}
                                  </td>
                                )}
                                {/* 性别分组列 - 仅该组别第一行显示，rowspan 合并 */}
                                {idx === 0 && (
                                  <td
                                    className="px-3 py-2 text-slate-700 text-sm text-center align-middle"
                                    rowSpan={sgRowCount}
                                    style={{ border: '1px solid #000000', verticalAlign: 'middle' }}
                                  >
                                    {sg.gender}
                                  </td>
                                )}
                                <td className="px-3 py-2 text-center" style={{ border: '1px solid #000000' }}>
                                  <span className="inline-block bg-blue-50 text-blue-700 border border-blue-200 font-mono text-xs px-2 py-0.5 rounded">
                                    {e.sessionLabel}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-slate-800 text-sm" style={{ border: '1px solid #000000' }}>{getUnitName(e)}</td>
                                <td className="px-3 py-2 text-slate-700 text-sm" style={{ border: '1px solid #000000' }}>{e.athletes.join('、')}</td>
                              </tr>
                            ));
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ====== PDF 预览弹窗 ====== */}
      <Dialog open={showPdfPreview} onOpenChange={setShowPdfPreview}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="w-5 h-5 text-blue-600" />
              PDF 预览 — {comp?.name} 出场顺序表
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            {pdfPreviewUrl ? (
              <iframe src={pdfPreviewUrl} className="w-full h-[75vh] border border-slate-200 rounded-lg" />
            ) : (
              <div className="text-center py-20 text-slate-400">正在生成预览...</div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ====== Excel 预览弹窗 ====== */}
      <Dialog open={showExcelPreview} onOpenChange={setShowExcelPreview}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="w-5 h-5 text-green-600" />
              Excel 预览 — {comp?.name} 出场顺序表
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto min-h-0">
            <table className="w-full text-sm border-collapse" style={{ borderCollapse: 'collapse' }}>
              <thead className="bg-slate-50 sticky top-0 z-10">
                <tr>
                  <th className="text-center px-3 py-2.5 text-slate-700 font-semibold text-xs" style={{ border: '1px solid #000000' }}>项目</th>
                  <th className="text-center px-3 py-2.5 text-slate-700 font-semibold text-xs" style={{ border: '1px solid #000000' }}>年龄分组</th>
                  <th className="text-center px-3 py-2.5 text-slate-700 font-semibold text-xs" style={{ border: '1px solid #000000' }}>性别分组</th>
                  <th className="text-center px-3 py-2.5 text-slate-700 font-semibold text-xs" style={{ border: '1px solid #000000' }}>场次</th>
                  <th className="text-center px-3 py-2.5 text-slate-700 font-semibold text-xs" style={{ border: '1px solid #000000' }}>单位</th>
                  <th className="text-center px-3 py-2.5 text-slate-700 font-semibold text-xs" style={{ border: '1px solid #000000' }}>运动员</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sortedEvents = Object.entries(tableData).sort((a, b) => a[0].localeCompare(b[0], 'zh'));
                  return sortedEvents.map(([eventName, subGroups]) => {
                    const sortedSub = [...subGroups].sort((a, b) => {
                      const ageCompare = a.ageGroup.localeCompare(b.ageGroup, 'zh');
                      if (ageCompare !== 0) return ageCompare;
                      return genderOrder(a.gender) - genderOrder(b.gender);
                    });
                    const totalRowsInEvent = sortedSub.reduce((sum, g) => sum + g.entries.length, 0);
                    let isFirstEventRow = true;

                    return sortedSub.map((sg) => {
                      const sgRowCount = sg.entries.length;
                      let isFirstSgRow = true;

                      return sg.entries.map((e) => {
                        const row = (
                          <tr key={e.id} className="hover:bg-slate-50/50">
                            {isFirstEventRow && (
                              <td
                                className="px-3 py-2 text-slate-700 text-sm text-center align-middle font-medium bg-slate-50"
                                rowSpan={totalRowsInEvent}
                                style={{ border: '1px solid #000000', verticalAlign: 'middle' }}
                              >
                                {eventName}
                              </td>
                            )}
                            {isFirstSgRow && (
                              <td
                                className="px-3 py-2 text-slate-700 text-sm text-center align-middle"
                                rowSpan={sgRowCount}
                                style={{ border: '1px solid #000000', verticalAlign: 'middle' }}
                              >
                                {sg.ageGroup}
                              </td>
                            )}
                            {isFirstSgRow && (
                              <td
                                className="px-3 py-2 text-slate-700 text-sm text-center align-middle"
                                rowSpan={sgRowCount}
                                style={{ border: '1px solid #000000', verticalAlign: 'middle' }}
                              >
                                {sg.gender}
                              </td>
                            )}
                            <td className="px-3 py-2 text-center" style={{ border: '1px solid #000000' }}>
                              <span className="inline-block bg-blue-50 text-blue-700 border border-blue-200 font-mono text-xs px-2 py-0.5 rounded">
                                {e.sessionLabel}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-800 text-sm" style={{ border: '1px solid #000000' }}>{getUnitName(e)}</td>
                            <td className="px-3 py-2 text-slate-700 text-sm" style={{ border: '1px solid #000000' }}>{e.athletes.join('、')}</td>
                          </tr>
                        );
                        if (isFirstEventRow) isFirstEventRow = false;
                        if (isFirstSgRow) isFirstSgRow = false;
                        return row;
                      });
                    }).flat();
                  }).flat();
                })()}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
