import type { DomainPack } from '../framework';
import {
  JTT_TOOLS, resolveJttContext, jttToolsAvailable, executeJttTool, type JttContext,
} from '../jttTools';

// JTT match-day pack — the first domain pack. Wraps the existing jttTools
// implementation (schemas, context resolver, executor) in the pack shape so the
// registry can compose it with other domains. Behavior is unchanged except that
// remove_player now flows through the framework's enforced preview → confirm
// gate instead of relying on the model to ask first.

const ACTIONS_PROMPT = `You can take real JTT match-day actions for THIS director's own league using your JTT tools: check players in/out for today's matches, add a new player to a roster, or remove one.

JTT specifics:
- When in doubt about names, clubs, or who's already checked in, call list_today first.
- "Clubs" are by short code (e.g. SH = Sleepy Hollow, MCC, OCC). Age groups are numbers (10, 12, 13).
- After a check-in/out or add, report what you did in one short line (e.g. "Checked in Brooke McGuire for MCC 13s.").`;

export const jttPack: DomainPack<JttContext> = {
  domain: 'jtt',
  actionsPrompt: ACTIONS_PROMPT,
  resolve: async (userId, page) => {
    const ctx = await resolveJttContext(userId, page);
    return jttToolsAvailable(ctx) ? ctx : null;
  },
  tools: JTT_TOOLS.map((schema) => ({
    schema,
    destructive: schema.name === 'remove_player',
    run: (input: any, ctx: JttContext) => executeJttTool(schema.name, input, ctx),
    preview:
      schema.name === 'remove_player'
        ? async (input: any) => ({
            ok: true,
            summary: `Remove ${input.player} from ${input.club} ${input.age}s, including today's check-in. This can't be undone.`,
          })
        : undefined,
  })),
};
