import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 未配置凭据时为 null：应用退化为纯本地模式，同步 UI 整体隐藏（SPEC 第十节） */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;
