/**
 * The ask box's tools: their shapes, and who may run them.
 *
 * Three things are being held down here.
 *
 *   1. EVERY TOOL REFUSES A NON-CRM USER. The db handed in throws on any use
 *      at all, so a tool that got as far as a query fails the test loudly
 *      rather than quietly returning rows to a stranger.
 *   2. NO ACTION TOOL WRITES. Each one is run with a context whose db throws
 *      on insert/update/delete; the reads they need to resolve a club are
 *      allowed. A tool that tried to write would throw.
 *   3. NOTHING CAN REACH A cc_ TABLE. crmTable() is the only door, and it
 *      refuses any name that is not a crm_ table. The source is also read and
 *      checked, because a raw db.from('cc_clubs') would bypass the helper.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRM_TABLES,
  CRM_TOOLS,
  CRM_TOOL_SCHEMAS,
  PROPOSAL_ACTIONS,
  crmTable,
  proposalOf,
  runCrmTool,
  type CrmAskContext,
} from './tools';
import { applyProposal, isProposal, type ApplyContext } from './apply';

// ------------------------------------------------------------------ doubles

/** A database that screams if anybody touches it. */
function hostileDb() {
  return {
    from() {
      throw new Error('a tool reached the database for a user who is not a CRM rep');
    },
  } as never;
}

/**
 * A database that answers reads with nothing and refuses writes.
 *
 * Every PostgREST builder method returns `this`, and awaiting it yields
 * `{ data: [], error: null }` — enough for a tool to run its query and find
 * no club, which is the path we want to reach without a real database.
 */
function readOnlyDb(rows: unknown[] = []) {
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve({ data: rows, error: null, count: rows.length });
      }
      if (prop === 'insert' || prop === 'update' || prop === 'delete' || prop === 'upsert') {
        return () => {
          throw new Error(`an action tool tried to ${prop} — tools must only propose`);
        };
      }
      return () => chain;
    },
  });
  return { from: () => chain } as never;
}

function ctx(over: Partial<CrmAskContext> = {}): CrmAskContext {
  return {
    allowed: true,
    db: readOnlyDb(),
    repEmail: 'darrinjco@gmail.com',
    repName: 'Darrin Cohen',
    today: '2026-09-16',
    orgId: null,
    ...over,
  };
}

// -------------------------------------------------------------------- tests

