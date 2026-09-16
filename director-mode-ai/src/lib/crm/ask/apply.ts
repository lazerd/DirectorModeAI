/**
 * Applying a proposal, after the rep pressed Confirm.
 *
 * This is the only file in the ask box that writes. It does not trust the
 * proposal it is handed — the model built the arguments, the browser posted
 * them back, and either could be wrong or tampered with. Every field is
 * re-validated here against the same rules /api/crm/orgs/[id] uses, and every
 * id is looked up again before it is written to.
 *
 * It is also deliberately incapable of sending email. `draft_email` returns
 * the draft to the caller and touches nothing; the message still has to go
 * through the compose panel's preview and Send, which is where the house rule
 * about previewing before every send lives.
 */

import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isISODate, type ISODate } from '../dates';
import { STAGE_LABEL, isActivityKind, isStage, type Stage } from '../stages';
import { crmTable, PROPOSAL_ACTIONS, type Proposal, type ProposalAction } from './tools';

type Db = ReturnType<typeof getSupabaseAdmin>;

export interface ApplyContext {
  allowed: boolean;
  db: Db;
  repEmail: string;
  repName: string;
  today: ISODate;
  /** On /crm/[id], nothing may be applied to any other club. */
  orgId: string | null;
}

export type ApplyResult =
  | { ok: true; message: string; draft?: { org_id: string; contact_id: string; subject: string; body: string } }
  | { ok: false; error: string };

/** Is this shape a proposal at all? Called before anything is read out of it. */
export function isProposal(v: unknown): v is Proposal {
  const p = v as Proposal | null;
  return (
    !!p &&
    typeof p === 'object' &&
    typeof p.action === 'string' &&
    (PROPOSAL_ACTIONS as readonly string[]).includes(p.action) &&
    !!p.args &&
    typeof p.args === 'object'
  );
}

