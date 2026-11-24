import { useState } from 'react';
import { CheckCircle2, FileText, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  AGREEMENT_TITLE, AGREEMENT_SUBTITLE, AGREEMENT_INTRO, AGREEMENT_CLAUSES,
  AGREEMENT_CONCLUSION, AGREEMENT_VERSION, SIGNER_ROLE_OPTIONS,
} from '@/lib/liabilityAgreement';
import { liabilityAgreementStore } from '@/lib/store';
import type { LiabilityAgreement } from '@/types';

interface Props {
  open: boolean;
  clubId: string;
  competitionId: string;
  teamProfileId: string;
  initialName?: string;
  initialRole?: string;
  onClose: () => void;
  onSigned: (record: LiabilityAgreement) => void;
}

export default function LiabilityAgreementDialog({
  open, clubId, competitionId, teamProfileId,
  initialName = '', initialRole = 'leader', onClose, onSigned,
}: Props) {
  const [agreed, setAgreed] = useState(false);
  const [signerName, setSignerName] = useState(initialName);
  const [signerRole, setSignerRole] = useState(initialRole);
  const [submitting, setSubmitting] = useState(false);

  const handleSign = async () => {
    if (!agreed) { toast.error('请先阅读并勾选"我已认真阅读并同意以上全部条款"'); return; }
    if (!signerName.trim()) { toast.error('请填写签署人姓名'); return; }
    if (!competitionId || !teamProfileId) { toast.error('赛事或队伍信息缺失，请刷新后重试'); return; }
    setSubmitting(true);
    try {
      const record = await liabilityAgreementStore.sign({
        clubId,
        competitionId,
        teamProfileId,
        signerName: signerName.trim(),
        signerRole,
        agreementVersion: AGREEMENT_VERSION,
      });
      toast.success('责任书已签署，现在可以提交报名');
      setAgreed(false);
      onSigned(record);
    } catch (err: any) {
      toast.error('签署失败：' + (err?.message || '请稍后重试'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setAgreed(false); onClose(); } }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="w-5 h-5 text-blue-600" />
            自愿参赛安全承诺责任书
          </DialogTitle>
        </DialogHeader>

        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-5 text-[13px] leading-7 text-slate-700">
          <h3 className="text-center text-base font-bold text-slate-900">{AGREEMENT_TITLE}</h3>
          <h4 className="text-center text-sm font-semibold text-slate-800 mt-1 mb-4">{AGREEMENT_SUBTITLE}</h4>
          <p className="mb-3">{AGREEMENT_INTRO}</p>
          {AGREEMENT_CLAUSES.map(clause => (
            <p key={clause.no} className="mb-2">{clause.no}、{clause.text}</p>
          ))}
          <p className="mt-4">{AGREEMENT_CONCLUSION}</p>
        </div>

        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>签署人身份</Label>
              <Select value={signerRole} onValueChange={setSignerRole}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SIGNER_ROLE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>签署人姓名 <span className="text-red-500">*</span></Label>
              <Input
                className="mt-1"
                placeholder="请输入领队/教练姓名"
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-200 bg-amber-50 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-amber-500 shrink-0"
            />
            <span className="text-sm text-amber-800 leading-5">
              我已认真阅读并完全理解以上全部条款，代表本队伍自愿签署本责任书，并承担相应法律责任。
            </span>
          </label>
          <p className="text-xs text-slate-400">本队签署一次即全队生效；签署记录将用于赛事备查。</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setAgreed(false); onClose(); }}>取消</Button>
          <Button
            onClick={handleSign}
            disabled={submitting || !agreed || !signerName.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {submitting ? '签署中...' : '确认签署'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
