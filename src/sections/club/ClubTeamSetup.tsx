import { useState } from 'react';
import {
  Trophy, Camera, X, ArrowRight, ArrowLeft,
  Shield, Flag, Quote, Loader2, CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { teamProfileStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import ThemeToggle from '@/components/ThemeToggle';
import type { Competition, ClubAccount, TeamProfile } from '@/types';

interface Props {
  club: ClubAccount;
  competition: Competition;
  existingProfile?: TeamProfile;
  onBack: () => void;
  onContinue: () => void;
}

export default function ClubTeamSetup({ club, competition, existingProfile: externalProfile, onBack, onContinue }: Props) {
  const isEditing = !!externalProfile;
  const [teamName, setTeamName] = useState(externalProfile?.teamName || club.clubName || '');
  const [slogan, setSlogan] = useState(externalProfile?.slogan || '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(externalProfile?.logoUrl || null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 格式校验
    if (!['image/jpeg', 'image/png', 'image/svg+xml'].includes(file.type)) {
      toast.error('仅支持 JPG、PNG 或 SVG 格式的队徽');
      return;
    }

    // 大小校验（1MB）
    if (file.size > 1 * 1024 * 1024) {
      toast.error('队徽大小不能超过 1MB');
      return;
    }

    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
  };

  const handleSave = async () => {
    if (!teamName.trim()) {
      toast.error('请输入队伍名称');
      return;
    }

    setSaving(true);
    try {
      let logoUrl: string | undefined = externalProfile?.logoUrl || undefined;

      // 上传队徽
      if (logoFile) {
        setLogoUploading(true);
        try {
          const fileExt = logoFile.name.split('.').pop()?.toLowerCase() || 'png';
          const fileName = `team-logos/${club.id}/${competition.id}/${Date.now()}.${fileExt}`;

          const { data: uploadData, error: uploadErr } = await supabase.storage
            .from('athlete-avatars')
            .upload(fileName, logoFile, { upsert: true, contentType: logoFile.type });

          if (uploadErr) throw uploadErr;

          const { data: urlData } = supabase.storage
            .from('athlete-avatars')
            .getPublicUrl(fileName);

          logoUrl = urlData.publicUrl;
        } catch (uploadErr: any) {
          console.warn('队徽上传失败，回退到 base64:', uploadErr.message);
          const reader = new FileReader();
          logoUrl = await new Promise<string>((resolve) => {
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(logoFile);
          });
        } finally {
          setLogoUploading(false);
        }
      } else if (logoPreview === null && externalProfile?.logoUrl) {
        // 用户清除了队徽
        logoUrl = undefined;
      }

      if (externalProfile) {
        const updated = await teamProfileStore.update(externalProfile.id, {
          teamName: teamName.trim(),
          slogan: slogan.trim() || undefined,
          logoUrl,
        });
        if (!updated) throw new Error('更新失败');
        toast.success('队伍资料已更新');
      } else {
        await teamProfileStore.create({
          clubId: club.id,
          competitionId: competition.id,
          teamName: teamName.trim(),
          slogan: slogan.trim() || undefined,
          logoUrl,
        });
        toast.success('队伍创建成功！');
      }

      onContinue();
    } catch (err: any) {
      console.error('保存队伍资料失败:', err);
      toast.error('保存失败：' + (err?.message || '请重试'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 flex flex-col">
      {/* Header */}
      <header className="h-14 bg-white/80 backdrop-blur-sm border-b border-slate-200/80 flex items-center px-4 lg:px-6 gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Trophy className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-semibold text-sm text-slate-800">队伍创建</h1>
            <p className="text-[11px] text-slate-400">{club.clubName}</p>
          </div>
        </div>
        <div className="flex-1" />
        <ThemeToggle />
        <Badge variant="outline" className="text-[11px] text-slate-600 border-slate-300 bg-white font-medium hidden sm:inline-flex">
          {club.clubName}
        </Badge>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-auto p-4 lg:p-8 flex items-start justify-center pt-8 lg:pt-16">
        <div className="w-full max-w-lg">
          {/* Step indicator */}
          <div className="mb-8 flex items-center justify-center gap-1">
            {[
              { num: 1, label: '选择赛事', done: true },
              { num: 2, label: '队伍创建', active: true },
              { num: 3, label: '报名与提交', active: false, done: false },
            ].map((s, i, arr) => (
              <div key={s.num} className="flex items-center gap-1">
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    s.done ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-200' :
                    s.active ? 'bg-blue-600 text-white shadow-sm shadow-blue-200' :
                    'bg-slate-100 text-slate-400'
                  }`}>
                    {s.done ? <CheckCircle2 className="w-4 h-4" /> : s.num}
                  </div>
                  <span className={`text-[11px] mt-1 font-medium whitespace-nowrap ${
                    s.active ? 'text-blue-600' : s.done ? 'text-emerald-600' : 'text-slate-400'
                  }`}>{s.label}</span>
                </div>
                {i < arr.length - 1 && (
                  <div className={`w-8 lg:w-12 h-0.5 mb-5 ${s.done ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                )}
              </div>
            ))}
          </div>

          {/* Card */}
          <Card className="bg-white border-0 shadow-sm overflow-hidden">
            <CardContent className="p-6 lg:p-8">
              {/* Welcome text */}
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 mb-4 shadow-lg shadow-blue-500/20">
                  <Flag className="w-6 h-6 text-white" />
                </div>
                <h2 className="text-xl font-bold text-slate-800 mb-1">
                  {isEditing ? '编辑队伍资料' : '创建参赛队伍'}
                </h2>
                <p className="text-sm text-slate-500">
                  为「{competition.name}」设置队伍信息
                </p>
              </div>

              <Separator className="mb-6" />

              {/* Logo upload */}
              <div className="flex flex-col items-center gap-3 mb-6">
                <div className="relative group">
                  {logoPreview ? (
                    <img
                      src={logoPreview}
                      alt="队徽预览"
                      className="w-24 h-24 rounded-2xl object-cover border-2 border-slate-200 shadow-sm"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-300 flex items-center justify-center group-hover:border-blue-400 group-hover:bg-blue-50/50 transition-colors">
                      <Shield className="w-10 h-10 text-slate-300 group-hover:text-blue-400 transition-colors" />
                    </div>
                  )}
                  <label className="absolute bottom-0 right-0 w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center cursor-pointer shadow hover:bg-blue-700 transition-colors">
                    <Camera className="w-3.5 h-3.5 text-white" />
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/svg+xml"
                      className="hidden"
                      onChange={handleLogoChange}
                    />
                  </label>
                  {logoPreview && (
                    <button
                      onClick={clearLogo}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white shadow hover:bg-red-600 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-500">上传队徽（可选）</p>
                  <p className="text-[11px] text-slate-400">JPG/PNG/SVG，不超过 1MB</p>
                </div>
              </div>

              {/* Team name */}
              <div className="mb-5">
                <Label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1">
                  队伍名称 <span className="text-red-400">*</span>
                </Label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Flag className="w-4 h-4" />
                  </div>
                  <Input
                    className="pl-10 h-11 text-base"
                    placeholder="请输入参赛队伍名称"
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                    maxLength={30}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {teamName.length}/30 字符
                  {teamName.trim() === '' && ' — 默认使用俱乐部名称'}
                </p>
              </div>

              {/* Slogan */}
              <div className="mb-6">
                <Label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1">
                  队伍口号 <span className="text-slate-400 font-normal text-xs">（可选）</span>
                </Label>
                <div className="relative">
                  <div className="absolute left-3 top-3 text-slate-400">
                    <Quote className="w-4 h-4" />
                  </div>
                  <Input
                    className="pl-10 h-11 text-base"
                    placeholder="如：团结拼搏，勇创佳绩"
                    value={slogan}
                    onChange={e => setSlogan(e.target.value)}
                    maxLength={50}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">{slogan.length}/50 字符</p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={onBack}
                  className="flex-1 gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />上一步
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving || logoUploading || !teamName.trim()}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-sm shadow-blue-200"
                >
                  {saving || logoUploading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" />保存中...</>
                  ) : (
                    <>{isEditing ? '更新并继续' : '保存并继续'} <ArrowRight className="w-4 h-4" /></>
                  )}
                </Button>
              </div>

              {isEditing && (
                <p className="text-xs text-slate-400 text-center mt-3">
                  正在编辑「{externalProfile?.teamName}」的队伍资料
                </p>
              )}
            </CardContent>
          </Card>

          {/* Quick tip */}
          <div className="mt-5 bg-blue-50 border border-blue-100 rounded-xl p-4">
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                <Shield className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-blue-800 mb-0.5">温馨提示</p>
                <ul className="text-xs text-blue-600 space-y-1">
                  <li>队伍名称将显示在出场顺序和比赛公告中</li>
                  <li>队徽将在出场顺序和成绩公告中展示</li>
                  <li>您可以为每个赛事创建多支参赛队伍</li>
                  <li>可随时返回此页面修改或新增队伍资料</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
