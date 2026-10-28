"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAdminNotifications, fetchUnreadNotificationCount, markAdminNotificationRead,
  markAllAdminNotificationsRead, notificationPageSize,
  type AdminNotification, type NotificationFilter, type NotificationQuery, recentNotificationQuery,
} from "@/lib/adminNotifications";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Notifications are unavailable. Please retry.";

export function useNotificationInbox(userId: string) {
  const [items, setItems] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [query, setQuery] = useState<NotificationQuery>(recentNotificationQuery);
  const queryRef = useRef<NotificationQuery>(recentNotificationQuery);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const countRevision = useRef(0);
  const busyRef = useRef(false);
  const initialCount = useRef<Promise<number> | null>(null);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const version = ++countRevision.current;
    initialCount.current ??= fetchUnreadNotificationCount(userId);
    void initialCount.current.then((count) => {
      if (active && version === countRevision.current) setUnreadCount(count);
    }).catch(() => {
      if (active && version === countRevision.current) setUnreadCount(null);
    });
    return () => { active = false; mounted.current = false; revision.current += 1; };
  }, [userId]);

  const refresh = useCallback(async (next: NotificationQuery = queryRef.current, limit = notificationPageSize) => {
    queryRef.current = next;
    setQuery(next);
    const version = ++revision.current;
    const countVersion = ++countRevision.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setActionError(null);
    try {
      const countFromPage = next.filter === "unread" && !next.search && next.category === "all";
      const [page, count] = await Promise.all([
        fetchAdminNotifications(userId, next.filter, 0, limit, next),
        countFromPage ? Promise.resolve(null) : fetchUnreadNotificationCount(userId),
      ]);
      if (!mounted.current || version !== revision.current) return false;
      setItems([...new Map(page.items.map((item) => [item.id, item])).values()]);
      setTotal(page.total);
      setHasMore(page.items.length < page.total);
      if (countVersion === countRevision.current) setUnreadCount(countFromPage ? page.total : count);
      return true;
    } catch (failure) {
      if (mounted.current && version === revision.current) {
        setItems([]);
        setTotal(null);
        setHasMore(false);
        setError(errorMessage(failure));
        setUnreadCount(null);
      }
      return false;
    } finally {
      if (mounted.current && version === revision.current) setLoading(false);
    }
  }, [userId]);

  const changeQuery = (changes: Partial<NotificationQuery>) => {
    if (busyRef.current) return;
    const next = { ...queryRef.current, ...changes };
    next.search = next.search.trim().slice(0, 160);
    if (next.filter === queryRef.current.filter && next.search === queryRef.current.search && next.category === queryRef.current.category) return;
    void refresh(next);
  };
  const changeFilter = (filter: NotificationFilter) => changeQuery({ filter });
  const resetRecent = () => refresh(recentNotificationQuery);

  const loadMore = async () => {
    if (loading || loadingMore || !hasMore || busyRef.current) return;
    const version = revision.current;
    setLoadingMore(true);
    setActionError(null);
    try {
      const page = await fetchAdminNotifications(userId, queryRef.current.filter, items.length, notificationPageSize, queryRef.current);
      if (!mounted.current || version !== revision.current) return;
      const merged = [...new Map([...items, ...page.items].map((item) => [item.id, item])).values()];
      setItems(merged);
      setTotal(page.total);
      setHasMore(page.items.length > 0 && merged.length > items.length && merged.length < page.total);
    } catch (failure) {
      if (mounted.current && version === revision.current) setActionError(errorMessage(failure));
    } finally {
      if (mounted.current && version === revision.current) setLoadingMore(false);
    }
  };

  const markRead = async (id?: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    revision.current += 1;
    countRevision.current += 1;
    try {
      if (id) await markAdminNotificationRead(userId, id);
      else await markAllAdminNotificationsRead(userId);
      if (!mounted.current) return false;
      return await refresh(queryRef.current, Math.max(notificationPageSize, items.length));
    } catch (failure) {
      if (mounted.current) setActionError(errorMessage(failure));
      return false;
    } finally {
      busyRef.current = false;
      if (mounted.current) { setBusy(false); setLoading(false); }
    }
  };

  return { items, unreadCount, ...query, total, loading, loadingMore, hasMore, error, actionError, changeQuery, resetRecent,
    busy, refresh, changeFilter, loadMore, markRead };
}
