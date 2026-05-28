/**
 * CourtSheet AI — Anthropic tool-use schemas.
 *
 * One schema per tool the agent can call. Kept compact: the model emits
 * structured intents, the backend expands recurrence + detects conflicts
 * + computes the Plan. The model never iterates dates, never asserts
 * availability — the planner owns that.
 */

import type Anthropic from '@anthropic-ai/sdk';

type ToolSchema = Anthropic.Messages.Tool;

export const TOOLS: ToolSchema[] = [
  {
    name: 'get_context',
    description:
      'Get the club\'s courts, operating hours, timezone, today\'s date, ' +
      'and a summary of upcoming reservations in the relevant window. ' +
      'Call this FIRST in any new conversation, before any other tool, so ' +
      'you know what "courts 1-6", "next Monday", and "tomorrow" mean.',
    input_schema: {
      type: 'object',
      properties: {
        /** Optional window for the booking summary. */
        date_range_hint: {
          type: 'object',
          description:
            'Optional window to summarize bookings within. Use this when ' +
            'the user mentioned a date range so the context covers it.',
          properties: {
            start: { type: 'string', description: 'YYYY-MM-DD club-local' },
            end: { type: 'string', description: 'YYYY-MM-DD club-local' },
          },
        },
      },
    },
  },

  {
    name: 'query_availability',
    description:
      'Find open court time. Use for "what\'s open on court 4 tomorrow?", ' +
      '"any free Tuesday morning?", etc. Returns slots — never writes.',
    input_schema: {
      type: 'object',
      required: ['date_range'],
      properties: {
        date_range: {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: { type: 'string', description: 'YYYY-MM-DD club-local' },
            end: { type: 'string', description: 'YYYY-MM-DD club-local' },
          },
        },
        courts: {
          type: 'array',
          description: 'Court numbers or names. Omit for all courts.',
          items: { type: ['string', 'number'] },
        },
        days_of_week: {
          type: 'array',
          description: '0=Sunday..6=Saturday. Empty/omit = every day in range.',
          items: { type: 'integer', minimum: 0, maximum: 6 },
        },
        time_range: {
          type: 'object',
          description: 'HH:MM club-local. Omit to search the full operating window.',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
        },
        sport: { type: 'string' },
        min_minutes: { type: 'integer', minimum: 5, default: 30 },
      },
    },
  },

  {
    name: 'book',
    description:
      'Create reservations. Returns a Plan (preview) — does NOT write. ' +
      'For recurring bookings, return the compact recurrence (date_range + ' +
      'days_of_week + time_range); the backend will enumerate the concrete ' +
      'instances. Do NOT list every date yourself.',
    input_schema: {
      type: 'object',
      required: ['courts', 'date_range', 'time_range', 'type', 'title'],
      properties: {
        courts: {
          type: 'array',
          description: 'Court numbers or names from get_context. Required.',
          items: { type: ['string', 'number'] },
          minItems: 1,
        },
        date_range: {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: { type: 'string', description: 'YYYY-MM-DD club-local' },
            end: { type: 'string', description: 'YYYY-MM-DD club-local. Same as start for single-day.' },
          },
        },
        days_of_week: {
          type: 'array',
          description: '0=Sun..6=Sat. Empty/omit = every day in range.',
          items: { type: 'integer', minimum: 0, maximum: 6 },
        },
        time_range: {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: { type: 'string', description: 'HH:MM club-local' },
            end: { type: 'string', description: 'HH:MM club-local' },
          },
        },
        exclusions: {
          type: 'array',
          description: 'YYYY-MM-DD dates to skip (holidays, exceptions).',
          items: { type: 'string' },
        },
        type: {
          type: 'string',
          enum: ['camp', 'lesson', 'event', 'match', 'member', 'maintenance', 'blackout', 'hold'],
        },
        title: {
          type: 'string',
          description: 'Short label that appears on the block. e.g. "Summer Camp".',
        },
        signups: {
          type: 'object',
          description:
            'Optionally open these reservations for player signups (clinic / ' +
            'doubles "need 2 more" / social).',
          properties: {
            open: { type: 'boolean' },
            capacity: { type: 'integer', minimum: 1 },
            pitch: { type: 'string', description: 'One-line cue shown to signups.' },
          },
        },
      },
    },
  },

  {
    name: 'move',
    description:
      'Move existing reservations to a new court/date/time. Returns a Plan.',
    input_schema: {
      type: 'object',
      required: ['selector', 'target'],
      properties: {
        selector: { $ref: '#/definitions/Selector' as any },
        target: {
          type: 'object',
          properties: {
            courts: {
              type: 'array',
              items: { type: ['string', 'number'] },
            },
            date: { type: 'string', description: 'YYYY-MM-DD club-local' },
            time_start: { type: 'string', description: 'HH:MM' },
            time_end: { type: 'string', description: 'HH:MM' },
          },
        },
      },
    },
  },

  {
    name: 'cancel',
    description:
      'Cancel reservations matching the selector. Returns a Plan. ' +
      'scope=instance for one row, future for "this and following", ' +
      'series for the whole series, range for "all Friday camps in July".',
    input_schema: {
      type: 'object',
      required: ['selector', 'scope'],
      properties: {
        selector: { $ref: '#/definitions/Selector' as any },
        scope: {
          type: 'string',
          enum: ['instance', 'future', 'series', 'range'],
        },
      },
    },
  },

  {
    name: 'modify',
    description: 'Edit fields on existing reservations (title, color, signup config).',
    input_schema: {
      type: 'object',
      required: ['selector', 'changes'],
      properties: {
        selector: { $ref: '#/definitions/Selector' as any },
        changes: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            color: { type: 'string' },
            signups_open: { type: 'boolean' },
            signups_capacity: { type: 'integer', minimum: 1 },
            signups_pitch: { type: 'string' },
          },
        },
      },
    },
  },

  {
    name: 'block_courts',
    description:
      'Take courts off the sheet for maintenance or closure. Same shape ' +
      'as book(type="maintenance" or "blackout") but with a reason.',
    input_schema: {
      type: 'object',
      required: ['courts', 'date_range', 'reason'],
      properties: {
        courts: { type: 'array', items: { type: ['string', 'number'] }, minItems: 1 },
        date_range: {
          type: 'object',
          required: ['start', 'end'],
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
        },
        time_range: {
          type: 'object',
          properties: { start: { type: 'string' }, end: { type: 'string' } },
        },
        reason: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['maintenance', 'blackout'],
          description: 'maintenance = under repair; blackout = closed entirely.',
        },
      },
    },
  },
];

