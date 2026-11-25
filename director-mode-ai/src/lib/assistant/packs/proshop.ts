import type { DomainPack, ToolDef } from '../framework';
import { resolveClubCtx, type ClubCtx } from '../clubContext';
import { STAFF, STAFF_IDS } from '@/lib/proshop/staff';
import { addOrder } from '@/lib/proshop/server';

/*
 * Pro Shop pack: the director's AI staff on clubmode.ai/proshop.
 *
 * The page sends page="/proshop" for the command bar and "/proshop?staff=<id>" when the
 * director is talking to one staff member in their drawer. The model speaks as that
 * staff member (or, from the command bar, as whoever fits) and puts real work on the
 * board with queue_order. An order is a note on the club's board: it never sends,
 * books or charges. Staff prepare the work and bring it back as a proposal the
 * director approves with Yes on the page, so this pack has no destructive tools.
 *
 * Only active on /proshop, so the rest of Ask Claude never pays for these tokens.
 */

const roster = STAFF.map((s) => `${s.id} = ${s.name} (${s.role}): ${s.jobs.join('; ')}. Never: ${s.rules.join('; ')}.`).join('\n');

const tools: ToolDef<ClubCtx>[] = [
  {
    schema: {
      name: 'queue_order',
      description:
        "Put one order on the club's Pro Shop board for one staff member. Use it once per staff member involved when the director asks for something to be DONE. It does not send, book or charge anything; the staff prepares it and brings it back for the director's yes.",
      input_schema: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: [...STAFF_IDS], description: 'Which staff member takes it.' },
          order: { type: 'string', description: 'The order in one clear sentence, in plain words.' },
        },
        required: ['agent', 'order'],
      },
    },
    run: async (input, ctx) => {
      const task = await addOrder(ctx, { agent: String(input?.agent ?? ''), text: String(input?.order ?? '') });
      return { ok: true, queued: true, agent: task.agent, id: task.id };
    },
  },
  {
    schema: {
      name: 'board_status',
      description: "Read the club's Pro Shop board: open orders, proposals waiting for the director, and the last few finished jobs with their notes.",
      input_schema: { type: 'object', properties: { agent: { type: 'string', description: 'Optional: only this staff member.' } } },
    },
    run: async (input, ctx) => {
      let q = ctx.db
        .from('proshop_tasks')
        .select('agent, text, status, note, money, created_at')
        .eq('club_id', ctx.clubId)
        .order('created_at', { ascending: false })
        .limit(40);
      if (input?.agent && STAFF_IDS.has(String(input.agent))) q = q.eq('agent', String(input.agent));
      const { data } = await q;
      const rows = (data as Record<string, any>[] | null) ?? [];
      return {
        ok: true,
        open: rows.filter((r) => ['waiting', 'approved', 'doing'].includes(r.status)).map((r) => ({ agent: r.agent, text: r.text, status: r.status })),
        needsYes: rows.filter((r) => r.status === 'proposed').map((r) => ({ agent: r.agent, text: r.text, money: r.money })),
        recentDone: rows.filter((r) => r.status === 'done').slice(0, 8).map((r) => ({ agent: r.agent, text: r.text, note: r.note })),
      };
    },
  },
];

export const proshopPack: DomainPack<ClubCtx> = {
  domain: 'proshop',
  actionsPrompt: `PRO SHOP STAFF. On /proshop you are the club's AI pro shop staff, working for the director.
If the page is "/proshop?staff=<id>", you ARE that staff member: speak in first person as them. Otherwise speak as whichever one staff member fits best and start your reply with their id in square brackets, like [ledger].
The staff:
${roster}
When the director asks you to DO something, call queue_order once per staff member involved, then say it's on the board and you'll bring it back for a yes before anything sends, books or charges. Never claim work is done. Answer questions from what you know or from board_status; if you don't know, say what you'd check and offer to put it on the board.
Reply in 1 to 3 short, friendly sentences.`,
  resolve: async (userId, page) => {
    if (!page || !page.startsWith('/proshop')) return null;
    return resolveClubCtx(userId);
  },
  tools,
};
