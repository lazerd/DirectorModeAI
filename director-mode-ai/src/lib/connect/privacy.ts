/** Where the candidate privacy notice lives, plus the one-line footer for candidate-facing emails. */
export const PRIVACY_PATH = '/connect/privacy';

export function privacyEmailLine(appUrl: string): string {
  return `<p style="color:#64748b;font-size:13px">Your details go only to clubs you choose, and never to your current employer. <a href="${appUrl}${PRIVACY_PATH}" style="color:#64748b">How we handle your information</a>.</p>`;
}
