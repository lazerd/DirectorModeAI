import type { Metadata } from 'next';
import AuthorizeClient from '@/components/play/AuthorizeClient';
import { checkAuthorize, OAuthError, type AuthorizeParams } from '@/lib/play/mcpAuth';

export const metadata: Metadata = { title: 'Connect Racquets IRL', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * The one place Racquets IRL asks anyone to sign in: an organizer connecting Claude or ChatGPT
 * (OAuth authorize). Game pages stay no-login.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => { const v = searchParams[k]; return (Array.isArray(v) ? v[0] : v) ?? ''; };
  const params: AuthorizeParams = {
    response_type: one('response_type'), client_id: one('client_id'), redirect_uri: one('redirect_uri'),
    code_challenge: one('code_challenge'), code_challenge_method: one('code_challenge_method') || 'S256',
    state: one('state') || null, scope: one('scope') || null,
  };
  let clientName = '';
  let problem: string | null = null;
  try { clientName = (await checkAuthorize(params)).clientName; } catch (e) {
    problem = e instanceof OAuthError ? e.message : 'Something went wrong. Try connecting again.';
  }
  return <AuthorizeClient params={params} clientName={clientName} problem={problem} />;
}
