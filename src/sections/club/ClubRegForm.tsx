import { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Trophy, Trash2, Timer, X, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  competitionStore, eventStore, groupStore,
  athleteStore, registrationStore, checkLimitViolations, limitConfigStore, liabilityAgreementStore
} from '@/lib/store';
import { isGroupEligible } from '@/lib/groupMatcher';
import { CenterAlert } from '@/components/CenterAlert';
import { evaluateDeadline, formatDeadlineRemaining, formatDeadlineValue, isCompetitionRegOpen } from '@/lib/deadline';
import { AGREEMENT_VERSION } from '@/lib/liabilityAgreement';
import LiabilityAgreementDialog from '@/components/LiabilityAgreementDialog';
import { WechatGroupDialog } from '@/components/WechatGroupNotice';
import type { Competition, Event, EventGroup, Athlete, ClubAccount, LiabilityAgreement } from '@/types';

interface Props { club: ClubAccount; competitionId: string; teamProfileId: string }

// 临时报名记录（提交前暂存）
interface TempReg {
  athletes: { athleteId: string; name: string }[];
  eventId: string;
  eventName: string;
  groupId: string;
  groupName: string;
}

type Step = 'catalog' | 'picker' | 'completed';

function tempRegistrationStorageKey(clubId: string, teamProfileId: string, competitionId: string): string {
  return `rope-jump:club-registration-draft:${clubId}:${teamProfileId}:${competitionId}`;
}

