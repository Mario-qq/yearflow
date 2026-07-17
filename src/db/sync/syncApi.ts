/**
 * 同步引擎的懒加载门面：UI 层一律从这里导入。
 * supabase-js（~215KB）与 engine 由此切进独立异步分包，不进首屏关键路径；
 * useSyncStore / signal 体积极小，保持静态导入。
 */

export const isSyncConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
);

const engine = () => import('./engine');

export async function initSync(): Promise<void> {
  if (isSyncConfigured) (await engine()).initSync();
}

export async function syncNow(): Promise<void> {
  if (isSyncConfigured) await (await engine()).syncNow();
}

export async function signIn(email: string, password: string): Promise<string | null> {
  return (await engine()).signIn(email, password);
}

export async function signUp(
  email: string,
  password: string,
): Promise<{ error: string | null; needsEmailConfirm: boolean }> {
  return (await engine()).signUp(email, password);
}

export async function signOut(): Promise<void> {
  await (await engine()).signOut();
}
