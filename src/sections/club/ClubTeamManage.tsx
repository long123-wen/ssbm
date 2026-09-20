import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, Edit2, Trash2, UserCheck, GraduationCap, User, Download, Upload, FileSpreadsheet, Camera, X, AlertCircle, CheckCircle, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { leaderStore, coachStore, athleteStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { validateIdCard, extractBirthDate, extractGender } from '@/lib/idCardValidator';
import { extractSheetPhotos } from '@/lib/xlsxPhotos';
import type { TeamLeader, Coach, Athlete } from '@/types';
import * as XLSX from 'xlsx';

interface Props { clubId: string; competitionId: string; teamProfileId: string }

export default function ClubTeamManage({ clubId, competitionId, teamProfileId }: Props) {
  const [leaders, setLeaders] = useState<TeamLeader[]>([]);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);

  // Leader dialog
  const [lDialog, setLDialog] = useState(false);
  const [lEdit, setLEdit] = useState<TeamLeader | null>(null);
  const [lForm, setLForm] = useState({ name: '', phone: '', position: '' });

  // Coach dialog
  const [cDialog, setCDialog] = useState(false);
  const [cEdit, setCEdit] = useState<Coach | null>(null);
  const [cForm, setCForm] = useState({ name: '', phone: '' });

  // Athlete dialog
  const [aDialog, setADialog] = useState(false);
  const [aEdit, setAEdit] = useState<Athlete | null>(null);
  const [aForm, setAForm] = useState({ name: '', gender: 'male', birthDate: '', idCard: '' });
  const [idCardError, setIdCardError] = useState<string | null>(null);
  const [idCardTouched, setIdCardTouched] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [deleteAthleteId, setDeleteAthleteId] = useState<string | null>(null);
  const [deleteCoachId, setDeleteCoachId] = useState<string | null>(null);
  const [deleteLeaderId, setDeleteLeaderId] = useState<string | null>(null);

  // Batch upload
  const [batchType, setBatchType] = useState<'athlete' | null>(null);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchData, setBatchData] = useState<any[]>([]);
  const [batchHeaders, setBatchHeaders] = useState<string[]>([]);
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchResult, setBatchResult] = useState<{ success: number; photoUploaded: number; photoSkipped: number; errors: string[] } | null>(null);
  const [batchPhotoMap, setBatchPhotoMap] = useState<Map<number, string>>(new Map());
  const [batchRowIndex, setBatchRowIndex] = useState<number[]>([]);
  const [batchPhotoLoading, setBatchPhotoLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 按赛事+俱乐部+队伍三维度加载数据（多队伍数据隔离）
  const load = () => {
    Promise.all([
      leaderStore.getByCompetitionClubAndTeam(competitionId, clubId, teamProfileId),
      coachStore.getByCompetitionClubAndTeam(competitionId, clubId, teamProfileId),
      athleteStore.getByCompetitionClubAndTeam(competitionId, clubId, teamProfileId),
    ]).then(([l, c, a]) => {
      setLeaders(l);
      setCoaches(c);
      setAthletes(a);
    });
  };
  useEffect(load, [clubId, competitionId, teamProfileId]);

  // Leader
  const saveLeader = async () => {
    if (!lForm.name || !lForm.phone) return;
    if (lEdit) await leaderStore.update(lEdit.id, lForm);
    else await leaderStore.create({ clubId, competitionId, teamProfileId, ...lForm });
    setLDialog(false); load();
  };
  const openLeader = (l?: TeamLeader) => {
    setLEdit(l || null);
    setLForm(l ? { name: l.name, phone: l.phone, position: l.position || '' } : { name: '', phone: '', position: '' });
    setLDialog(true);
  };

  // Coach
  const saveCoach = async () => {
    if (!cForm.name) return;
    if (cEdit) await coachStore.update(cEdit.id, cForm);
    else await coachStore.create({ clubId, competitionId, teamProfileId, ...cForm });
    setCDialog(false); load();
  };
  const openCoach = (c?: Coach) => {
    setCEdit(c || null);
    setCForm(c ? { name: c.name, phone: c.phone } : { name: '', phone: '' });
    setCDialog(true);
  };

  // Athlete
  const handleIdCardBlur = () => {
    setIdCardTouched(true);
    if (!aForm.idCard.trim()) {
      setIdCardError('请输入身份证号码');
    } else {
      const result = validateIdCard(aForm.idCard);
      setIdCardError(result.valid ? null : (result.error || '身份证号不合法'));

      // 自动填充出生日期和性别
      if (result.valid) {
        const birth = extractBirthDate(aForm.idCard);
        const gender = extractGender(aForm.idCard);
        const updates: any = {};
        if (birth) updates.birthDate = birth;
        if (gender) updates.gender = gender;
        if (Object.keys(updates).length > 0) {
          setAForm(p => ({ ...p, ...updates }));
        }
      }
    }
  };

  const handleIdCardChange = (value: string) => {
    setAForm(p => ({ ...p, idCard: value }));
    if (idCardTouched) {
      const result = validateIdCard(value);
      setIdCardError(result.valid ? null : (result.error || '身份证号不合法'));
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 校验格式
    const validTypes = ['image/jpeg', 'image/png'];
    if (!validTypes.includes(file.type)) {
      toast.error('仅支持 JPG 或 PNG 格式的照片');
      return;
    }

    // 校验大小（2MB）
    if (file.size > 2 * 1024 * 1024) {
      toast.error('照片大小不能超过 2MB');
      return;
    }

    setAvatarFile(file);
    const preview = URL.createObjectURL(file);
    setAvatarPreview(preview);
  };

  const clearAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
    if (aEdit) {
      // 清除已有照片
      aEdit.avatarUrl = undefined;
    }
  };

  const saveAthlete = async () => {
    if (!aForm.name || !aForm.birthDate) return;

    // 身份证校验
    if (aForm.idCard.trim()) {
      const result = validateIdCard(aForm.idCard);
      if (!result.valid) {
        setIdCardTouched(true);
        setIdCardError(result.error || '身份证号不合法');
        toast.error('身份证号校验失败：' + result.error);
        return;
      }
    }

    try {
      let avatarUrl = aEdit?.avatarUrl || undefined;

      // 上传照片
      if (avatarFile) {
        setAvatarUploading(true);
        try {
          const fileExt = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg';
          const fileName = `${clubId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`;

          const { data: uploadData, error: uploadErr } = await supabase.storage
            .from('athlete-avatars')
            .upload(fileName, avatarFile, { upsert: true, contentType: avatarFile.type });

          if (uploadErr) throw uploadErr;

          // 获取公开URL
          const { data: urlData } = supabase.storage
            .from('athlete-avatars')
            .getPublicUrl(fileName);

          avatarUrl = urlData.publicUrl;

          // 删除旧照片（如果有）
          if (aEdit?.avatarUrl && aEdit.avatarUrl.includes('athlete-avatars')) {
            try {
              const oldPath = new URL(aEdit.avatarUrl).pathname.split('/athlete-avatars/')[1];
              if (oldPath) {
                await supabase.storage.from('athlete-avatars').remove([oldPath]);
              }
            } catch { /* 忽略旧文件删除错误 */ }
          }
        } catch (uploadErr: any) {
          // Storage 不可用，回退到 base64
          console.warn('Storage upload failed, falling back to base64:', uploadErr.message);
          const reader = new FileReader();
          avatarUrl = await new Promise<string>((resolve) => {
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(avatarFile);
          });
        } finally {
          setAvatarUploading(false);
        }
      } else if (aEdit && avatarPreview === null && aEdit.avatarUrl) {
        // 用户清除了照片
        avatarUrl = undefined;
      }

      if (aEdit) {
        await athleteStore.update(aEdit.id, {
          ...aForm,
          gender: aForm.gender as any,
          avatarUrl: avatarUrl as any,
        } as any);
      } else {
        await athleteStore.create({
          clubId,
          competitionId,
          teamProfileId,
          ...aForm,
          gender: aForm.gender as any,
          avatarUrl: avatarUrl as any,
        } as any);
      }
      setADialog(false); load();
    } catch (err: any) {
      console.error('运动员保存失败:', err);
      const msg = err?.message || err?.details || err?.hint || '未知错误';
      toast.error('保存失败：' + msg);
    }
  };

  // 确认删除运动员
  const confirmDeleteAthlete = async () => {
    if (!deleteAthleteId) return;
    try {
      await athleteStore.delete(deleteAthleteId);
      load();
      toast.success('运动员已删除');
    } catch (err: any) {
      toast.error('删除失败：' + (err?.message || '未知错误'));
    }
    setDeleteAthleteId(null);
  };

  // 确认删除教练
  const confirmDeleteCoach = async () => {
    if (!deleteCoachId) return;
    try {
      await coachStore.delete(deleteCoachId);
      load();
      toast.success('教练员已删除');
    } catch (err: any) {
      toast.error('删除失败：' + (err?.message || '未知错误'));
    }
    setDeleteCoachId(null);
  };

  // 确认删除领队
  const confirmDeleteLeader = async () => {
    if (!deleteLeaderId) return;
    try {
      await leaderStore.delete(deleteLeaderId);
      load();
      toast.success('领队已删除');
    } catch (err: any) {
      toast.error('删除失败：' + (err?.message || '未知错误'));
    }
    setDeleteLeaderId(null);
  };
  const openAthlete = (a?: Athlete) => {
    setAEdit(a || null);
    setAForm(a ? { name: a.name, gender: a.gender, birthDate: a.birthDate, idCard: a.idCard || '' } : { name: '', gender: 'male', birthDate: '', idCard: '' });
    setIdCardError(null);
    setIdCardTouched(false);
    setAvatarFile(null);
    setAvatarPreview(a?.avatarUrl || null);
    setADialog(true);
  };

  // ========== 批量上传逻辑 ==========
  const formatDate = (val: any): string => {
    if (!val) return '';
    if (val instanceof Date) return val.toISOString().split('T')[0];
    if (typeof val === 'string') return val;
    if (typeof val === 'number') {
      const d = new Date((val - 25569) * 86400000);
      return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
    }
    return '';
  };

  /**
   * 把 dataURL 图片上传到 athlete-avatars 存储桶；返回公开 URL；失败返回 null。
   * dataURL 形如 "data:image/jpeg;base64,xxxxx" 或 "data:image/png;base64,xxxxx"。
   */
  const uploadAthleteAvatarFromDataUrl = async (dataUrl: string): Promise<string | null> => {
    try {
      const m = /^data:image\/([a-z0-9+.-]+);base64,(.+)$/i.exec(dataUrl);
      if (!m) return null;
      const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
      const b64 = m[2];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const fileName = `${clubId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const blob = new Blob([bytes], { type: `image/${ext}` });
      const { error: upErr } = await supabase.storage
        .from('athlete-avatars')
        .upload(fileName, blob, { upsert: true, contentType: `image/${ext}` });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('athlete-avatars').getPublicUrl(fileName);
      return urlData.publicUrl;
    } catch (err) {
      console.warn('batch avatar upload failed:', err);
      return null;
    }
  };

  /** 检测单元格值是否为图片 base64（dataURL 或裸 base64）。 */
  const extractPhotoDataUrl = (val: any): string | null => {
    if (typeof val !== 'string') return null;
    const s = val.trim();
    if (!s) return null;
    if (/^data:image\/[a-z0-9+.-]+;base64,/i.test(s)) return s;
    // 裸 base64：长度 ≥ 80 且仅含 base64 字符
    if (s.length >= 80 && /^[A-Za-z0-9+/=]+$/.test(s)) return `data:image/jpeg;base64,${s}`;
    return null;
  };

  const handleBatchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet) as Record<string, any>[];
        if (jsonData.length > 0) {
          setBatchHeaders(Object.keys(jsonData[0]));
          setBatchData(jsonData);
          setBatchResult(null);
          setBatchPhotoLoading(true);
          // 建立 jsonData 行 → 工作表行号(0 基) 的映射（用于匹配单元格内的嵌入图片）
          const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null }) as any[][];
          const header: any[] = rawRows[0] || [];
          const nameCol = header.findIndex(h => String(h || '').trim() === '姓名');
          const idCol = header.findIndex(h => String(h || '').trim() === '身份证号');
          const rowsIdx = jsonData.map(row => {
            const n = String(row['姓名'] || '').trim();
            const idc = String(row['身份证号'] || '').trim();
            for (let k = 1; k < rawRows.length; k++) {
              const rn = nameCol >= 0 ? String(rawRows[k]?.[nameCol] ?? '').trim() : '';
              const ri = idCol >= 0 ? String(rawRows[k]?.[idCol] ?? '').trim() : '';
              if ((idc && ri && ri === idc) || (n && rn && rn === n)) return k;
            }
            return -1;
          });
          setBatchRowIndex(rowsIdx);
          extractSheetPhotos(file).then(map => {
            setBatchPhotoMap(map);
            setBatchPhotoLoading(false);
            const count = rowsIdx.filter(r => r >= 0 && map.has(r)).length;
            if (count > 0) toast.success(`识别到 ${count} 张单元格内图片`);
          }).catch(() => setBatchPhotoLoading(false));
        } else {
          toast.error('文件中没有数据');
        }
      } catch (err: any) {
        toast.error('文件解析失败：' + (err.message || '请检查文件格式'));
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleBatchImport = async () => {
    if (batchData.length === 0) return;
    setBatchImporting(true);
    setBatchResult(null);
    const errors: string[] = [];
    const inputs: any[] = [];

    for (let i = 0; i < batchData.length; i++) {
      const row = batchData[i];
      try {
        const name = String(row['姓名'] || '').trim();
        if (!name) { errors.push(`第${i + 2}行：缺少姓名`); continue; }
        // 照片优先取「单元格内嵌入的图片」，其次取「照片」列里的 base64
        const sheetRow = batchRowIndex[i];
        const embedded = sheetRow !== undefined && sheetRow >= 0 ? batchPhotoMap.get(sheetRow) : undefined;
        const photo = embedded || extractPhotoDataUrl(row['照片']);
        inputs.push({
          rowIndex: i,
          data: {
            clubId,
            competitionId,
            teamProfileId,
            name,
            gender: String(row['性别'] || '') === '女' ? 'female' : 'male',
            birthDate: formatDate(row['出生日期']),
            idCard: String(row['身份证号'] || '').trim(),
          },
          photo,
        });
      } catch (err: any) {
        errors.push(`第${i + 2}行：数据格式错误`);
      }
    }

    if (inputs.length === 0) {
      setBatchResult({ success: 0, photoUploaded: 0, photoSkipped: 0, errors });
      setBatchImporting(false);
      return;
    }

    // 先把含照片的上传到 R2（并行；失败的留空 avatarUrl，运动员照常入库）
    let photoUploaded = 0, photoSkipped = 0;
    const photoResults = await Promise.all(inputs.map(async (it) => {
      if (!it.photo) return null;
      const url = await uploadAthleteAvatarFromDataUrl(it.photo);
      if (url) photoUploaded++;
      else photoSkipped++;
      return url;
    }));
    const finalInputs = inputs.map((it, idx) => ({
      ...it.data,
      avatarUrl: photoResults[idx] || undefined,
    }));

    try {
      const result = await athleteStore.batchCreate(finalInputs);
      setBatchResult({ success: result.length, photoUploaded, photoSkipped, errors });
      const summary = [`成功导入 ${result.length} 名`];
      if (photoUploaded) summary.push(`上传照片 ${photoUploaded} 张`);
      if (photoSkipped) summary.push(`${photoSkipped} 张照片无效（已跳过）`);
      toast.success(summary.join('，'));
      if (result.length > 0) load();
    } catch (err: any) {
      toast.error('导入失败：' + (err.message || '未知错误'));
    } finally {
      setBatchImporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const templateData = [{
      '姓名': '张三', '性别': '男', '出生日期': '2010-01-01', '身份证号': '110101201001011234',
      '照片': '', // 列提示：本列可选，填图片的 base64（dataURL 或裸 base64），可用 base64-image.de 等工具转换
    }];
    // 写一行说明占位（用注释形式，不影响数据）
    const ws = XLSX.utils.json_to_sheet(templateData);
    // 表头追加「照片(base64)（可选）」说明（写在批注里）
    const headers = ['姓名', '性别', '出生日期', '身份证号', '照片'];
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A1' });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '运动员_模板.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const closeBatchDialog = () => {
    setBatchType(null);
    setBatchFile(null);
    setBatchData([]);
    setBatchHeaders([]);
    setBatchResult(null);
    setBatchPhotoMap(new Map());
    setBatchRowIndex([]);
    setBatchPhotoLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 顶部 3 张统计卡片（依赖 3 个 list 长度，未变时复用同一引用）
  const summaryCards = useMemo(() => [
    { label: '领队', count: leaders.length, icon: <UserCheck className="w-4 h-4 sm:w-5 sm:h-5" />, color: 'blue' },
    { label: '教练员', count: coaches.length, icon: <GraduationCap className="w-4 h-4 sm:w-5 sm:h-5" />, color: 'emerald' },
    { label: '运动员', count: athletes.length, icon: <User className="w-4 h-4 sm:w-5 sm:h-5" />, color: 'violet' },
  ], [leaders.length, coaches.length, athletes.length]);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-xl font-bold text-slate-800">团队管理</h2>
        <p className="text-slate-500 text-xs sm:text-sm mt-0.5">管理领队、教练员和运动员信息</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
        {summaryCards.map(s => (
          <Card key={s.label} className="bg-white border-0 shadow-sm">
            <CardContent className="p-2.5 sm:p-4 flex flex-col sm:flex-row items-center sm:gap-3 gap-1 text-center sm:text-left">
              <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-${s.color}-50 flex items-center justify-center text-${s.color}-600 shrink-0`}>
                {s.icon}
              </div>
              <div>
                <div className="text-xl sm:text-2xl font-bold text-slate-800">{s.count}</div>
                <div className="text-xs sm:text-sm text-slate-500">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="athletes" className="bg-white rounded-xl shadow-sm">
        <div className="px-3 sm:px-5 pt-3 sm:pt-4 border-b border-slate-100">
          <TabsList className="bg-slate-100 w-full sm:w-auto">
            <TabsTrigger value="athletes" className="flex-1 sm:flex-none">运动员</TabsTrigger>
            <TabsTrigger value="coaches" className="flex-1 sm:flex-none">教练员</TabsTrigger>
            <TabsTrigger value="leaders" className="flex-1 sm:flex-none">领队</TabsTrigger>
          </TabsList>
        </div>

        <AthletesTab
          athletes={athletes}
          onAdd={() => openAthlete()}
          onEdit={openAthlete}
          onDelete={setDeleteAthleteId}
          onBatchUpload={() => setBatchType('athlete')}
          onDownloadTemplate={handleDownloadTemplate}
        />

        <CoachesTab
          coaches={coaches}
          onAdd={() => openCoach()}
          onEdit={openCoach}
          onDelete={setDeleteCoachId}
        />

        <LeadersTab
          leaders={leaders}
          onAdd={() => openLeader()}
          onEdit={openLeader}
          onDelete={setDeleteLeaderId}
        />
      </Tabs>

      {/* Leader Dialog */}
      <Dialog open={lDialog} onOpenChange={setLDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader><DialogTitle>{lEdit ? '编辑领队' : '添加领队'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>姓名 *</Label><Input className="mt-1 h-11" value={lForm.name} onChange={e => setLForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>联系电话 *</Label><Input className="mt-1 h-11" inputMode="tel" value={lForm.phone} onChange={e => setLForm(p => ({ ...p, phone: e.target.value }))} /></div>
            <div><Label>职位 *</Label><Input className="mt-1 h-11" placeholder="如：领队、副领队" value={lForm.position} onChange={e => setLForm(p => ({ ...p, position: e.target.value }))} /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLDialog(false)}>取消</Button>
            <Button onClick={saveLeader} className="bg-blue-600 hover:bg-blue-700 text-white">保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Coach Dialog */}
      <Dialog open={cDialog} onOpenChange={setCDialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader><DialogTitle>{cEdit ? '编辑教练员' : '添加教练员'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>姓名 *</Label><Input className="mt-1 h-11" value={cForm.name} onChange={e => setCForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>联系电话 *</Label><Input className="mt-1 h-11" inputMode="tel" value={cForm.phone} onChange={e => setCForm(p => ({ ...p, phone: e.target.value }))} /></div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCDialog(false)}>取消</Button>
            <Button onClick={saveCoach} className="bg-emerald-600 hover:bg-emerald-700 text-white">保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Athlete Dialog */}
      <Dialog open={aDialog} onOpenChange={setADialog}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
          <DialogHeader><DialogTitle>{aEdit ? '编辑运动员' : '添加运动员'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            {/* 照片上传 */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative group">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="运动员照片" className="w-24 h-24 rounded-full object-cover border-2 border-slate-200 shadow-sm" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-slate-100 border-2 border-dashed border-slate-300 flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-slate-300" />
                  </div>
                )}
                <label className="absolute bottom-0 right-0 w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center cursor-pointer shadow hover:bg-blue-700 transition-colors">
                  <Camera className="w-3.5 h-3.5 text-white" />
                  <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleAvatarChange} />
                </label>
                {avatarPreview && (
                  <button onClick={clearAvatar} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white shadow hover:bg-red-600 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-400">免冠照片（JPG/PNG，≤2MB）</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><Label>姓名 *</Label><Input className="mt-1 h-11" value={aForm.name} onChange={e => setAForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div>
                <Label>性别 *</Label>
                <Select value={aForm.gender} onValueChange={v => setAForm(p => ({ ...p, gender: v }))}>
                  <SelectTrigger className="mt-1 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">男</SelectItem>
                    <SelectItem value="female">女</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>出生日期 *</Label><Input className="mt-1 h-11" type="date" value={aForm.birthDate} onChange={e => setAForm(p => ({ ...p, birthDate: e.target.value }))} /></div>
            <div>
              <Label>身份证号 *</Label>
              <div className="relative">
                <Input
                  className={`mt-1 h-11 ${idCardTouched && idCardError ? 'border-red-400 pr-8 focus-visible:ring-red-300' : idCardTouched && !idCardError && aForm.idCard ? 'border-green-400 pr-8 focus-visible:ring-green-300' : ''}`}
                  placeholder="18位身份证号码"
                  value={aForm.idCard}
                  onChange={e => handleIdCardChange(e.target.value)}
                  onBlur={handleIdCardBlur}
                  maxLength={18}
                />
                {idCardTouched && aForm.idCard && (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    {idCardError ? (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    ) : (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                  </span>
                )}
              </div>
              {idCardTouched && idCardError && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {idCardError}
                </p>
              )}
              {idCardTouched && !idCardError && aForm.idCard && (
                <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  身份证号格式正确
                </p>
              )}
              <p className="text-xs text-slate-400 mt-0.5">输入后自动校验，可自动填充出生日期和性别</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setADialog(false)}>取消</Button>
            <Button
              onClick={saveAthlete}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={avatarUploading || (idCardTouched && !!idCardError)}
            >
              {avatarUploading ? '上传中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除运动员确认对话框 */}
      <AlertDialog open={!!deleteAthleteId} onOpenChange={() => setDeleteAthleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除运动员？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该运动员的所有报名记录也将被删除，此操作不可撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteAthlete} className="bg-red-600 hover:bg-red-700">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除教练员确认对话框 */}
      <AlertDialog open={!!deleteCoachId} onOpenChange={() => setDeleteCoachId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除教练员？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该教练员的所有关联信息将被删除，此操作不可撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteCoach} className="bg-red-600 hover:bg-red-700">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除领队确认对话框 */}
      <AlertDialog open={!!deleteLeaderId} onOpenChange={() => setDeleteLeaderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除领队？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该领队的所有关联信息将被删除，此操作不可撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteLeader} className="bg-red-600 hover:bg-red-700">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ====== 批量上传弹窗 ====== */}
      <Dialog open={!!batchType} onOpenChange={(open) => { if (!open) closeBatchDialog(); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-green-600" />
              批量上传运动员
            </DialogTitle>
          </DialogHeader>

          {batchData.length === 0 ? (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-blue-400 transition-colors">
                <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600 mb-1">将 Excel 文件拖拽到此处，或点击选择</p>
                <p className="text-xs text-slate-400 mb-4">支持 .xlsx / .xls 格式；模板含「照片」列（可选，填图片 base64）</p>
                <div className="flex gap-2 justify-center">
                  <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => handleDownloadTemplate()}>
                    <Download className="w-3.5 h-3.5" />下载模板
                  </Button>
                  <Button size="sm" className="h-9 gap-1" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="w-3.5 h-3.5" />选择文件
                  </Button>
                </div>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBatchFileChange} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-700">数据预览</p>
                  <p className="text-xs text-slate-500">共解析 {batchData.length} 条记录，确认后导入</p>
                </div>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setBatchData([]); setBatchFile(null); setBatchResult(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                  重新选择
                </Button>
              </div>

              <div className="border rounded-lg overflow-x-auto max-h-60">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">#</th>
                      {batchHeaders.map(h => (
                        <th key={h} className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {batchData.map((row, i) => (
                      <tr key={i} className="border-t hover:bg-slate-50">
                        <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                        {batchHeaders.map(h => (
                          <td key={h} className="px-3 py-1.5 whitespace-nowrap">{row[h] != null ? String(row[h]) : ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {batchResult && (
                <div className={`rounded-lg p-3 text-sm ${batchResult.errors.length > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                  <p className="font-medium">成功导入 {batchResult.success} 条</p>
                  {(batchResult.photoUploaded > 0 || batchResult.photoSkipped > 0) && (
                    <p className="text-xs mt-1 text-slate-600">
                      上传照片 {batchResult.photoUploaded} 张
                      {batchResult.photoSkipped > 0 && `，${batchResult.photoSkipped} 张无效已跳过`}
                    </p>
                  )}
                  {batchResult.errors.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto">
                      {batchResult.errors.map((e, i) => (
                        <p key={i} className="text-xs text-red-600">{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={closeBatchDialog}>关闭</Button>
                <Button onClick={handleBatchImport} disabled={batchImporting || batchData.length === 0} className="bg-green-600 hover:bg-green-700 text-white">
                  {batchImporting ? '导入中...' : `确认导入 ${batchData.length} 条`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ====== 子组件：运动员 Tab ======
interface AthletesTabProps {
  athletes: Athlete[];
  onAdd: () => void;
  onEdit: (a: Athlete) => void;
  onDelete: (id: string) => void;
  onBatchUpload: () => void;
  onDownloadTemplate: () => void;
}

function AthletesTab({ athletes, onAdd, onEdit, onDelete, onBatchUpload, onDownloadTemplate }: AthletesTabProps) {
  return (
    <TabsContent value="athletes" className="p-3 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 sm:mb-4 gap-2">
        <span className="text-sm text-slate-600">共 {athletes.length} 名运动员</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onDownloadTemplate}>
            <Download className="w-3 h-3" />模板
          </Button>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={onBatchUpload}>
            <Upload className="w-3 h-3" />批量上传
          </Button>
          <Button size="sm" onClick={onAdd} className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5">
            <Plus className="w-3.5 h-3.5" />添加
          </Button>
        </div>
      </div>
      {athletes.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
          暂无运动员，点击右上角添加
        </div>
      ) : (
        <div className="space-y-2">
          {athletes.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-lg">
              {a.avatarUrl ? (
                <img src={a.avatarUrl} alt={a.name} className="w-8 h-8 rounded-full object-cover border-2 border-white shadow-sm" />
              ) : (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${a.gender === 'male' ? 'bg-blue-500' : 'bg-pink-500'}`}>
                  {a.name[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800 text-sm">{a.name}</div>
                <div className="text-xs text-slate-500">
                  {a.gender === 'male' ? '男' : '女'} · {a.birthDate}
                  {a.idCard && ` · 证件：${a.idCard.slice(0, 6)}****`}
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => onEdit(a)} className="p-1.5 text-slate-400 hover:text-slate-600">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(a.id)} className="p-1.5 text-slate-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </TabsContent>
  );
}

// ====== 子组件：教练员 Tab ======
interface CoachesTabProps {
  coaches: Coach[];
  onAdd: () => void;
  onEdit: (c: Coach) => void;
  onDelete: (id: string) => void;
}

function CoachesTab({ coaches, onAdd, onEdit, onDelete }: CoachesTabProps) {
  return (
    <TabsContent value="coaches" className="p-3 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 sm:mb-4 gap-2">
        <span className="text-sm text-slate-600">共 {coaches.length} 名教练员</span>
        <Button size="sm" onClick={onAdd} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5">
          <Plus className="w-3.5 h-3.5" />添加
        </Button>
      </div>
      {coaches.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
          暂无教练员，点击右上角添加
        </div>
      ) : (
        <div className="space-y-2">
          {coaches.map(c => (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-xs font-bold">
                {c.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-800 text-sm">{c.name}</div>
                <div className="text-xs text-slate-500">{c.phone}</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => onEdit(c)} className="p-1.5 text-slate-400 hover:text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => onDelete(c.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </TabsContent>
  );
}

// ====== 子组件：领队 Tab ======
interface LeadersTabProps {
  leaders: TeamLeader[];
  onAdd: () => void;
  onEdit: (l: TeamLeader) => void;
  onDelete: (id: string) => void;
}

function LeadersTab({ leaders, onAdd, onEdit, onDelete }: LeadersTabProps) {
  return (
    <TabsContent value="leaders" className="p-3 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 sm:mb-4 gap-2">
        <span className="text-sm text-slate-600">共 {leaders.length} 名领队</span>
        <Button size="sm" onClick={onAdd} className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
          <Plus className="w-3.5 h-3.5" />添加
        </Button>
      </div>
      {leaders.length === 0 ? (
        <div className="text-center py-10 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
          暂无领队信息，点击右上角添加
        </div>
      ) : (
        <div className="space-y-2">
          {leaders.map(l => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold">{l.name[0]}</div>
              <div className="flex-1"><div className="font-medium text-slate-800 text-sm">{l.name}</div><div className="text-xs text-slate-500">{l.phone} · {l.position || '无职位'}</div></div>
              <div className="flex gap-1">
                <button onClick={() => onEdit(l)} className="p-1.5 text-slate-400 hover:text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>
                <button onClick={() => onDelete(l.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </TabsContent>
  );
}

