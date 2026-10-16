-- YearFlow 0005：个人主工作台四张表（docs/DESK_SPEC.md §七）
-- 在 Supabase Dashboard → SQL Editor 整段执行一次。可重复执行（幂等）。
--
-- 执行顺序 0001 → 0002 → (0003) → 0004 → 0005；本文件覆盖 upsert_rows，白名单是 0004 的超集。
-- 之后若再加表，新迁移同样「整段复制本文件的 upsert_rows 并追加表名」，不要回头重跑旧文件。
--
-- 上线顺序：先执行本文件，再部署新版前端。
-- （新版同步引擎已逐表隔离：没执行时只有这四张表不同步、状态点报「云端缺少表」，其余表照常。）

do $$
declare
  t text;
begin
  foreach t in array array['work_items', 'routines', 'routine_logs', 'day_marks']
  loop
    execute format($sql$
      create table if not exists public.%1$I (
        id text not null,
        user_id uuid not null default auth.uid(),
        data jsonb not null,
        updated_at timestamptz not null,
        deleted_at timestamptz,
        server_updated_at timestamptz not null default clock_timestamp(),
        primary key (user_id, id)
      );
    $sql$, t);

    -- 增量拉取索引：where user_id = ? and server_updated_at > ?
    execute format(
      'create index if not exists %1$I on public.%2$I (user_id, server_updated_at);',
      t || '_pull_idx', t
    );

    -- RLS：只允许操作自己的行。漏了这段则表对所有登录用户可读
    execute format('alter table public.%1$I enable row level security;', t);
    execute format('drop policy if exists %1$I on public.%2$I;', t || '_own_rows', t);
    execute format($sql$
      create policy %1$I on public.%2$I
        for all
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $sql$, t || '_own_rows', t);

    -- server_updated_at 触发器：漏了则 update 不刷新该列，增量拉取游标永久停滞
    execute format('drop trigger if exists %1$I on public.%2$I;', t || '_touch', t);
    execute format($sql$
      create trigger %1$I
        before insert or update on public.%2$I
        for each row execute function public.touch_server_updated_at();
    $sql$, t || '_touch', t);
  end loop;
end;
$$;

create or replace function public.upsert_rows(p_table text, p_rows jsonb)
returns void
language plpgsql
as $$
begin
  if p_table not in ('goals', 'tasks', 'milestones', 'check_ins', 'exemptions', 'reviews',
                     'focus_sessions', 'screen_time_days',
                     'work_items', 'routines', 'routine_logs', 'day_marks') then
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
