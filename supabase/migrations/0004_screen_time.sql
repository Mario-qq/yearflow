-- YearFlow 0004：屏幕时间原始数据表（电脑端 scripts/screentime 每个工作日 9:00 写入）
-- 在 Supabase Dashboard → SQL Editor 整段执行一次。可重复执行（幂等）。
--
-- ⚠️ 必须先于新版前端上线执行：同步引擎按 TABLE_NAMES 逐表拉取，表不存在会让整轮同步报错
--    （所有表都停同步，不只是这张）。
-- 执行顺序 0001 → 0002 → (0003) → 0004；本文件覆盖 upsert_rows，白名单是 0002 的超集。

create table if not exists public.screen_time_days (
  id text not null,
  user_id uuid not null default auth.uid(),
  data jsonb not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

create index if not exists screen_time_days_pull_idx
  on public.screen_time_days (user_id, server_updated_at);

alter table public.screen_time_days enable row level security;

drop policy if exists screen_time_days_own_rows on public.screen_time_days;
create policy screen_time_days_own_rows on public.screen_time_days
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists screen_time_days_touch on public.screen_time_days;
create trigger screen_time_days_touch
  before insert or update on public.screen_time_days
  for each row execute function public.touch_server_updated_at();

create or replace function public.upsert_rows(p_table text, p_rows jsonb)
returns void
language plpgsql
as $$
begin
  if p_table not in ('goals', 'tasks', 'milestones', 'check_ins', 'exemptions', 'reviews',
                     'focus_sessions', 'screen_time_days') then
    raise exception 'upsert_rows: 非法表名 %', p_table;
  end if;
  execute format($sql$
    insert into public.%1$I (id, data, updated_at, deleted_at)
    select r->>'id',
           r->'data',
           (r->>'updated_at')::timestamptz,
           (r->>'deleted_at')::timestamptz
    from jsonb_array_elements($1) as r
    on conflict (user_id, id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      where excluded.updated_at > %1$I.updated_at
  $sql$, p_table) using p_rows;
end;
$$;