/**
 * Selector $ref expansion — Anthropic doesn't honor JSON Schema $ref
 * server-side, so we inline before sending. This pass walks the tool
 * list and replaces { $ref: '#/definitions/Selector' } with the actual
 * shape.
 */
export function tools(): ToolSchema[] {
  const SELECTOR = {
    type: 'object',
    description:
      'Describes WHICH reservations to act on. Use court+date+time hints ' +
      'when the user spoke about them, or title_match for "the 9 AM clinic". ' +
      'Omit fields you do not know.',
    properties: {
      courts: { type: 'array', items: { type: ['string', 'number'] } },
      date_range: {
        type: 'object',
        properties: {
          start: { type: 'string' },
          end: { type: 'string' },
        },
      },
      days_of_week: {
        type: 'array',
        items: { type: 'integer', minimum: 0, maximum: 6 },
      },
      time_range: {
        type: 'object',
        properties: {
          start: { type: 'string' },
          end: { type: 'string' },
        },
      },
      type: {
        type: 'string',
        enum: ['camp', 'lesson', 'event', 'match', 'member', 'maintenance', 'blackout', 'hold'],
      },
      title_match: {
        type: 'string',
        description: 'Case-insensitive substring of the reservation title.',
      },
      reservation_id: { type: 'string' },
    },
  };

  return TOOLS.map((t) => ({
    ...t,
    input_schema: replaceSelectorRef(t.input_schema, SELECTOR),
  }));
}

function replaceSelectorRef(schema: unknown, selector: unknown): any {
  if (Array.isArray(schema)) return schema.map((x) => replaceSelectorRef(x, selector));
  if (!schema || typeof schema !== 'object') return schema;
  const obj = schema as Record<string, unknown>;
  if (obj.$ref === '#/definitions/Selector') return selector;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = replaceSelectorRef(v, selector);
  return out;
}
