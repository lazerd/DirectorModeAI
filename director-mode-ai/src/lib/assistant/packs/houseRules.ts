import type { DomainPack, ToolDef } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import { STAFF } from '@/lib/proshop/staff';
import { CLUB_WIDE, RULE_AGENTS, addHouseRule, loadHouseRules, normalizeRule, removeHouseRule } from '@/lib/proshop/houseRules';

/*
 * Teach the staff (Darrin 11/26/26). "Remember: Red Ball is Alex's class" by text or chat
 * becomes a house rule every later answer follows. Saving is previewed first like any change.
 * The rules themselves ride in the system prompt (runChat), so this pack is only the editor.
 */

const agentEnum = [...RULE_AGENTS];
const who = STAFF.map((s) => `${s.id} = ${s.name} (${s.role})`).join('; ');
const agentName = (id: string) => (id === CLUB_WIDE ? 'everyone' : STAFF.find((s) => s.id === id)?.name ?? id);

const tools: ToolDef<ClubCtx>[] = [
  {
    schema: {
      name: 'list_house_rules',
      description: "List the house rules the staff have been taught for this club, numbered per staff member (or for one staff member).",
      input_schema: { type: 'object', properties: { agent: { type: 'string', enum: agentEnum } } },
    },
    run: async (input, ctx) => {
      const all = await loadHouseRules(ctx.db, ctx.clubId);
      const ids = input?.agent ? [String(input.agent)] : Object.keys(all);
      return {
        ok: true,
        rules: ids.map((id) => ({ agent: id, name: agentName(id), rules: (all[id] ?? []).map((r, i) => `${i + 1}. ${r.text}`) })),
      };
    },
  },
  {
    destructive: true,
    schema: {
      name: 'remember_rule',
      description:
        "Save a house rule the director wants the staff to follow from now on (\"remember...\", \"from now on...\", \"never...\", \"always...\"). Write it as one short, plain rule in the director's meaning. Pick the one staff member it belongs to, or 'club' if it applies to everyone.",
      input_schema: {
        type: 'object',
        properties: {
          agent: { type: 'string', enum: agentEnum, description: `club = everyone; ${who}` },
          rule: { type: 'string', description: 'The rule, one sentence, under 300 characters.' },
        },
        required: ['agent', 'rule'],
      },
    },
    preview: async (input) => {
      const rule = normalizeRule(input?.rule);
      if (!rule) return { ok: false, error: 'What should they remember?' };
      if (!RULE_AGENTS.has(String(input?.agent))) return { ok: false, error: 'Which staff member is it for?' };
      return { ok: true, willSave: { for: agentName(String(input.agent)), rule } };
    },
    run: async (input, ctx) => {
      if (!MANAGER_ROLES.has(ctx.role)) return { ok: false, error: 'Only the club owner or a director can teach the staff.' };
      const rule = normalizeRule(input?.rule);
      const agent = String(input?.agent);
      if (!rule || !RULE_AGENTS.has(agent)) return { ok: false, error: 'That rule is missing a staff member or the rule itself.' };
      const r = await addHouseRule(ctx.db, ctx.clubId, agent, rule);
      return { ok: true, saved: r.added, alreadyKnown: !r.added, for: agentName(agent), rule };
    },
  },
  {
    destructive: true,
    schema: {
      name: 'forget_rule',
      description: 'Remove one house rule by its number from list_house_rules (call that first to get the number).',
      input_schema: {
        type: 'object',
        properties: { agent: { type: 'string', enum: agentEnum }, number: { type: 'integer', minimum: 1 } },
        required: ['agent', 'number'],
      },
    },
    preview: async (input, ctx) => {
      const all = await loadHouseRules(ctx.db, ctx.clubId);
      const r = all[String(input?.agent)]?.[Number(input?.number) - 1];
      return r ? { ok: true, willRemove: { for: agentName(String(input.agent)), rule: r.text } } : { ok: false, error: 'No rule with that number.' };
    },
    run: async (input, ctx) => {
      if (!MANAGER_ROLES.has(ctx.role)) return { ok: false, error: 'Only the club owner or a director can change house rules.' };
      const gone = await removeHouseRule(ctx.db, ctx.clubId, String(input?.agent), Number(input?.number) - 1);
      return gone ? { ok: true, removed: gone.text } : { ok: false, error: 'No rule with that number.' };
    },
  },
];

export const houseRulesPack: DomainPack<ClubCtx> = {
  domain: 'houserules',
  actionsPrompt: `HOUSE RULES EDITOR. When the director teaches the staff something lasting ("remember...", "from now on...", "never do X again", or a correction like "no, Red Ball is Alex's class"), offer to save it with remember_rule (preview, then their yes). A one-off instruction for today is not a house rule. Write the rule short and plain, in their meaning, not their exact words.`,
  resolve: async (userId) => resolveClubCtx(userId),
  tools,
};
