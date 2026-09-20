import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { XCircle } from 'lucide-react';

/**
 * 屏幕居中的模态提示弹窗（替代角落里的一行字 toast）。
 * 带图标、标题、正文和确认按钮；点遮罩 / 按 Esc / 点按钮均可关闭。
 */
export function CenterAlert({
  open,
  title = '无法完成操作',
  message,
  onClose,
}: {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl [&>button]:hidden">
        <div className="flex flex-col items-center gap-3 pb-1 pt-2">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100">
            <XCircle className="h-8 w-8 text-red-500" />
          </div>
          <DialogHeader className="space-y-1.5">
            <DialogTitle className="text-center text-base text-slate-900">{title}</DialogTitle>
            <DialogDescription className="text-center text-sm leading-relaxed text-slate-600">
              {message}
            </DialogDescription>
          </DialogHeader>
          <button
            onClick={onClose}
            className="mt-2 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 active:bg-slate-950"
          >
            我知道了
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
