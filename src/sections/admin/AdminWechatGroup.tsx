import { useRef, useState } from 'react';
import { QrCode, Upload, ImageIcon, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CenterAlert } from '@/components/CenterAlert';
import { supabase } from '@/lib/supabase';
import { WECHAT_GROUP_TITLE, WECHAT_QR_KEY, wechatQrUrl } from '@/lib/wechatGroup';

const MAX_QR_BYTES = 10 * 1024 * 1024;

export default function AdminWechatGroup() {
  const [src, setSrc] = useState(() => wechatQrUrl());
  const [uploading, setUploading] = useState(false);
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setAlertMsg('微信群二维码仅支持 JPG 或 PNG 格式');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_QR_BYTES) {
      setAlertMsg('微信群二维码图片不能超过 10MB');
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      const { error } = await supabase.storage
        .from('athlete-avatars')
        .upload(WECHAT_QR_KEY, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      setSrc(wechatQrUrl());
      setAlertMsg('微信群二维码已更新');
    } catch (err: any) {
      setAlertMsg('上传失败：' + (err?.message || '请重试'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <div className="mb-4 sm:mb-6">
        <h2 className="text-lg sm:text-xl font-bold text-slate-800">微信群公告</h2>
        <p className="text-slate-500 text-xs sm:text-sm mt-0.5">上传后，俱乐部端首页和报名成功弹窗会立即显示新二维码</p>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <QrCode className="w-4 h-4 text-emerald-600" />
            当前微信群二维码
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="w-48 h-48 shrink-0 rounded-xl border border-slate-200 bg-white p-2 flex items-center justify-center">
              <img src={src} alt="微信群二维码" className="w-full h-full object-contain" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-slate-800">{WECHAT_GROUP_TITLE}通知群</p>
              <p className="text-xs text-slate-500 leading-relaxed">
                俱乐部负责人登录后，在团队管理和在线报名页顶部可见；报名提交成功后会弹窗提醒加入。
              </p>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                群二维码通常有有效期（你上传的图片里标注为 12 月 4 日前）。到期后请在这里重新上传新二维码，无需改代码重新部署。
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Upload className="w-3.5 h-3.5" />
                  {uploading ? '上传中...' : '替换二维码'}
                </Button>
                <a href={src} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="h-9 gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" />查看大图
                  </Button>
                </a>
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleUpload} />
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <ImageIcon className="w-3 h-3" />建议上传清晰的二维码原图，JPG/PNG，不超过 10MB
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <CenterAlert open={!!alertMsg} title="提示" message={alertMsg || ''} onClose={() => setAlertMsg(null)} />
    </div>
  );
}
