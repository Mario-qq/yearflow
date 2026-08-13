-- YearFlow 0002：番茄钟专注会话表
-- 在 Supabase Dashboard → SQL Editor 整段执行一次。可重复执行（幂等）。
--
-- 与 0001 的关系：0001 不得再单独重跑（它的 upsert_rows 白名单硬编码 6 表，
-- 重跑会把这里加的 focus_sessions 静默改回去，随后推送报「非法表名」）。
-- 若要重建，顺序执行 0001 → 0002。

create table if not exists public.focus_sessions (
  id text not null,
  user_id uuid not null default auth.uid(),
  data jsonb not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  server_updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, id)
);

-- 增量拉取索引：where user_id = ? and server_updated_at > ?
create index if not exists focus_sessions_pull_idx
  on public.focus_sessions (user_id, server_updated_at);

alter table public.focus_sessions enable row level security;

-- RLS：只允许操作自己的行。漏了这段则表对所有登录用户可读
drop policy if exists focus_sessions_own_rows on public.focus_sessions;
create policy focus_sessions_own_rows on public.focus_sessions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- server_updated_at 触发器：漏了则 update 不刷新该列，该表的增量拉取游标永久停滞，
-- 其它设备再也拉不到更新（同步引擎的拉取完全依赖它）
drop trigger if exists focus_sessions_touch on public.focus_sessions;
create trigger focus_sessions_touch
  before insert or update on public.focus_sessions
  for each row execute function public.touch_server_updated_at();

-- 扩展 upsert_rows 的表名白名单（0001 里是硬编码的）。签名不变，create or replace 覆盖即可。
create or replace function public.upsert_rows(p_table text, p_rows jsonb)
returns void
language plpgsql
as $$
begin
  if p_table not in ('goals', 'tasks', 'milestones', 'check_ins', 'exemptions', 'reviews', 'focus_sessions') then
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
