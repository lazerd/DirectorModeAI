/** One RECRUITER pass: evaluate → rank → draft → send (auto + approved). */
import { evaluatePending } from './evaluate';
import { rankAll } from './prospects';
import { draftAll } from './outreach';
import { sendQueue } from './send';

export async function runRecruiter(opts: { send?: boolean; evaluateLimit?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 270_000;
  const evaluated = await evaluatePending({ limit: opts.evaluateLimit ?? 15 });
  const ranked = await rankAll();
  const drafted = await draftAll();
  const remaining = budget - (Date.now() - started);
  const sent = opts.send === false || remaining < 10_000 ? null : await sendQueue({ deadlineMs: remaining - 5_000 });
  return { evaluated: evaluated.evaluated, ranked, drafted, sent, ms: Date.now() - started };
}
