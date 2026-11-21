-- 0022f (T041): trigger-only SECURITY DEFINER functions are not API functions. Removing EXECUTE from anon/authenticated/public
-- clears 3 anon and 3 authenticated advisor warnings. Triggers keep firing: trigger invocation does not check EXECUTE on the function.
-- Idempotent; no data or signature change.
revoke execute on function public.comments_after_insert() from public, anon, authenticated;
revoke execute on function public.comments_guard() from public, anon, authenticated;
revoke execute on function public.realtime_broadcast_row() from public, anon, authenticated;