describe('tool schemas', () => {
  it('every tool has a usable Anthropic schema', () => {
    expect(CRM_TOOLS.length).toBeGreaterThan(0);
    for (const t of CRM_TOOLS) {
      expect(t.schema.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.schema.description && t.schema.description.length).toBeGreaterThan(30);
      expect(t.schema.input_schema.type).toBe('object');
      expect(typeof t.schema.input_schema.properties).toBe('object');
      expect(t.kind === 'read' || t.kind === 'action').toBe(true);
    }
  });

  it('names are unique — two tools with one name is a silently dead tool', () => {
    const names = CRM_TOOLS.map((t) => t.schema.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('exports the schemas the route sends, and only those', () => {
    expect(CRM_TOOL_SCHEMAS.map((s) => s.name)).toEqual(CRM_TOOLS.map((t) => t.schema.name));
  });

  it('every action tool is named propose_*, so the model cannot mistake one for a read', () => {
    for (const t of CRM_TOOLS) {
      if (t.kind === 'action') expect(t.schema.name.startsWith('propose_')).toBe(true);
      else expect(t.schema.name.startsWith('propose_')).toBe(false);
    }
  });

  it('covers every action the confirm route knows how to apply', () => {
    // A proposal shape with no tool to produce it, or a tool producing an
    // action apply.ts has never heard of, is a dead end either way.
    expect(CRM_TOOLS.filter((t) => t.kind === 'action').length).toBe(PROPOSAL_ACTIONS.length);
  });

  it('required fields are all declared properties', () => {
    for (const t of CRM_TOOLS) {
      const props = Object.keys(t.schema.input_schema.properties ?? {});
      for (const r of (t.schema.input_schema as { required?: string[] }).required ?? []) {
        expect(props).toContain(r);
      }
    }
  });
});

describe('a user who is not a CRM rep', () => {
  it('is refused by every tool, before any query runs', async () => {
    for (const t of CRM_TOOLS) {
      const r = await runCrmTool(t.schema.name, { club: 'Rossmoor', stage: 'contacted', clubs: ['x'] }, ctx({ allowed: false, db: hostileDb() }));
      expect(r.ok, `${t.schema.name} answered a non-CRM user`).toBe(false);
      // The same nothing the rest of the CRM gives a stranger. Not "forbidden",
      // which would confirm there is a pipeline to go looking for.
      expect((r as { error: string }).error).toBe('Not found.');
    }
  });

  it('is refused for a context that is missing entirely', async () => {
    const r = await runCrmTool('search_clubs', {}, undefined as unknown as CrmAskContext);
    expect(r.ok).toBe(false);
  });

  it('cannot apply a proposal either', async () => {
    const denied: ApplyContext = {
      allowed: false,
      db: hostileDb(),
      repEmail: 'someone@example.com',
      repName: 'Someone',
      today: '2026-09-16',
      orgId: null,
    };
    const r = await applyProposal(
      { action: 'set_stage', title: 'x', detail: [], args: { org_id: '11111111-1111-1111-1111-111111111111', stage: 'won' } },
      denied,
    );
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toBe('Not found.');
  });
});

describe('a real rep', () => {
  it('gets a tool-not-found rather than a crash for an unknown name', async () => {
    const r = await runCrmTool('delete_everything', {}, ctx());
    expect(r.ok).toBe(false);
  });

  it('never gets a write out of an action tool — only a proposal or a refusal', async () => {
    // readOnlyDb throws on insert/update/delete, and returns no rows for
    // reads, so each of these lands on "I could not find that club".
    for (const t of CRM_TOOLS.filter((x) => x.kind === 'action')) {
      const r = await runCrmTool(
        t.schema.name,
        { club: 'Rossmoor', person: 'Mary', stage: 'contacted', next_step: 'call', body: 'hi', full_name: 'Mary Benin', clubs: ['Rossmoor'], subject: 's', body_text: 'b' },
        ctx(),
      );
      // Either a refusal, or a proposal — never a bare success that implies
      // something happened.
      if (r.ok) expect(proposalOf(r)).not.toBeNull();
      else expect(typeof (r as { error: string }).error).toBe('string');
    }
  });

  it('proposes a stage change and writes nothing doing it', async () => {
    // A database that finds the club and throws on any write. Getting a
    // proposal back out of this is the proof: the tool resolved a real row,
    // built the change, and did not apply it.
    const db = readOnlyDb([
      { id: '11111111-1111-1111-1111-111111111111', name: 'Rossmoor Tennis Club', stage: 'researching', region: 'West', state: 'CA', notes: null, next_step: null, next_step_at: null, owner_email: null, source: null, demo_url: null, queued_at: null, website: null },
    ]);
    const r = await runCrmTool('propose_stage', { club: 'Rossmoor Tennis Club', stage: 'contacted' }, ctx({ db }));
    expect(r.ok).toBe(true);
    const p = proposalOf(r);
    expect(p?.action).toBe('set_stage');
    expect(p?.title).toBe('Move Rossmoor Tennis Club to Contacted');
    expect(p?.args).toEqual({ org_id: '11111111-1111-1111-1111-111111111111', stage: 'contacted' });
    // And the result says so out loud, for the model's benefit.
    expect(String((r as { note?: string }).note)).toContain('Nothing has changed');
  });

  it('refuses a stage that is not a stage', async () => {
    const r = await runCrmTool('propose_stage', { club: 'Rossmoor', stage: 'nearly_sold' }, ctx());
    expect(r.ok).toBe(false);
  });

  it('survives a tool that throws, and says so instead of 500ing the route', async () => {
    const r = await runCrmTool('search_clubs', {}, ctx({ db: hostileDb() }));
    expect(r.ok).toBe(false);
  });
});

describe('the data this assistant can reach', () => {
  it('crmTable accepts every crm_ table and nothing else', () => {
    const db = readOnlyDb();
    for (const t of CRM_TABLES) expect(() => crmTable(db, t)).not.toThrow();
    for (const forbidden of ['cc_clubs', 'cc_club_members', 'players', 'lessons', 'reservations']) {
      expect(() => crmTable(db, forbidden as never)).toThrow();
    }
  });

  it('CRM_TABLES is all crm_ and contains no club table', () => {
    for (const t of CRM_TABLES) expect(t.startsWith('crm_')).toBe(true);
  });

  it('no source file in the pack names a non-CRM table', () => {
    // crmTable() is the door, but a raw db.from('cc_clubs') would walk past
    // it. Read the files and check.
    const dir = path.join(process.cwd(), 'src/lib/crm/ask');
    for (const file of ['tools.ts', 'apply.ts', 'prompt.ts']) {
      const src = readFileSync(path.join(dir, file), 'utf8');
      // Any table name in a .from() call, however it is reached.
      for (const m of src.matchAll(/\.from\(\s*['"]([a-z_]+)['"]/g)) {
        expect(CRM_TABLES).toContain(m[1] as never);
      }
      // And no mention of the club-data prefix at all, in code or in prose
      // that the model might take as a hint that such a table exists.
      expect(/['"]cc_[a-z_]+['"]/.test(src)).toBe(false);
    }
  });
});

describe('isProposal', () => {
  it('accepts a real proposal', () => {
    expect(isProposal({ action: 'add_note', title: 't', detail: [], args: { org_id: 'x', body: 'y' } })).toBe(true);
  });

  it('rejects anything else a browser could post', () => {
    expect(isProposal(null)).toBe(false);
    expect(isProposal({})).toBe(false);
    expect(isProposal('set_stage')).toBe(false);
    expect(isProposal({ action: 'drop_table', args: {} })).toBe(false);
    expect(isProposal({ action: 'add_note' })).toBe(false);
  });
});
