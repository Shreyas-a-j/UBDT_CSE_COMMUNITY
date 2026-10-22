'use client';

/**
 * Small shared unread-notification counter. It powers the Alerts tab badge
 * and lets the notifications screen update the badge immediately after
 * marking items read. Realtime INSERT/UPDATE events keep it live.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './auth-context';
import { supabase } from './supabase';

interface UnreadState {
  count: number;
  refresh: () => Promise<void>;
}

const UnreadContext = createContext<UnreadState>({ count: 0, refresh: async () => {} });

export function UnreadNotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [count, setCount] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      if (mounted.current) setCount(0);
      return;
    }
    const { count: unread, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('read', false);
    if (!error && mounted.current) setCount(unread ?? 0);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;

    const channel = supabase
      .channel(`unread-notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          void refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  const value = useMemo(() => ({ count, refresh }), [count, refresh]);

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnreadNotifications() {
  return useContext(UnreadContext);
}