function s(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** The org exists, and the page we are on is allowed to touch it. */
async function org(ctx: ApplyContext, id: unknown): Promise<{ id: string; name: string; stage: Stage } | null> {
  const wanted = s(id, 40);
  if (!/^[0-9a-f-]{36}$/i.test(wanted)) return null;
  if (ctx.orgId && ctx.orgId !== wanted) return null;
  const { data } = await crmTable(ctx.db, 'crm_orgs').select('id, name, stage').eq('id', wanted).maybeSingle();
  return (data as { id: string; name: string; stage: Stage } | null) ?? null;
}

export async function applyProposal(p: Proposal, ctx: ApplyContext): Promise<ApplyResult> {
  if (!ctx || ctx.allowed !== true) return { ok: false, error: 'Not found.' };
  if (!isProposal(p)) return { ok: false, error: 'That is not something I can apply.' };

  const a = p.args as Record<string, unknown>;
  const action = p.action as ProposalAction;

  switch (action) {
    // ------------------------------------------------------------- stage
    case 'set_stage': {
      const o = await org(ctx, a.org_id);
      if (!o) return { ok: false, error: 'That club is not there any more.' };
      if (!isStage(a.stage)) return { ok: false, error: 'That is not a stage.' };
      if (o.stage === a.stage) return { ok: false, error: `${o.name} is already at ${STAGE_LABEL[a.stage]}.` };

      // Same stamping rule as the PATCH route: a card that leaves won or lost
      // must not keep the timestamp, or "how long did that take" lies later.
      const { error } = await crmTable(ctx.db, 'crm_orgs')
        .update({
          stage: a.stage,
          won_at: a.stage === 'won' ? new Date().toISOString() : null,
          lost_at: a.stage === 'lost' ? new Date().toISOString() : null,
          ...(a.stage === 'lost' ? {} : { lost_reason: null }),
        })
        .eq('id', o.id);
      if (error) return { ok: false, error: error.message };

      await crmTable(ctx.db, 'crm_activities').insert({
        org_id: o.id,
        kind: 'stage_change',
        body: `${STAGE_LABEL[o.stage]} → ${STAGE_LABEL[a.stage]}`,
        created_by_email: ctx.repEmail,
      });
      return { ok: true, message: `${o.name} is at ${STAGE_LABEL[a.stage]}.` };
    }

    // --------------------------------------------------------- next step
    case 'set_next_step': {
      const o = await org(ctx, a.org_id);
      if (!o) return { ok: false, error: 'That club is not there any more.' };
      const step = s(a.next_step, 300);
      if (!step) return { ok: false, error: 'A next step needs words.' };
      const due = s(a.next_step_at, 20) || null;
      if (due && !isISODate(due)) return { ok: false, error: 'That date is not a date.' };
      const { error } = await crmTable(ctx.db, 'crm_orgs')
        .update({ next_step: step, next_step_at: due })
        .eq('id', o.id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, message: `${o.name}: ${step}${due ? ` by ${due}` : ''}.` };
    }

    // -------------------------------------------------------------- note
    case 'add_note': {
      const o = await org(ctx, a.org_id);
      if (!o) return { ok: false, error: 'That club is not there any more.' };
      const body = s(a.body, 8000);
      if (!body) return { ok: false, error: 'An empty note is not a note.' };
      const kind = isActivityKind(a.kind) && a.kind !== 'stage_change' ? a.kind : 'note';
      const on = s(a.occurred_at, 20);
      // Midday Pacific, so a date-only value reads back as the day it says —
      // the same anchoring the activities route does.
      const occurredAt = on && isISODate(on) ? `${on}T19:00:00.000Z` : undefined;
      const { error } = await crmTable(ctx.db, 'crm_activities').insert({
        org_id: o.id,
        kind,
        body,
        created_by_email: ctx.repEmail,
        ...(occurredAt ? { occurred_at: occurredAt } : {}),
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, message: `Logged on ${o.name}.` };
    }

    // ----------------------------------------------------------- contact
    case 'add_contact': {
      const o = await org(ctx, a.org_id);
      if (!o) return { ok: false, error: 'That club is not there any more.' };
      const fullName = s(a.full_name, 160);
      if (!fullName) return { ok: false, error: 'A contact needs a name.' };
      const email = s(a.email, 200).toLowerCase() || null;
      const { error } = await crmTable(ctx.db, 'crm_contacts').insert({
        org_id: o.id,
        full_name: fullName,
        title: s(a.title, 160) || null,
        email,
        phone: s(a.phone, 60) || null,
        role: s(a.role, 120) || null,
      });
      if (error) {
        return { ok: false, error: error.code === '23505' ? `${fullName} is already on ${o.name}.` : error.message };
      }
      return { ok: true, message: `${fullName} added to ${o.name}.` };
    }

    // ---------------------------------------------------- do not contact
    case 'set_do_not_contact': {
      const id = s(a.contact_id, 40);
      if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'That is not a contact.' };
      const { data: row } = await crmTable(ctx.db, 'crm_contacts')
        .select('id, org_id, full_name')
        .eq('id', id)
        .maybeSingle();
      const c = row as { id: string; org_id: string; full_name: string } | null;
      if (!c) return { ok: false, error: 'That person is not there any more.' };
      if (ctx.orgId && ctx.orgId !== c.org_id) return { ok: false, error: 'That person is at a different club.' };
      const on = a.on !== false;
      const { error } = await crmTable(ctx.db, 'crm_contacts').update({ do_not_contact: on }).eq('id', c.id);
      if (error) return { ok: false, error: error.message };
      return {
        ok: true,
        message: on ? `${c.full_name} will not be written to again.` : `${c.full_name} can be written to again.`,
      };
    }

    // ------------------------------------------------------------ queue
    case 'queue_for_outreach': {
      const raw = Array.isArray(a.org_ids) ? a.org_ids : [];
      const ids = raw
        .map((v) => s(v, 40))
        .filter((v) => /^[0-9a-f-]{36}$/i.test(v))
        .filter((v) => !ctx.orgId || v === ctx.orgId)
        .slice(0, 500);
      if (!ids.length) return { ok: false, error: 'No clubs to queue.' };
      const unqueue = a.unqueue === true;
      const { error } = await crmTable(ctx.db, 'crm_orgs')
        .update({ queued_at: unqueue ? null : new Date().toISOString() })
        .in('id', ids);
      if (error) return { ok: false, error: error.message };
      return {
        ok: true,
        message: unqueue
          ? `${ids.length} club${ids.length === 1 ? '' : 's'} taken out of the outreach queue.`
          : `${ids.length} club${ids.length === 1 ? '' : 's'} queued for outreach.`,
      };
    }

    // ------------------------------------------------------------ draft
    //
    // Writes nothing. The draft goes back to the browser, which opens the
    // compose panel with it; preview and Send are unchanged and still
    // required. There is no route from this switch to Resend.
    case 'draft_email': {
      const o = await org(ctx, a.org_id);
      if (!o) return { ok: false, error: 'That club is not there any more.' };
      const contactId = s(a.contact_id, 40);
      if (!/^[0-9a-f-]{36}$/i.test(contactId)) return { ok: false, error: 'That is not a contact.' };
      const { data: row } = await crmTable(ctx.db, 'crm_contacts')
        .select('id, org_id, full_name, email, do_not_contact')
        .eq('id', contactId)
        .maybeSingle();
      const c = row as { id: string; org_id: string; full_name: string; email: string | null; do_not_contact: boolean } | null;
      if (!c || c.org_id !== o.id) return { ok: false, error: 'That person is not at this club.' };
      if (c.do_not_contact) return { ok: false, error: `${c.full_name} is marked "don't contact".` };
      if (!c.email) return { ok: false, error: `${c.full_name} has no email address.` };
      const subject = s(a.subject, 300);
      const body = s(a.body, 6000);
      if (!subject || !body) return { ok: false, error: 'A draft needs a subject and a message.' };
      return {
        ok: true,
        message: `Draft ready for ${c.full_name}. Preview it before it goes anywhere.`,
        draft: { org_id: o.id, contact_id: c.id, subject, body },
      };
    }
  }
}
