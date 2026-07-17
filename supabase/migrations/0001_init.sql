-- YearFlow 云同步建表 + RLS（SPEC 第十节）
-- 在 Supabase Dashboard → SQL Editor 中整段执行一次即可。
--
-- 设计：
--   每张表与本地 IndexedDB 一一对应；实体完整内容存 data(jsonb)，
--   updated_at/deleted_at 为索引/清理用途的冗余列（真值以 data 内 ISO 字符串为准）。
--   server_updated_at 由触发器写 clock_timestamp()，作为增量拉取游标
--   （不信任客户端时钟，避免时钟偏差漏拉）。
--   冲突策略：整行 last-write-wins（按 data->>'updatedAt'，客户端裁决）。

create or replace function public.touch_server_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at = clock_timestamp();
  return new;
end;
$$;

-- 六张实体表结构完全相同，用 DO 块批量创建
do $$
declare
  t text;
begin
  foreach t in array array['goals', 'tasks', 'milestones', 'check_ins', 'exemptions', 'reviews']
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

    execute format('alter table public.%1$I enable row level security;', t);

    -- RLS：只允许操作自己的行（select/insert/update/delete 全覆盖）
    execute format('drop policy if exists %1$I on public.%2$I;', t || '_own_rows', t);
    execute format($sql$
      create policy %1$I on public.%2$I
        for all
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $sql$, t || '_own_rows', t);

    execute format('drop trigger if exists %1$I on public.%2$I;', t || '_touch', t);
    execute format($sql$
      create trigger %1$I
        before insert or update on public.%2$I
        for each row execute function public.touch_server_updated_at();
    $sql$, t || '_touch', t);
  end loop;
end;
$$;

-- 批量条件 upsert：整行 LWW 的服务端兜底——只有 updated_at 更新的行才覆盖现值，
-- 离线设备迟到的旧改动推不倒服务器上的新版本；回声推送（updated_at 相等）跳过，
-- 不空转 server_updated_at（避免其它设备无谓重拉）。
-- security invoker（缺省）：RLS 照常生效，只能写自己的行。
create or replace function public.upsert_rows(p_table text, p_rows jsonb)
returns void
language plpgsql
as $$
begin
  if p_table not in ('goals', 'tasks', 'milestones', 'check_ins', 'exemptions', 'reviews') then
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
