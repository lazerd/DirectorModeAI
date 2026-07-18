import type Anthropic from '@anthropic-ai/sdk';

// Domain-pack framework for the "Ask ClubMode" assistant.
//
// The chat route (src/app/api/assistant/chat/route.ts) is domain-agnostic: it
// handles auth, rate limiting, the Claude tool-use loop, and billing. Everything
// the assistant can actually DO on a given page comes from "domain packs" — one
// per area of the app (JTT, Benchmarks, CourtSheet, …). A pack declares its
// tools, how to resolve its per-request context (and whether it's available at
// all for this user/page), and how to execute each tool.
//
// Destructive tools (things that delete, send, or charge) are gated: they do NOT
// mutate until called a second time with confirm:true. The first call returns a
// preview of exactly what would happen, which the model relays to the user for
// approval. This enforces "preview → confirm" in code rather than trusting the
// model to remember to ask.

export type ToolResult = { ok: boolean } & Record<string, unknown>;

export interface ToolDef<Ctx> {
  schema: Anthropic.Messages.Tool;
  /** Marks a tool that changes/sends/charges. Gated behind confirm:true. */
  destructive?: boolean;
  /** Perform the action. For destructive tools this runs only after confirm. */
  run: (input: any, ctx: Ctx) => Promise<ToolResult>;
  /**
   * Describe what run() would do WITHOUT mutating. Used for the confirm preview.
   * Should include concrete specifics (names, counts) so the user can approve
   * knowingly. Only consulted for destructive tools; optional otherwise.
   */
  preview?: (input: any, ctx: Ctx) => Promise<ToolResult>;
}

export interface DomainPack<Ctx> {
  /** Stable id, e.g. 'jtt', 'benchmarks'. */
  domain: string;
  /** System guidance appended to the prompt whenever this pack is active. */
  actionsPrompt: string;
  /** Resolve per-request context, or null if this pack is unavailable here. */
  resolve: (userId: string, page: string | undefined) => Promise<Ctx | null>;
  tools: ToolDef<Ctx>[];
}

/** A pack bound to a resolved context: ready-to-send schemas + one executor. */
export interface BoundPack {
  domain: string;
  actionsPrompt: string;
  toolSchemas: Anthropic.Messages.Tool[];
  execute: (name: string, input: any) => Promise<ToolResult>;
}

// Injected into every destructive tool's schema so the model can move from
// preview to commit without the pack author repeating this on each tool.
const CONFIRM_PROP: Record<string, unknown> = {
  confirm: {
    type: 'boolean',
    description:
      'Set true ONLY after the user has explicitly approved this exact action. ' +
      'Omit or set false to preview what would happen without making any change.',
  },
};

/**
 * Bind a pack to a resolved context. Exposes the pack's tool schemas (with a
 * `confirm` flag added to destructive ones) and a single execute() that enforces
 * the preview → confirm protocol.
 */
export function bindPack<Ctx>(pack: DomainPack<Ctx>, ctx: Ctx): BoundPack {
  const byName = new Map(pack.tools.map((t) => [t.schema.name, t]));

  const toolSchemas: Anthropic.Messages.Tool[] = pack.tools.map((t) => {
    if (!t.destructive) return t.schema;
    const existing = (t.schema.input_schema.properties as Record<string, unknown> | null) ?? {};
    return {
      ...t.schema,
      input_schema: {
        ...t.schema.input_schema,
        properties: { ...existing, ...CONFIRM_PROP },
      },
    };
  });

  return {
    domain: pack.domain,
    actionsPrompt: pack.actionsPrompt,
    toolSchemas,
    execute: async (name, input) => {
      const t = byName.get(name);
      if (!t) return { ok: false, error: `Unknown tool ${name}` };
      if (t.destructive && input?.confirm !== true) {
        const preview = t.preview ? await t.preview(input, ctx) : { ok: true as const };
        return { ...preview, ok: true, needsConfirm: true };
      }
      return t.run(input, ctx);
    },
  };
}