function readTempRegistrations(clubId: string, teamProfileId: string, competitionId: string): TempReg[] {
  if (!competitionId || typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(tempRegistrationStorageKey(clubId, teamProfileId, competitionId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TempReg => Boolean(item) && typeof item === 'object'
      && typeof (item as TempReg).eventId === 'string'
      && typeof (item as TempReg).groupId === 'string'
      && Array.isArray((item as TempReg).athletes));
  } catch {
    return [];
  }
}

function registrationsToTempRegistrations(registrations: any[], competitionId: string): TempReg[] {
  return registrations.filter(registration => registration.competitionId === competitionId
    && (registration.status === 'pending' || registration.status === 'confirmed' || registration.status === 'rejected'))
    .map(registration => ({
      eventId: registration.eventId,
      eventName: registration.eventName,
      groupId: registration.groupId,
      groupName: registration.groupName,
      athletes: Array.isArray(registration.athletes) ? registration.athletes : [],
    }));
}

function findQuotaViolations(registrations: TempReg[], events: Event[], competition?: Competition): string[] {
  if (!competition) return [];
  const stats: Record<string, { name: string; individual: number; team: number }> = {};
  for (const registration of registrations) {
    const event = events.find(item => item.id === registration.eventId);
    const isIndividual = event?.isIndividual !== false;
    for (const athlete of registration.athletes) {
      const athleteStats = stats[athlete.athleteId] ||= { name: athlete.name, individual: 0, team: 0 };
      if (isIndividual) athleteStats.individual++;
      else athleteStats.team++;
    }
  }
  return Object.values(stats).flatMap(stat => {
    const errors: string[] = [];
    if (competition.maxIndividualEvents && competition.maxIndividualEvents > 0 && stat.individual > competition.maxIndividualEvents) {
      errors.push(`「${stat.name}」个人项目${stat.individual}项（限报${competition.maxIndividualEvents}项）`);
    }
    if (competition.maxTeamEvents && competition.maxTeamEvents > 0 && stat.team > competition.maxTeamEvents) {
      errors.push(`「${stat.name}」集体项目${stat.team}项（限报${competition.maxTeamEvents}项）`);
    }
    return errors;
  });
}

export default function ClubRegForm({ club, competitionId, teamProfileId }: Props) {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selCompId, setSelCompId] = useState(competitionId || '');
  const [events, setEvents] = useState<Event[]>([]);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [groupsMap, setGroupsMap] = useState<Record<string, EventGroup[]>>({});
  // 限报配置（limit_configs）：key = `${scope}:${targetId}`，未配置的维度 = 不限
  const [limitMap, setLimitMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 临时报名清单（所有运动员的所有项目）
  const [tempRegs, setTempRegs] = useState<TempReg[]>([]);

  const [currentStep, setCurrentStep] = useState<Step>('catalog');
  // 居中模态报错弹窗（替代角落的一行字 toast，更醒目）
  const [alertBox, setAlertBox] = useState<{ title: string; message: string } | null>(null);
  const showAlert = (message: string, title = '无法完成操作') => setAlertBox({ title, message });

  // 已提交到后台的报名记录（用于重复检测 + 赛事锁定）
  const [existingRegs, setExistingRegs] = useState<any[]>([]);

  // 责任书签署状态（队伍级，每队每赛事一份；已报名/管理员解锁修改不卡）
  const [agreement, setAgreement] = useState<LiabilityAgreement | null>(null);
  const [agreementLoading, setAgreementLoading] = useState(true);
  const [showAgreementDialog, setShowAgreementDialog] = useState(false);
  const [showWechatDialog, setShowWechatDialog] = useState(false);

  // 参考流程：先选项目/组别，再选择队员，最后统一提交
  const [referenceCategory, setReferenceCategory] = useState('全部');
  const [referenceType, setReferenceType] = useState<'全部' | '个人' | '集体'>('全部');
  const [referenceEventId, setReferenceEventId] = useState<string | null>(null);
  const [referenceGroupId, setReferenceGroupId] = useState('');
  const [referenceAthleteIds, setReferenceAthleteIds] = useState<string[]>([]);
  // 当前项目已完成的临时填报，用于展示参考图中的“已填报”确认页。
  const [completedEventId, setCompletedEventId] = useState<string | null>(null);
  const [completedGroupId, setCompletedGroupId] = useState<string | null>(null);
  const [filledPanelOpen, setFilledPanelOpen] = useState(false);
  const [submittedLocked, setSubmittedLocked] = useState(false);
  const [adminEditUnlocked, setAdminEditUnlocked] = useState(false);
  // 当前选中的赛事
  const currentComp = useMemo(() => competitions.find(c => c.id === selCompId), [competitions, selCompId]);
  const categories = useMemo(() => [...new Set(events.map(event => event.category))], [events]);
  // 当前比赛日期（用于年龄计算）
  const compDate = useMemo(() => currentComp?.startDate || '', [currentComp]);

  // ===== 限报判断（统一走 limit_configs，null/0 = 不限） =====
  const limitOf = (scope: 'event' | 'group', targetId: string): number | null => {
    const v = limitMap[`${scope}:${targetId}`];
    return typeof v === 'number' && v > 0 ? v : null;
  };
  // 分组是否已满（未配置限报 = 永不满）
  const isGroupFull = (grp: EventGroup): boolean => {
    const max = limitOf('group', grp.id);
    return max !== null && grp.currentCount >= max;
  };
  // 项目是否已满（项目维度未配置时，看其下所有分组是否都满）
  const isEventFull = (eventId: string): boolean => {
    const max = limitOf('event', eventId);
    if (max !== null) {
      const used = Object.values(groupsMap[eventId] || []).reduce((n, g) => n + g.currentCount, 0);
      return used >= max;
    }
    const gs = groupsMap[eventId] || [];
    return gs.length > 0 && gs.every(isGroupFull);
  };

  // 报名截止倒计时（统一走 src/lib/deadline.ts 中心函数，与后端 functions/_shared/deadline.ts 语义一致）
  // 返回 DeadlineDecision：ok=false 时 reason ∈ {'COMPETITION_NOT_OPEN','DEADLINE_PASSED'}；level 决定 UI 颜色档位
  const deadlineDecision = useMemo(() => {
    const comp = competitions.find(c => c.id === selCompId);
    if (!comp) return null;
    return evaluateDeadline({
      status: comp.status,
      registration_deadline: comp.registrationDeadline,
      force_open: comp.forceOpen,
    });
  }, [competitions, selCompId]);
  // 派生日历倒计时文案（safe/warning/urgent/expired + 文本），UI 横幅和按钮文案共用
  const deadlineInfo = useMemo(() => {
    if (!deadlineDecision) return null;
    const text = formatDeadlineRemaining(deadlineDecision);
    return {
      expired: deadlineDecision.level === 'expired',
      level: deadlineDecision.level,
      text,
      reason: deadlineDecision.reason,
      ok: deadlineDecision.ok,
    };
  }, [deadlineDecision]);

  // 截止/未开放后整页锁定：所有填报交互禁用（admin 解锁修改除外）
  const deadlineBlocked = !!deadlineInfo && !deadlineInfo.ok && !adminEditUnlocked;

  // 未签署责任书 → 项目选择区整体灰化不可操作（仅新报名；已锁定报名/管理员解锁不卡）
  const agreementBlocked = !submittedLocked && !adminEditUnlocked && (agreementLoading || !agreement);

  useEffect(() => {
    setLoading(true);
    setSubmittedLocked(false);
    setFilledPanelOpen(false);
    setLoadError('');
    Promise.all([
      competitionStore.getAll(),
      athleteStore.getByClubAndTeam(club.id, teamProfileId),
      registrationStore.getByClubAndTeam(club.id, teamProfileId),
    ]).then(([comps, aths, regs]) => {
      const openComps = comps.filter(isCompetitionRegOpen);
      setCompetitions(openComps);
      // 如果父级已预选赛事，且该赛事在开放列表中，直接使用
      if (competitionId && openComps.some(c => c.id === competitionId)) {
        setSelCompId(competitionId);
      } else if (!selCompId) {
        // 没有预选赛事的原有逻辑：优先选择可报名的赛事
        const unlockedIds = new Set<string>();
        regs.forEach((r: any) => {
          if (r.status === 'pending' || r.status === 'confirmed') unlockedIds.add(r.competitionId);
        });
        const firstAvailable = openComps.find(c => c.id && !unlockedIds.has(c.id));
        if (firstAvailable) {
          setSelCompId(firstAvailable.id);
        } else if (openComps.length) {
          setSelCompId(openComps[0].id);
        }
      }
      setAthletes(aths);
      setExistingRegs(regs);
      const initialCompetitionId = competitionId && openComps.some(c => c.id === competitionId)
        ? competitionId
        : (openComps.find(c => c.id === selCompId)?.id || openComps[0]?.id || '');
      const submittedTempRegs = registrationsToTempRegistrations(regs, initialCompetitionId);
      if (submittedTempRegs.length > 0) {
        setTempRegs(submittedTempRegs);
        if (typeof window !== 'undefined') window.localStorage.setItem(tempRegistrationStorageKey(club.id, teamProfileId, initialCompetitionId), JSON.stringify(submittedTempRegs));
      }
      setSubmittedLocked(submittedTempRegs.some(registration => registration.eventId));
      setLoading(false);
    }).catch((err: any) => {
      setLoadError(err?.message || '数据加载失败，请检查网络连接');
      setLoading(false);
    });
  }, [club.id, competitionId, teamProfileId]);

  useEffect(() => {
    if (!selCompId) return;
    // 加载本队责任书签署状态
    setAgreementLoading(true);
    liabilityAgreementStore.getByTeam(selCompId, teamProfileId)
      .then(setAgreement)
      .catch(() => setAgreement(null))
      .finally(() => setAgreementLoading(false));
    registrationStore.getEditState(selCompId, teamProfileId).then(state => {
      setAdminEditUnlocked(state.unlocked);
      if (state.unlocked) setSubmittedLocked(false);
    }).catch(() => setAdminEditUnlocked(false));
    setTempRegs(readTempRegistrations(club.id, teamProfileId, selCompId));
    eventStore.getByCompetition(selCompId).then(ev => {
      const sorted = ev.sort((a, b) => a.orderIndex - b.orderIndex);
      setEvents(sorted);
      Promise.all(sorted.map(ev => groupStore.getByEvent(ev.id))).then(allGroups => {
        const map: Record<string, EventGroup[]> = {};
        sorted.forEach((ev, i) => {
          map[ev.id] = (allGroups[i] || []).sort((a, b) => a.orderIndex - b.orderIndex);
        });
        setGroupsMap(map);
      }).catch(() => {});
    }).catch(() => {});
    // 加载限报配置（limit_configs）：null / 0 = 不限
    limitConfigStore.getByCompetition(selCompId).then(cfgs => {
      const m: Record<string, number> = {};
      for (const c of cfgs) {
        if (typeof c.maxRegistrations === 'number' && c.maxRegistrations > 0) {
          m[`${c.scope}:${c.targetId}`] = c.maxRegistrations;
        }
      }
      setLimitMap(m);
    }).catch(() => setLimitMap({}));
    setReferenceEventId(null);
    setReferenceGroupId('');
    setReferenceAthleteIds([]);
    setCurrentStep('catalog');
  }, [selCompId]);

  useEffect(() => {
    if (!selCompId || typeof window === 'undefined') return;
    window.localStorage.setItem(tempRegistrationStorageKey(club.id, teamProfileId, selCompId), JSON.stringify(tempRegs));
  }, [club.id, teamProfileId, selCompId, tempRegs]);

  // 从临时清单中删除
  const removeTempReg = (index: number) => {
    if ((submittedLocked && !adminEditUnlocked) || deadlineBlocked) return;
    setTempRegs(prev => prev.filter((_, i) => i !== index));
  };

  // 打开项目清单，不直接提交
  const openSubmissionReview = () => {
    if ((submittedLocked && !adminEditUnlocked) || deadlineBlocked) return;
    if (tempRegs.length === 0) return showAlert('报名清单为空');
    setFilledPanelOpen(true);
  };

  // 确认项目清单后提交所有临时报名
  const submitAll = async () => {
    if (submittedLocked && !adminEditUnlocked) return;
    if (!selCompId) return showAlert('请选择赛事后再提交');
    if (tempRegs.length === 0) return showAlert('报名清单为空');
    // 兜底守卫：截止/未开放 → 直接拒绝（即使按钮绕过，submit 流程本身也再查一遍）
    // 注意：admin 解锁修改（adminEditUnlocked）走 update 路径，按拍板"仅 create/resubmit 锁 deadline"放行
    if (!adminEditUnlocked && deadlineInfo && !deadlineInfo.ok) {
      const reason = deadlineInfo.reason || 'DEADLINE_PASSED';
      return showAlert(reason === 'COMPETITION_NOT_OPEN' ? '该赛事当前未开放报名' : '报名已截止，无法提交');
    }
    // 责任书卡点：仅新报名（create）要求先签署；已锁定报名和管理员解锁修改不卡
    if (!adminEditUnlocked && !submittedLocked) {
      if (agreementLoading) return showAlert('正在核验责任书签署状态，请稍后再试');
      if (!agreement) {
        setShowAgreementDialog(true);
        return showAlert('报名前请先签署《自愿参赛安全承诺责任书》，签署后再提交');
      }
    }

    // 最终限报校验：即使旧页面、缓存草稿或手工请求绕过即时提示，也不能提交超项清单。
    const quotaViolations = findQuotaViolations(tempRegs, events, currentComp);
    if (quotaViolations.length > 0) {
      showAlert('⚠️ 超项报名，无法提交：' + quotaViolations.join('；'));
      return;
    }
    setSubmitting(true);
    try {
      if (adminEditUnlocked) {
        const result = await registrationStore.replaceForUnlockedCompetition({
          competitionId: selCompId,
          ...(teamProfileId ? { teamProfileId } : {}),
          registrations: tempRegs.map(reg => ({
            competitionId: selCompId,
            eventId: reg.eventId,
            groupId: reg.groupId,
            athleteIds: reg.athletes.map(athlete => athlete.athleteId),
          })),
        });
        // 清单替换已由服务端完成；不要等待额外的数据刷新，以免网络波动让按钮长期停留在“提交中”。
        setSubmittedLocked(true);
        setAdminEditUnlocked(false);
        setFilledPanelOpen(false);
        setCurrentStep('catalog');
        registrationStore.getByClubAndTeam(club.id, teamProfileId).then(setExistingRegs).catch(() => {});
        return;
      }
      let successCount = 0;
      let failedItems: string[] = [];
      for (const [index, reg] of tempRegs.entries()) {
        const grp = (groupsMap[reg.eventId] || []).find(g => g.id === reg.groupId);
        if (!adminEditUnlocked && grp && isGroupFull(grp)) {
          failedItems.push(`「${reg.athletes.map(a => a.name).join('、')}-${reg.eventName}」分组已满`);
          continue;
        }

        // 最终三维度限报校验
        const limitErrors = await checkLimitViolations(
          selCompId, club.id, teamProfileId, reg.eventId, reg.groupId, adminEditUnlocked ? [] : existingRegs
        );
        if (limitErrors.length > 0) {
          failedItems.push(`「${reg.athletes.map(a => a.name).join('、')}-${reg.eventName}」${limitErrors.join('；')}`);
          continue;
        }

        try {
          await registrationStore.create({
            competitionId: selCompId,
            clubId: club.id,
            clubName: club.clubName,
            eventId: reg.eventId,
            eventName: reg.eventName,
            groupId: reg.groupId,
            groupName: reg.groupName,
            athletes: reg.athletes,
            status: 'pending',
            teamProfileId,
          });
          successCount++;
        } catch (err: any) {
          failedItems.push(`「${reg.athletes.map(a => a.name).join('、')}-${reg.eventName}」提交失败：${err?.message || '未知错误'}`);
        }
      }

      // 刷新分组人数
      for (const reg of tempRegs) {
        groupStore.getByEvent(reg.eventId).then(g => {
          setGroupsMap(prev => ({
            ...prev,
            [reg.eventId]: (g || []).sort((a, b) => a.orderIndex - b.orderIndex),
          }));
        }).catch(() => {});
      }

      // 刷新已报名记录
      registrationStore.getByClubAndTeam(club.id, teamProfileId).then(regs => {
        setExistingRegs(regs);
      }).catch(() => {});

      if (failedItems.length > 0) {
        showAlert(failedItems.join('；'));
      }
      if (successCount > 0) {
        setSubmittedLocked(true);
        setFilledPanelOpen(false);
        setCurrentStep('catalog');
        setShowWechatDialog(true);
      }
      } catch (err: any) {
      const message = err?.message || '请稍后重试';
      showAlert(`提交失败：${message}`);
      setFilledPanelOpen(true);
    } finally {
      setSubmitting(false);
    }
  };

  // 参考图报名流程：项目列表 → 选择组别 → 勾选队员 → 累积报名 → 统一提交
  const referenceEvents = useMemo(() => events.filter(ev => {
    const categoryMatch = referenceCategory === '全部' || ev.category === referenceCategory;
    const typeMatch = referenceType === '全部'
      || (referenceType === '个人' && ev.isIndividual !== false)
      || (referenceType === '集体' && ev.isIndividual === false);
    return categoryMatch && typeMatch;
  }), [events, referenceCategory, referenceType]);

  const referenceEvent = referenceEventId ? events.find(ev => ev.id === referenceEventId) : undefined;
  const referenceAllGroups = referenceEvent ? (groupsMap[referenceEvent.id] || []) : [];
  const referenceSelectedGroup = referenceAllGroups.find(g => g.id === referenceGroupId);
  const referenceMaxAthletes = referenceEvent?.isIndividual === false ? (referenceEvent.maxAthletes || 1) : 1;

  // 正确的筛选方向：先选定分组，再按该分组过滤运动员。
  // 规则（2026-09-20 修订）：
  //  - 个人项目（1 人）：**不允许跨组别**，只显示出生日期精确落在该组区间的运动员
  //  - 2 人及以上项目：允许跨组别，沿用「报高不报低」
  //  - 5 人及以上大集体：不设年龄分组，自由组队（只校验性别）
  const referenceIsIndividual = referenceEvent ? referenceEvent.isIndividual !== false : true;
  const referenceEligibleAthletes = useMemo(() => {
    if (!referenceEvent || !referenceSelectedGroup) return [];
    return athletes.filter(athlete =>
      isGroupEligible(
        referenceSelectedGroup,
        athlete.birthDate,
        athlete.gender as 'male' | 'female',
        compDate,
        referenceMaxAthletes,
        referenceIsIndividual,
      ),
    );
  }, [referenceEvent, referenceSelectedGroup, athletes, compDate, referenceMaxAthletes, referenceIsIndividual]);

  // 切换分组后，清除不再符合新分组的已选运动员。
  useEffect(() => {
    if (!referenceGroupId) {
      setReferenceAthleteIds([]);
      return;
    }
    const eligibleIds = new Set(referenceEligibleAthletes.map(athlete => athlete.id));
    setReferenceAthleteIds(prev => prev.filter(id => eligibleIds.has(id)));
  }, [referenceGroupId, referenceEligibleAthletes]);
  const quotaCountByAthlete = useMemo(() => {
    const counts: Record<string, { individual: number; team: number }> = {};
    for (const registration of tempRegs) {
      const event = events.find(item => item.id === registration.eventId);
      const type = event?.isIndividual !== false ? 'individual' : 'team';
      for (const athlete of registration.athletes) {
        const count = counts[athlete.athleteId] ||= { individual: 0, team: 0 };
        count[type]++;
      }
    }
    return counts;
  }, [tempRegs, events]);

  const isAthleteQuotaReached = (athleteId: string) => {
    if (!referenceEvent || !currentComp) return false;
    const count = quotaCountByAthlete[athleteId] || { individual: 0, team: 0 };
    if (referenceEvent.isIndividual !== false) {
      return Boolean(currentComp.maxIndividualEvents && currentComp.maxIndividualEvents > 0 && count.individual >= currentComp.maxIndividualEvents);
    }
    return Boolean(currentComp.maxTeamEvents && currentComp.maxTeamEvents > 0 && count.team >= currentComp.maxTeamEvents);
  };

  const referenceExistingForEvent = (eventId: string) => tempRegs.filter(r => r.eventId === eventId);
  const referenceFilledAthletes = (eventId: string) => {
    const ids = new Set<string>();
    referenceExistingForEvent(eventId).forEach(r => r.athletes.forEach(a => ids.add(a.athleteId)));
    return ids.size;
  };

  // 当前项目下「已填报过」的运动员（本次会话已填 + 已提交待审/已通过的报名），复选框直接禁选
  const referenceFilledAthleteIds = useMemo(() => {
    const ids = new Set<string>();
    if (!referenceEvent) return ids;
    tempRegs.filter(r => r.eventId === referenceEvent.id).forEach(r => r.athletes.forEach(a => ids.add(a.athleteId)));
    if (!adminEditUnlocked) {
      existingRegs.filter((r: any) => (r.status === 'pending' || r.status === 'confirmed') && r.eventId === referenceEvent.id)
        .forEach((r: any) => (r.athletes || []).forEach((a: any) => ids.add(a.athleteId)));
    }
    return ids;
  }, [referenceEvent, tempRegs, existingRegs, adminEditUnlocked]);

  const openReferenceEvent = (eventId: string) => {
    if ((submittedLocked && !adminEditUnlocked) || deadlineBlocked) return;
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;
    setReferenceEventId(eventId);
    // 不再默认选中第一个组别，必须由报名人员明确选择组别后再筛选队员。
    setReferenceGroupId('');
    setReferenceAthleteIds([]);
    setCurrentStep('picker');
  };

  const toggleReferenceAthlete = (athleteId: string) => {
    if ((submittedLocked && !adminEditUnlocked) || deadlineBlocked) return;
    if (referenceFilledAthleteIds.has(athleteId)) return; // 已在该项目填报过，禁选
    setReferenceAthleteIds(prev => {
      if (prev.includes(athleteId)) return prev.filter(id => id !== athleteId);
      if (isAthleteQuotaReached(athleteId)) return prev;
      if (referenceMaxAthletes <= 1) return [athleteId];
      if (prev.length >= referenceMaxAthletes) return prev;
      return [...prev, athleteId];
    });
  };

  const confirmReferenceAdd = () => {
    if ((submittedLocked && !adminEditUnlocked) || deadlineBlocked) return;
    if (!referenceEvent || !referenceSelectedGroup) return showAlert('请选择报名组别');
    if (!referenceAthleteIds.length) return showAlert('请选择报名队员');
    if (!adminEditUnlocked && isGroupFull(referenceSelectedGroup)) return showAlert('该报名组别已满，请选择其他组别');
    if (referenceEvent.isIndividual !== false && referenceAthleteIds.length !== 1) return showAlert('个人项目只能选择 1 名队员');
    if (referenceEvent.isIndividual === false && referenceAthleteIds.length < 2) return showAlert('团队/集体项目至少选择 2 名队员');
    // 管理端设置的「最少参赛人数」（集体项目如 6-12 人）
    const minAthletes = Number(referenceEvent.minAthletes || 0);
    if (minAthletes > 0 && referenceAthleteIds.length < minAthletes) {
      return showAlert(`该项目至少需要 ${minAthletes} 名队员，当前已选 ${referenceAthleteIds.length} 人`);
    }
    const duplicated = tempRegs.some(r => r.eventId === referenceEvent.id && r.athletes.some(a => referenceAthleteIds.includes(a.athleteId)))
      || (!adminEditUnlocked && existingRegs.some(r => (r.status === 'pending' || r.status === 'confirmed') && r.eventId === referenceEvent.id && r.athletes.some((a: any) => referenceAthleteIds.includes(a.athleteId))));
    if (duplicated) return showAlert('所选队员已在该项目中报名');
    // 混合组必须男女都有
    if ((referenceSelectedGroup.name || '').includes('混合')) {
      const genders = new Set(athletes.filter(a => referenceAthleteIds.includes(a.id)).map(a => a.gender));
      if (!genders.has('male') || !genders.has('female')) {
        return showAlert('混合组必须至少包含一名男运动员和一名女运动员，请调整队员');
      }
    }
    const athleteEntries = athletes.filter(a => referenceAthleteIds.includes(a.id)).map(a => ({ athleteId: a.id, name: a.name }));
    const candidate: TempReg = {
      athletes: athleteEntries,
      eventId: referenceEvent.id,
      eventName: referenceEvent.name,
      groupId: referenceSelectedGroup.id,
      groupName: referenceSelectedGroup.name,
    };
    const quotaViolations = findQuotaViolations([...tempRegs, candidate], events, currentComp);
    if (quotaViolations.length > 0) {
      return showAlert('⚠️ 已达到限报数量，不能添加：' + quotaViolations.join('；'));
    }
    setTempRegs(prev => [...prev, candidate]);
    setReferenceAthleteIds([]);
    setReferenceEventId(null);
    setReferenceGroupId('');
    setCompletedEventId(referenceEvent.id);
    setCompletedGroupId(referenceSelectedGroup.id);
    setCurrentStep('completed');
  };

  const resetReferenceFlow = () => {
    setReferenceEventId(null);
    setReferenceGroupId('');
    setReferenceAthleteIds([]);
    setCompletedEventId(null);
    setCompletedGroupId(null);
    setCurrentStep('catalog');
  };

  const continueCurrentEvent = () => {
    if (!completedEventId) return resetReferenceFlow();
    setReferenceEventId(completedEventId);
    setReferenceGroupId(completedGroupId || '');
    setReferenceAthleteIds([]);
    setCompletedEventId(null);
    setCompletedGroupId(null);
    setCurrentStep('picker');
  };

  const saveAndReturnToCatalog = () => {
    setCompletedEventId(null);
    setCompletedGroupId(null);
    setCurrentStep('catalog');
  };

  const completedEvent = completedEventId ? events.find(event => event.id === completedEventId) : undefined;
  const completedGroup = completedEvent && completedGroupId
    ? (groupsMap[completedEvent.id] || []).find(group => group.id === completedGroupId)
    : undefined;
  const completedRegs = completedEventId && completedGroupId
    ? tempRegs.filter(reg => reg.eventId === completedEventId && reg.groupId === completedGroupId)
    : [];

  if (loading) {
    return (
      <div className="p-4 sm:p-6 flex items-center justify-center py-20">
        <div className="text-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-500" />
          <p className="text-sm">正在加载报名数据...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-4 sm:p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-700 font-medium mb-1">数据加载失败</p>
          <p className="text-red-500 text-sm mb-4">{loadError}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>刷新重试</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none px-4 sm:px-6 lg:px-8 xl:px-10 pb-32 sm:pb-36">
      <CenterAlert
        open={!!alertBox}
        title={alertBox?.title}
        message={alertBox?.message || ''}
        onClose={() => setAlertBox(null)}
      />
      <WechatGroupDialog open={showWechatDialog} onOpenChange={setShowWechatDialog} />
      <LiabilityAgreementDialog
        open={showAgreementDialog}
        clubId={club.id}
        competitionId={selCompId}
        teamProfileId={teamProfileId}
        initialName={agreement?.signerName || ''}
        initialRole={agreement?.signerRole || 'leader'}
        onClose={() => setShowAgreementDialog(false)}
        onSigned={(record) => { setAgreement(record); setShowAgreementDialog(false); }}
      />
      <div className="mb-5 sm:mb-6 lg:flex lg:items-end lg:justify-between lg:gap-6">
        <div>
          <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-slate-800 tracking-tight">在线报名</h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-1">先选项目和组别，再选择队员，最后统一提交</p>
        </div>
        <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{referenceEvents.length} 个可报名项目</span>
          <span className="text-slate-300">·</span>
          <span>{tempRegs.length} 项已填报</span>
        </div>
      </div>

      {/* 责任书签署状态条：仅新报名需要签署；已报名锁定 / 管理员解锁修改不提示 */}
      {!submittedLocked && (
        <div className={`mb-5 rounded-xl border px-4 py-3 flex flex-wrap items-center gap-2.5 text-sm ${
          agreement
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-amber-50 border-amber-200 text-amber-700'
        }`}>
          {agreement ? (
            <>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="font-medium">责任书已签署</span>
              <span className="text-xs opacity-80">签署人：{agreement.signerName} · {new Date(agreement.signedAt).toLocaleString('zh-CN')}</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">报名前须先签署《自愿参赛安全承诺责任书》</span>
              <span className="text-xs opacity-80">由领队/教练代表本队签署一次，全队生效</span>
              <Button size="sm" onClick={() => setShowAgreementDialog(true)} className="ml-auto bg-amber-500 hover:bg-amber-600 text-white h-7 text-xs gap-1.5">
                去签署
              </Button>
            </>
          )}
        </div>
      )}


      {athletes.length === 0 && !loading && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2.5 text-amber-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          请先在「团队管理」中添加运动员信息，再进行报名
        </div>
      )}

      {competitions.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-xl border border-dashed">
          暂无开放报名的赛事
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-slate-400 bg-white rounded-xl border border-dashed">
          该赛事暂未配置项目，请联系管理员
        </div>
      ) : (
        <>
          <RegFormStep1Team
            competitions={competitions}
            selCompId={selCompId}
            onChangeSelCompId={(v) => { if ((submittedLocked && !adminEditUnlocked) || deadlineBlocked) return; setSelCompId(v); setTempRegs([]); }}
            disabled={(submittedLocked && !adminEditUnlocked) || deadlineBlocked}
            currentComp={currentComp}
            deadlineInfo={deadlineInfo}
            deadlineLabel={formatDeadlineValue(competitions.find(c => c.id === selCompId)?.registrationDeadline)}
          />

          <Card className={`bg-white border border-slate-200/80 shadow-sm rounded-2xl overflow-hidden ${deadlineBlocked ? 'pointer-events-none select-none opacity-70' : ''}`}>
            <CardContent className="p-4 sm:p-5 lg:p-6">
              {/* 参考流程：项目/组别列表 */}
              {currentStep === 'catalog' && (
                <RegFormStep2Events
                  referenceCategory={referenceCategory}
                  referenceType={referenceType}
                  onCategoryChange={setReferenceCategory}
                  onTypeChange={setReferenceType}
                  categories={categories}
                  events={referenceEvents}
                  filledByEvent={tempRegs}
                  groupsMap={groupsMap}
                  isEventFull={isEventFull}
                  getLimit={limitOf}
                  onPickEvent={openReferenceEvent}
                  disabled={(submittedLocked && !adminEditUnlocked) || deadlineBlocked || agreementBlocked}
                />
              )}

              {/* 单个项目填报完成确认页 */}
              {currentStep === 'completed' && completedEvent && completedGroup && (
                <RegFormStep4Review
                  event={completedEvent}
                  group={completedGroup}
                  groupsMap={groupsMap}
                  regs={completedRegs}
                  groupLimit={limitOf('group', completedGroup.id)}
                  onContinue={continueCurrentEvent}
                  onSaveReturn={saveAndReturnToCatalog}
                />
              )}

              {/* 参考流程：选择组别和队员 */}
              {currentStep === 'picker' && referenceEvent && (
                <RegFormStep3Athletes
                  event={referenceEvent}
                  allGroups={referenceAllGroups}
                  selectedGroupId={referenceGroupId}
                  onSelectGroup={setReferenceGroupId}
                  isGroupFull={isGroupFull}
                  eligibleAthletes={referenceEligibleAthletes}
                  selectedAthleteIds={referenceAthleteIds}
                  onToggleAthlete={toggleReferenceAthlete}
                  maxAthletes={referenceMaxAthletes}
                  minAthletes={Number(referenceEvent.minAthletes || 0)}
                  disabledAthleteIds={referenceFilledAthleteIds}
                  isAthleteQuotaReached={isAthleteQuotaReached}
                  quotaTextFor={(athleteId) => referenceEvent?.isIndividual !== false
                    ? `个人项目已报满${currentComp?.maxIndividualEvents}项`
                    : `集体项目已报满${currentComp?.maxTeamEvents}项`}
                  onClearAthletes={() => setReferenceAthleteIds([])}
                  onCancel={resetReferenceFlow}
                  onConfirm={confirmReferenceAdd}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* 页面内已填报项目抽屉 + 底部固定栏（统一为 RegFormLockedPanel） */}
      <RegFormLockedPanel
        club={club}
        currentStep={currentStep}
        tempRegs={tempRegs}
        filledPanelOpen={filledPanelOpen}
        onOpenPanel={() => setFilledPanelOpen(true)}
        onClosePanel={() => setFilledPanelOpen(false)}
        submittedLocked={submittedLocked}
        adminEditUnlocked={adminEditUnlocked}
        deadlineInfo={deadlineInfo}
        deadlineLabel={formatDeadlineValue(competitions.find(c => c.id === selCompId)?.registrationDeadline)}
        submitting={submitting}
        onRemoveItem={removeTempReg}
        onSubmit={submitAll}
      />
    </div>
  );
}

// ============================================================================
// 子组件：5 步骤（#454 批次3-B 拆分）
// 父组件保留所有 state 与业务函数，子组件通过 props 接收数据并触发回调。
// ============================================================================

interface Step1TeamProps {
  competitions: Competition[];
  selCompId: string;
  onChangeSelCompId: (v: string) => void;
  disabled: boolean;
  currentComp: Competition | undefined;
  deadlineInfo: { expired: boolean; level: 'safe' | 'warning' | 'urgent' | 'expired'; text: string; reason: string | null; ok: boolean } | null;
  deadlineLabel: string;
}

/** Step 1：赛事选择 + 限报规则 + 截止倒计时（行 742-794 段） */
function RegFormStep1Team({ competitions, selCompId, onChangeSelCompId, disabled, currentComp, deadlineInfo, deadlineLabel }: Step1TeamProps) {
  return (
    <>
      <div className="mb-4 sm:mb-5 lg:flex lg:items-end lg:gap-5">
        <div className="flex-1 lg:max-w-xl">
          <Label className="text-slate-600 text-sm mb-1.5 block">选择赛事</Label>
          <Select value={selCompId || undefined} onValueChange={onChangeSelCompId} disabled={disabled}>
            <SelectTrigger className="w-full bg-white h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {competitions.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="hidden lg:flex items-center gap-2 text-xs text-slate-500 bg-white border border-slate-200 rounded-xl px-4 h-11">
          <Trophy className="w-4 h-4 text-emerald-500" />
          <span>报名信息实时保存，提交前可随时调整</span>
        </div>
      </div>

      {currentComp && (currentComp.maxIndividualEvents || currentComp.maxTeamEvents) && (
        <div className="mb-4 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm bg-purple-50 border border-purple-200 text-purple-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="font-medium">限报规则：</span>
          <span>
            {currentComp.maxIndividualEvents && currentComp.maxIndividualEvents > 0 ? `个人项目每人最多报${currentComp.maxIndividualEvents}项` : ''}
            {currentComp.maxIndividualEvents && currentComp.maxTeamEvents ? '，' : ''}
            {currentComp.maxTeamEvents && currentComp.maxTeamEvents > 0 ? `集体项目每人最多报${currentComp.maxTeamEvents}项` : ''}
          </span>
        </div>
      )}

      {deadlineInfo && (
        <div className={`mb-4 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm ${
          deadlineInfo.expired
            ? 'bg-red-50 border border-red-200 text-red-700'
            : deadlineInfo.level === 'urgent'
              ? 'bg-red-50 border border-red-200 text-red-600'
              : deadlineInfo.level === 'warning'
                ? 'bg-amber-50 border border-amber-200 text-amber-700'
                : 'bg-blue-50 border border-blue-200 text-blue-700'
        }`}>
          <Timer className="w-4 h-4 shrink-0" />
          <span className="font-medium">{deadlineInfo.text}</span>
          {!deadlineInfo.expired && deadlineLabel && (
            <span className="ml-auto text-xs opacity-70">截止日：{deadlineLabel}</span>
          )}
        </div>
      )}
    </>
  );
}

interface Step2EventsProps {
  referenceCategory: string;
  referenceType: '全部' | '个人' | '集体';
  onCategoryChange: (v: string) => void;
  onTypeChange: (v: '全部' | '个人' | '集体') => void;
  categories: string[];
  events: Event[];
  filledByEvent: TempReg[];
  groupsMap: Record<string, EventGroup[]>;
  isEventFull: (eventId: string) => boolean;
  /** 限报上限查询（null = 不限），用于卡片上提示集体项目限报队数 */
  getLimit: (scope: 'event' | 'group', targetId: string) => number | null;
  onPickEvent: (eventId: string) => void;
  disabled: boolean;
}

/** Step 2：项目分类/类型筛选 + 项目网格（行 808-864 段） */
function RegFormStep2Events({
  referenceCategory, referenceType, onCategoryChange, onTypeChange,
  categories, events, filledByEvent, groupsMap, isEventFull, getLimit, onPickEvent, disabled,
}: Step2EventsProps) {
  return (
    <div className={disabled ? 'pointer-events-none select-none opacity-60' : ''}>
      <div className="mb-4">
        <h3 className="font-semibold text-slate-800">选择报名项目</h3>
        <p className="text-xs text-slate-500 mt-1">先选择项目和组别，再添加参赛队员</p>
      </div>
      <div className="rounded-xl bg-slate-50/80 border border-slate-100 p-3 mb-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-xs font-medium text-slate-500">项目分类</span>
          <span className="text-xs text-slate-400">{events.length} 个项目</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {['全部', ...categories].map(cat => (
            <button key={cat} onClick={() => onCategoryChange(cat)} className={`shrink-0 px-4 py-1.5 rounded-full text-sm border transition-colors ${referenceCategory === cat ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-400'}`}>
              {cat}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200/70">
          <span className="text-xs font-medium text-slate-500 mr-1">项目类型</span>
          {(['全部', '个人', '集体'] as const).map(type => (
            <button key={type} onClick={() => onTypeChange(type)} className={`px-3 py-1 rounded-full text-xs border transition-colors ${referenceType === type ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-600 border-slate-200'}`}>
              {type}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
        {events.map(ev => {
          const evGroups = groupsMap[ev.id] || [];
          const filled = filledByEvent.filter(r => r.eventId === ev.id).reduce((n, r) => n + r.athletes.length, 0);
          const allFull = isEventFull(ev.id);
          return (
            <div key={ev.id} className="group rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-md hover:border-emerald-200 transition-all">
              <div className="p-4 lg:p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-semibold text-slate-800 text-[15px] lg:text-base truncate">{ev.name}</h4>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge className="bg-amber-100 text-amber-700 border-amber-200">可报组别</Badge>
                      <span className="text-xs text-slate-500 py-1">{ev.isIndividual === false ? `每队最多 ${ev.maxAthletes} 人` : '个人项目'}</span>
                      {ev.isIndividual === false && getLimit('event', ev.id) !== null && (
                        <Badge className="bg-blue-100 text-blue-700 border-blue-200">限报 {getLimit('event', ev.id)} 队</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-2">已填：{filled} 项</p>
                  </div>
                  <Button onClick={() => onPickEvent(ev.id)} disabled={allFull} className="shrink-0 bg-emerald-400 hover:bg-emerald-500 text-white rounded-full px-5">
                    {allFull ? '已满' : '填报'}
                  </Button>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100 text-sm text-slate-600 leading-relaxed line-clamp-2">可报名组别：{evGroups.length ? evGroups.map(g => g.name).join('、') : '暂未配置'}</div>
              </div>
            </div>
          );
        })}
        {events.length === 0 && <div className="lg:col-span-2 py-12 text-center text-slate-400">暂无符合条件的报名项目</div>}
      </div>
    </div>
  );
}

interface Step3AthletesProps {
  event: Event;
  allGroups: EventGroup[];
  selectedGroupId: string;
  onSelectGroup: (groupId: string) => void;
  isGroupFull: (g: EventGroup) => boolean;
  eligibleAthletes: Athlete[];
  selectedAthleteIds: string[];
  onToggleAthlete: (id: string) => void;
  maxAthletes: number;
  minAthletes: number;
  /** 该项目下已填报过的运动员（本次已填 + 已提交的报名），复选框禁用 */
  disabledAthleteIds: Set<string>;
  isAthleteQuotaReached: (id: string) => boolean;
  quotaTextFor: (id: string) => string;
  onClearAthletes: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Step 3：选组别 + 选队员（行 908-958 段） */
function RegFormStep3Athletes({
  event, allGroups, selectedGroupId, onSelectGroup, isGroupFull,
  eligibleAthletes, selectedAthleteIds, onToggleAthlete, maxAthletes, minAthletes,
  disabledAthleteIds, isAthleteQuotaReached, quotaTextFor, onClearAthletes, onCancel, onConfirm,
}: Step3AthletesProps) {
  const hasGroup = Boolean(selectedGroupId);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div><h3 className="font-semibold text-slate-800">选择报名组别</h3><p className="text-xs text-slate-500 mt-1">{event.name}</p></div>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-700">×</button>
      </div>
      <div className="mb-5">
        <div className="text-sm font-medium text-slate-700 mb-2">报名组别</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {allGroups.map(g => (
            <button key={g.id} disabled={isGroupFull(g)} onClick={() => onSelectGroup(g.id)} className={`px-3 py-2 rounded-full border text-sm ${selectedGroupId === g.id ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : isGroupFull(g) ? 'opacity-40 bg-slate-100' : 'border-slate-300 bg-white text-slate-700'}`}>
              {g.name}
            </button>
          ))}
          {allGroups.length === 0 && (
            <p className="col-span-full text-xs text-amber-600">该项目暂未配置报名组别</p>
          )}
        </div>
      </div>
      <div className="text-sm font-medium text-slate-700 mb-2">
        选择报名队员（{selectedAthleteIds.length}/{maxAthletes}）
        {minAthletes > 0 && <span className="ml-2 text-xs text-amber-600">至少需选 {minAthletes} 人</span>}
      </div>
      {!hasGroup ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-5 text-center text-sm text-amber-700">
          请先选择报名组别，系统将自动筛选符合该组别的运动员
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <button onClick={onClearAthletes} className={`px-4 py-1.5 rounded-full text-xs border ${selectedAthleteIds.length === 0 ? 'bg-slate-900 text-white' : 'bg-white border-slate-300'}`}>清空选择</button>
            <span className="text-xs text-slate-400">符合条件 {eligibleAthletes.length} 人</span>
          </div>
          <div className="space-y-2 max-h-[48vh] overflow-y-auto">
            {eligibleAthletes.map(a => {
              const checked = selectedAthleteIds.includes(a.id);
              const alreadyFilled = !checked && disabledAthleteIds.has(a.id);
              const quotaReached = !checked && !alreadyFilled && isAthleteQuotaReached(a.id);
              const locked = quotaReached || alreadyFilled;
              return <button key={a.id} type="button" disabled={locked} onClick={() => onToggleAthlete(a.id)} className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${checked ? 'border-emerald-400 bg-emerald-50' : locked ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed' : 'border-slate-200 bg-white'}`}>
                <span className={`w-5 h-5 rounded border flex items-center justify-center ${checked ? 'bg-emerald-500 border-emerald-500 text-white' : locked ? 'border-slate-200 bg-slate-100' : 'border-slate-300'}`}>{checked ? '✓' : ''}</span>
                {a.avatarUrl ? <img src={a.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover" /> : <span className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm text-slate-500">{a.name[0]}</span>}
                <span className={`font-medium ${locked ? 'text-slate-400' : 'text-slate-800'}`}>{a.name}</span><span className="text-xs text-slate-400">{a.gender === 'male' ? '男' : '女'}</span>
                {alreadyFilled && <span className="ml-auto text-[11px] text-slate-400 whitespace-nowrap">已填报该项目</span>}
                {!alreadyFilled && quotaReached && <span className="ml-auto text-[11px] text-slate-400 whitespace-nowrap">{quotaTextFor(a.id)}</span>}
              </button>;
            })}
            {eligibleAthletes.length === 0 && <p className="py-6 text-center text-sm text-amber-600">队伍中没有符合该组别要求的运动员</p>}
          </div>
        </>
      )}
      <div className="mt-5 flex gap-3"><Button variant="outline" onClick={onCancel} className="flex-1">返回</Button><Button onClick={onConfirm} className="flex-1 bg-emerald-400 hover:bg-emerald-500 text-white">确认添加</Button></div>
    </div>
  );
}

interface Step4ReviewProps {
  event: Event;
  group: EventGroup;
  groupsMap: Record<string, EventGroup[]>;
  regs: TempReg[];
  groupLimit: number | null;
  onContinue: () => void;
  onSaveReturn: () => void;
}

/** Step 4：单项目填报完成确认页（行 867-905 段） */
function RegFormStep4Review({ event, group, groupsMap, regs, groupLimit, onContinue, onSaveReturn }: Step4ReviewProps) {
  return (
    <div>
      <div className="mb-5">
        <h3 className="font-semibold text-slate-800">{event.name}</h3>
        <p className="text-xs text-slate-500 mt-1">可报组别：{(groupsMap[event.id] || []).map(g => g.name).join('、')}</p>
        <p className="text-xs text-slate-500 mt-1">性别：{group.gender || '不限'}</p>
      </div>
      <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3 mb-4 text-sm text-slate-700">
        <span className="font-medium">报名规则：</span> 该组别限报 {groupLimit ?? '不限'}{groupLimit !== null && ' 人'}
      </div>
      <div className="rounded-xl bg-slate-50 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-1 h-5 rounded-full bg-emerald-400" />
          <h4 className="font-semibold text-slate-800">已填报</h4>
        </div>
        {regs.map((reg, index) => (
          <div key={`${reg.eventId}-${reg.groupId}-${index}`} className="rounded-xl bg-white border border-slate-100 p-4">
            <div className="flex flex-wrap gap-2 mb-3">
              <Badge variant="outline" className="border-slate-200 text-slate-600">{reg.groupName}</Badge>
              <Badge variant="outline" className="border-emerald-200 text-emerald-600">{event.isIndividual === false ? '集体' : '个人'}</Badge>
            </div>
            <div className="space-y-2">
              {reg.athletes.map(athlete => (
                <div key={athlete.athleteId} className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs font-medium">{athlete.name.slice(0, 1)}</span>
                  {athlete.name}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex gap-3">
        <Button variant="outline" onClick={onSaveReturn} className="flex-1">保存返回</Button>
        <Button onClick={onContinue} className="flex-1 bg-emerald-400 hover:bg-emerald-500 text-white">添加报名项</Button>
      </div>
    </div>
  );
}

interface LockedPanelProps {
  club: ClubAccount;
  currentStep: Step;
  tempRegs: TempReg[];
  filledPanelOpen: boolean;
  onOpenPanel: () => void;
  onClosePanel: () => void;
  submittedLocked: boolean;
  adminEditUnlocked: boolean;
  deadlineInfo: { expired: boolean; level: string; text: string; reason: string | null; ok: boolean } | null;
  deadlineLabel: string;
  submitting: boolean;
  onRemoveItem: (index: number) => void;
  onSubmit: () => void;
}

/** LockedPanel：底部固定栏 + 已填报抽屉 */
function RegFormLockedPanel({
  club, currentStep, tempRegs, filledPanelOpen, onOpenPanel, onClosePanel,
  submittedLocked, adminEditUnlocked, deadlineInfo, deadlineLabel, submitting,
  onRemoveItem, onSubmit,
}: LockedPanelProps) {
  const showDrawer = filledPanelOpen && tempRegs.length > 0 && currentStep === 'catalog' && (!submittedLocked || adminEditUnlocked);
  const showBottomBar = currentStep === 'catalog';
  const deadlineBlocked = !adminEditUnlocked && deadlineInfo ? !deadlineInfo.ok : false;
  const deadlineBtnLabel = deadlineInfo && !deadlineInfo.ok
    ? (deadlineInfo.reason === 'COMPETITION_NOT_OPEN' ? '赛事未开放报名' : '报名已截止')
    : null;

  return (
    <>
      {/* 页面内已填报项目抽屉 */}
      {showDrawer && (
        <div className="fixed inset-0 z-40 bg-slate-900/35" onClick={onClosePanel}>
          <div
            className="absolute bottom-14 lg:bottom-0 inset-x-0 lg:left-64 w-auto rounded-t-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-slate-800">报名项目清单（{tempRegs.length}项）</h3>
                <p className="text-xs text-slate-500 mt-1">请确认项目、组别和运动员，确认后将提交并锁定报名</p>
              </div>
              <button type="button" onClick={onClosePanel} className="p-1.5 text-slate-400 hover:text-slate-700" aria-label="关闭已填报项目">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-3 sm:p-4 space-y-3">
              {tempRegs.map((reg, index) => (
                <div key={`${reg.eventId}-${reg.groupId}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 truncate">{reg.eventName}</div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Badge variant="outline" className="border-emerald-200 text-emerald-600">{reg.groupName}</Badge>
                      <span className="text-xs text-slate-500 py-1">{reg.athletes.length}人</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-2">{reg.athletes.map(a => a.name).join('、')}</div>
                  </div>
                  <button type="button" onClick={() => onRemoveItem(index)} className="shrink-0 text-slate-400 hover:text-red-500" aria-label={`删除${reg.eventName}填报项`}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="px-5 py-4 border-t border-slate-100">
              <Button onClick={onSubmit} disabled={submitting || tempRegs.length === 0 || (submittedLocked && !adminEditUnlocked) || deadlineBlocked} className="w-full rounded-full bg-emerald-400 hover:bg-emerald-500 text-white h-12 disabled:bg-slate-200 disabled:text-slate-500">
                {submitting ? '提交中...' : adminEditUnlocked ? '确认修改后的项目清单并提交' : deadlineBtnLabel || '确认项目清单并提交报名'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 页面底部固定操作栏 */}
      {showBottomBar && (
        <div className="fixed bottom-14 lg:bottom-0 inset-x-0 lg:left-64 z-30 pointer-events-none">
          <div className="w-full pointer-events-auto">
            <div className="w-full min-h-16 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-6px_24px_rgba(15,23,42,0.12)] flex items-stretch">
              <button
                type="button"
                onClick={onOpenPanel}
                disabled={submittedLocked || tempRegs.length === 0}
                className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 xl:px-10 py-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <div className="font-medium text-slate-800 flex items-center gap-1.5 truncate">
                  {adminEditUnlocked ? '管理员已允许修改报名项目' : submittedLocked ? '报名已提交，界面已锁定' : `已报名项目（${tempRegs.length}项）`}
                  {filledPanelOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />}
                </div>
                <div className="text-xs text-slate-500 mt-1 truncate">{adminEditUnlocked ? '请修改项目后重新提交，最终清单将覆盖原报名信息' : submittedLocked ? '报名信息已提交，当前报名界面不可再次操作' : '点击查看项目清单并提交报名'}</div>
              </button>
              <div className="flex items-center px-3 sm:px-5 lg:px-6 border-l border-slate-100">
                <Button type="button" onClick={onOpenPanel} disabled={(submittedLocked && !adminEditUnlocked) || submitting || tempRegs.length === 0 || deadlineBlocked} className={`rounded-full px-5 sm:px-8 h-11 whitespace-nowrap ${(submittedLocked && !adminEditUnlocked) || deadlineBlocked ? 'bg-slate-200 text-slate-600 hover:bg-slate-200' : 'bg-emerald-400 hover:bg-emerald-500 text-white'}`}>
                  {adminEditUnlocked ? '查看修改后的项目清单' : submittedLocked ? '报名已提交' : deadlineBtnLabel || '查看项目清单并提交报名'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
}