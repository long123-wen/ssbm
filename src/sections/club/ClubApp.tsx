import { useState, useEffect } from 'react';
import { useClubAuth } from '@/hooks/useAuth';
import ClubLogin from './ClubLogin';
import ClubRegister from './ClubRegister';
import ClubDashboard from './ClubDashboard';
import ClubTeamSetup from './ClubTeamSetup';
import ClubCompetitionSelect, { getStoredCompetitionId, setStoredCompetitionId } from './ClubCompetitionSelect';
import { competitionStore, teamProfileStore, clearCache } from '@/lib/store';
import type { Competition, ClubAccount, TeamProfile } from '@/types';
import { Loader2 } from 'lucide-react';

export default function ClubApp() {
  const [view, setView] = useState<'login' | 'register'>('login');
  const { currentClub, loading, login, register, logout } = useClubAuth();

  // Competition selection state
  const [selectedCompId, setSelectedCompId] = useState<string | null>(null);
  const [selectedComp, setSelectedComp] = useState<Competition | null>(null);
  const [compCheckLoading, setCompCheckLoading] = useState(true);

  // Multi-team state
  const [teamProfiles, setTeamProfiles] = useState<TeamProfile[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamCheckLoading, setTeamCheckLoading] = useState(false);

  // Team setup control
  const [showTeamSetup, setShowTeamSetup] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamProfile | null>(null);

  // On login/register: verify stored competition is still valid
  useEffect(() => {
    if (!currentClub) {
      setSelectedCompId(null);
      setSelectedComp(null);
      setTeamProfiles([]);
      setSelectedTeamId(null);
      setShowTeamSetup(false);
      setEditingTeam(null);
      setCompCheckLoading(false);
      return;
    }

    const storedId = getStoredCompetitionId();
    if (!storedId) {
      setCompCheckLoading(false);
      return;
    }

    competitionStore.getById(storedId).then(comp => {
      if (comp) {
        setSelectedCompId(comp.id);
        setSelectedComp(comp);
        loadTeamProfiles(comp.id, currentClub.id);
      }
      setCompCheckLoading(false);
    }).catch(() => setCompCheckLoading(false));
  }, [currentClub]);

  const loadTeamProfiles = async (cid: string, clubId: string) => {
    setTeamCheckLoading(true);
    try {
      const profiles = await teamProfileStore.getAllByClubAndCompetition(clubId, cid);
      setTeamProfiles(profiles);
      // Auto-select first team if none selected or current selection is stale
      if (profiles.length > 0) {
        const currentStillExists = profiles.some(p => p.id === selectedTeamId);
        if (!currentStillExists) {
          setSelectedTeamId(profiles[0].id);
        }
      } else {
        setSelectedTeamId(null);
      }
    } catch {
      setTeamProfiles([]);
      setSelectedTeamId(null);
    } finally {
      setTeamCheckLoading(false);
    }
  };

  const handleSelectCompetition = (id: string, comp: Competition) => {
    setStoredCompetitionId(id);
    setSelectedCompId(id);
    setSelectedComp(comp);
    clearCache();
    setSelectedTeamId(null);
    setTeamProfiles([]);
    setShowTeamSetup(false);
    setEditingTeam(null);
    if (currentClub) {
      loadTeamProfiles(id, currentClub.id);
    }
  };

  const handleTeamSetupComplete = async () => {
    // Reload all teams after create/edit
    if (currentClub && selectedCompId) {
      await loadTeamProfiles(selectedCompId, currentClub.id);
    }
    setShowTeamSetup(false);
    setEditingTeam(null);
  };

  const handleAddTeam = () => {
    setEditingTeam(null);
    setShowTeamSetup(true);
  };

  const handleEditTeam = (profile: TeamProfile) => {
    setEditingTeam(profile);
    setShowTeamSetup(true);
  };

  const handleSwitchCompetition = () => {
    setSelectedCompId(null);
    setSelectedComp(null);
    setTeamProfiles([]);
    setSelectedTeamId(null);
    setShowTeamSetup(false);
    setEditingTeam(null);
    clearCache();
  };

  const handleBackFromTeamSetup = () => {
    // If there are existing teams, go back to dashboard; otherwise back to competition select
    if (teamProfiles.length > 0) {
      setShowTeamSetup(false);
      setEditingTeam(null);
    } else {
      handleSwitchCompetition();
    }
  };

  if (loading || compCheckLoading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="text-sm text-slate-400">加载中...</span>
      </div>
    </div>
  );

  if (!currentClub) {
    if (view === 'register') return (
      <ClubRegister onRegister={register} onToLogin={() => setView('login')} />
    );
    return <ClubLogin onLogin={login} onToRegister={() => setView('register')} />;
  }

  // Step 1: No competition selected → show selection page
  if (!selectedCompId) {
    return (
      <ClubCompetitionSelect
        club={currentClub}
        onSelect={handleSelectCompetition}
        onLogout={logout}
      />
    );
  }

  // Team profiles loading
  if (teamCheckLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
          <span className="text-sm text-slate-400">检查队伍资料...</span>
        </div>
      </div>
    );
  }

  // Step 2: Team setup (forced if no teams, or manually triggered)
  if (showTeamSetup && selectedComp) {
    return (
      <ClubTeamSetup
        club={currentClub}
        competition={selectedComp}
        existingProfile={editingTeam || undefined}
        onBack={handleBackFromTeamSetup}
        onContinue={handleTeamSetupComplete}
      />
    );
  }

  // Step 2 auto: No teams yet → force team setup
  if (teamProfiles.length === 0 && selectedComp) {
    return (
      <ClubTeamSetup
        club={currentClub}
        competition={selectedComp}
        onBack={handleBackFromTeamSetup}
        onContinue={handleTeamSetupComplete}
      />
    );
  }

  // Step 3: Teams exist → show dashboard
  return (
    <ClubDashboard
      club={currentClub}
      competitionId={selectedCompId}
      competitionName={selectedComp?.name || ''}
      teamProfiles={teamProfiles}
      selectedTeamId={selectedTeamId || teamProfiles[0]?.id}
      onSelectTeam={setSelectedTeamId}
      onAddTeam={handleAddTeam}
      onEditTeam={handleEditTeam}
      onSwitchCompetition={handleSwitchCompetition}
      onLogout={logout}
    />
  );
}
