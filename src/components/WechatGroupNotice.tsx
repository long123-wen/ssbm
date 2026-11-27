import { useEffect, useState } from 'react';
import { MessageCircle, QrCode } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { WECHAT_GROUP_TITLE, wechatQrUrl } from '@/lib/wechatGroup';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 报名提交成功后的微信群提示弹窗 */
export function WechatGroupDialog({ open, onOpenChange }: DialogProps) {
  const [src, setSrc] = useState(() => wechatQrUrl());

  useEffect(() => {
    if (open) setSrc(wechatQrUrl());
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-emerald-600" />
            报名成功，请加入微信群
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-1">
          <div className="w-56 h-56 rounded-xl border border-slate-200 bg-white p-2 flex items-center justify-center">
            <img src={src} alt="微信群二维码" className="w-full h-full object-contain" />
          </div>
          <p className="text-sm font-medium text-slate-800">{WECHAT_GROUP_TITLE}通知群</p>
          <p className="text-xs text-slate-500 text-center leading-relaxed">
            请用微信「扫一扫」识别二维码。二维码如有有效期，以图片提示为准；失效后请联系管理员更换。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 俱乐部端首页常驻公告卡片，点击可放大二维码 */
export function WechatGroupBanner() {
  const [src, setSrc] = useState(() => wechatQrUrl());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) setSrc(wechatQrUrl());
    const timer = window.setInterval(() => setSrc(wechatQrUrl()), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left mx-4 sm:mx-6 mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 sm:p-4 flex items-center gap-3 hover:bg-emerald-50 hover:border-emerald-300 transition-colors"
      >
        <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl border border-emerald-200 bg-white p-1 flex items-center justify-center">
          <img src={src} alt="微信群二维码" className="w-full h-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-emerald-900 flex items-center gap-1.5">
            <MessageCircle className="w-4 h-4 shrink-0" />
            报名后请加入微信群
          </p>
          <p className="text-xs text-emerald-800/80 mt-0.5 truncate">{WECHAT_GROUP_TITLE}通知群</p>
          <p className="text-[11px] text-emerald-700/70 mt-1 hidden sm:flex items-center gap-1">
            <QrCode className="w-3 h-3" />
            手机长按识别二维码，或保存图片后用微信扫一扫；点击可放大
          </p>
        </div>
      </button>
      <WechatGroupDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
