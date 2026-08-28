import { useEffect, useState } from 'react';
import { ClipboardCheck, RefreshCw, Database, CheckCircle2, XCircle, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { scorecardStore } from '@/lib/store';
import { toast } from 'sonner';

export default function AdminScorecards({ competitionId }: { competitionId: string }) {
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setCurrent(await scorecardStore.getCurrentImport(competitionId)); }
    catch (error: any) { toast.error(error?.message || '读取计分表导入状态失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [competitionId]);

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await scorecardStore.importCurrent(competitionId);
      toast.success(`${result.reused ? '当前版本已导入' : '出场顺序导入成功'}，共 ${result.entryCount} 条计分表数据`);
      await load();
    } catch (error: any) { toast.error(error?.message || '导入失败，请先发布出场顺序'); }
    finally { setImporting(false); }
  };

  const handleUnpublish = async () => {
    setUnpublishing(true);
    try {
      await scorecardStore.unpublish(competitionId);
      toast.success('已取消发布，报名端不再显示该版本计分表');
      await load();
    } catch (error: any) { toast.error(error?.message || '取消发布失败'); }
    finally { setUnpublishing(false); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-800">计分表数据</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">导入已发布的出场顺序，供用户自助查询和生成打印版计分表。</p>
        </div>
        <Button onClick={handleImport} disabled={importing || loading || unpublishing} className="gap-2 bg-blue-600 hover:bg-blue-700 text-white">
          {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
          {importing ? '导入中...' : '导入当前出场顺序'}
        </Button>
      </div>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><ClipboardCheck className="w-5 h-5 text-blue-600" />当前计分表数据版本</CardTitle></CardHeader>
        <CardContent>
          {loading ? <div className="py-8 text-center text-sm text-slate-400">正在读取...</div> : current ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">出场顺序版本</div><div className="text-xl font-bold text-slate-800 mt-1">第 {String(current.source_order_book_version || '-')} 版</div></div>
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">计分表记录</div><div className="text-xl font-bold text-slate-800 mt-1">{String(current.entry_count || 0)} 条</div></div>
                <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">导入时间</div><div className="text-sm font-semibold text-slate-700 mt-2">{current.imported_at ? new Date(String(current.imported_at)).toLocaleString() : '-'}</div></div>
                <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs text-emerald-600">状态</div><div className="text-sm font-semibold text-emerald-700 mt-2 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />已发布</div></div>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={unpublishing} className="gap-2 text-slate-600 hover:text-red-600 hover:border-red-300">
                      <Power className="w-4 h-4" />取消发布
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认取消发布？</AlertDialogTitle>
                      <AlertDialogDescription>
                        取消发布后，报名端「计分表」页将不再显示任何计分表数据（场地顺序、人员分配等全部隐藏）。
                        重新点击「导入当前出场顺序」可恢复发布。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>返回</AlertDialogCancel>
                      <AlertDialogAction onClick={handleUnpublish} disabled={unpublishing} className="bg-red-600 hover:bg-red-700 text-white">
                        {unpublishing ? '处理中...' : '确认取消发布'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </>
          ) : <div className="py-10 text-center text-sm text-slate-400">尚未导入出场顺序，请先在“出场顺序”页面生成并发布，然后点击上方按钮。</div>}
        </CardContent>
      </Card>
    </div>
  );
}
