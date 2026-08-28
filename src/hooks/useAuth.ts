import { useState, useEffect } from 'react';
import { clubStore, adminAuth } from '@/lib/store';
import { toast } from 'sonner';
import type { ClubAccount } from '@/types';

export function useClubAuth() {
  const [currentClub, setCurrentClub] = useState<ClubAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    clubStore.restoreSession()
      .then(club => { if (active) setCurrentClub(club); })
      .catch(() => { if (active) setCurrentClub(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const club = await clubStore.login(username, password);
      if (!club) {
        toast.error('登录失败，用户名或密码错误');
        return false;
      }
      clubStore.setCurrent(club);
      setCurrentClub(club);
      return true;
    } catch (err) {
      toast.error('登录失败，请检查网络连接后重试');
      return false;
    }
  };

  const register = async (
    data: Omit<ClubAccount, 'id' | 'createdAt' | 'isApproved'>,
    password: string
  ): Promise<boolean> => {
    try {
      const club = await clubStore.create({ ...data, password });
      clubStore.setCurrent(club);
      setCurrentClub(club);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '注册失败';
      toast.error(msg);
      return false;
    }
  };

  const logout = () => {
    clubStore.setCurrent(null);
    setCurrentClub(null);
  };

  return { currentClub, loading, login, register, logout };
}

export function useAdminAuth() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    adminAuth.restoreSession()
      .then(user => { if (active) setIsAdmin(Boolean(user)); })
      .catch(() => { if (active) setIsAdmin(false); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const login = async (user: string, pass: string): Promise<boolean> => {
    const ok = await adminAuth.login(user, pass);
    if (ok) setIsAdmin(true);
    return ok;
  };

  const logout = () => {
    adminAuth.logout();
    setIsAdmin(false);
  };

  return { isAdmin, loading, login, logout };
}
