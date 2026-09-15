/**
 * PlayerVault CSV import — reading a spreadsheet by what its columns SAY.
 *
 * The import used to read columns by position (name, email, phone, gender,
 * age, ntrp, utr, sport, notes), which only works for a file someone built
 * from our template. The files clubs actually have are exports: Wild Apricot's
 * contact export starts "User ID, First name, Last name, Organization, e-Mail…",
 * TopDog's and every other system's differ again, and a positional read of
 * any of them puts a User ID in the name column and a surname in email.
 *
 * So headers are matched by name first, with a mapping the director can
 * correct before anything is written. A file with no recognisable header row
 * still reads positionally, so every CSV made from the old template keeps
 * working unchanged.
 *
 * Pure: parsing, mapping, row building and the dedupe plan. The page does the
 * I/O. Tested in csvImport.test.ts against a Wild Apricot-shaped fixture.
 */

/* ------------------------------------------------------------------ fields */

export const IMPORT_FIELDS = [
  'full_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'gender',
  'age',
  'date_of_birth',
  'usta_rating',
  'utr_rating',
  'primary_sport',
  'membership_level',
  'membership_status',
  'member_since',
  'notes',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = (ImportField | null)[];

export const FIELD_LABEL: Record<ImportField, string> = {
  full_name: 'Full name',
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  phone: 'Phone',
  gender: 'Gender',
  age: 'Age',
  date_of_birth: 'Date of birth',
  usta_rating: 'NTRP',
  utr_rating: 'UTR',
  primary_sport: 'Sport',
  membership_level: 'Membership level',
  membership_status: 'Membership status',
  member_since: 'Member since',
  notes: 'Notes',
};

/** The old template's order — what a header-less file is read as. */
export const POSITIONAL_FIELDS: ImportField[] = [
  'full_name',
  'email',
  'phone',
  'gender',
  'age',
  'usta_rating',
  'utr_rating',
  'primary_sport',
  'notes',
];

/**
 * Header spellings, compared after lowercasing and stripping everything but
 * letters and digits — so "e-Mail", "E-mail address" and "EMAIL" all reduce to
 * the same key. First match wins, and each field is claimed by one column only.
 */
const ALIASES: Record<ImportField, string[]> = {
  full_name: ['name', 'fullname', 'playername', 'membername', 'contactname', 'displayname', 'participantname'],
  first_name: ['firstname', 'first', 'givenname', 'fname', 'playerfirstname'],
  last_name: ['lastname', 'last', 'surname', 'familyname', 'lname', 'playerlastname'],
  email: ['email', 'emailaddress', 'mail', 'primaryemail', 'playeremail', 'contactemail'],
  phone: [
    'phone', 'mobilephone', 'cellphone', 'mobile', 'cell', 'phonenumber', 'homephone',
    'workphone', 'primaryphone', 'telephone', 'mobilenumber', 'cellnumber',
  ],
  gender: ['gender', 'sex'],
  age: ['age'],
  date_of_birth: ['dateofbirth', 'dob', 'birthdate', 'birthday', 'birthdateddmmyyyy'],
  usta_rating: ['ntrp', 'ntrprating', 'ustarating', 'usta', 'rating', 'level', 'ntrplevel'],
  utr_rating: ['utr', 'utrrating', 'utrsingles'],
  primary_sport: ['sport', 'primarysport'],
  membership_level: ['membershiplevel', 'membershiptype', 'membertype', 'membershipplan', 'plan'],
  membership_status: ['membershipstatus', 'memberstatus', 'status'],
  member_since: ['membersince', 'joindate', 'joined', 'datejoined', 'memberdate'],
  notes: ['notes', 'note', 'comments', 'comment'],
};

const key = (h: string) => (h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* --------------------------------------------------------------------- csv */

/** RFC-4180-ish: quoted fields, doubled quotes, CRLF or LF, a BOM from Excel. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(current.trim());
      current = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(current.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = '';
      if (ch === '\r' && src[i + 1] === '\n') i++;
    } else {
      current += ch;
    }
  }
  row.push(current.trim());
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

/* ----------------------------------------------------------------- mapping */

export type DetectedMapping = {
  /** One entry per column: the field it feeds, or null to ignore it. */
  mapping: ColumnMapping;
  /** False when row 1 is data (the old positional template, no header row). */
  hasHeader: boolean;
  /** A name for the source, when the headers give it away. */
  source: 'wildapricot' | 'template' | 'generic' | 'positional';
};

/** Map one header to a field, or null. */
export function fieldForHeader(header: string): ImportField | null {
  const k = key(header);
  if (!k) return null;
  for (const field of IMPORT_FIELDS) {
    if (ALIASES[field].includes(k)) return field;
  }
  return null;
}

/**
 * Decide how to read a file from its first row.
 *
 * A first row counts as a header when at least one cell is a known header AND
 * nothing in it looks like an email address — a data row from the old
 * template has an email in column two, a header row never does.
 */
export function detectMapping(firstRow: string[]): DetectedMapping {
  const looksLikeData = firstRow.some((c) => /@/.test(c));
  const guesses = firstRow.map(fieldForHeader);
  const recognised = guesses.filter(Boolean).length;

  if (looksLikeData || recognised === 0) {
    return {
      mapping: firstRow.map((_, i) => POSITIONAL_FIELDS[i] ?? null),
      hasHeader: false,
      source: 'positional',
    };
  }

  // Each field claimed once: a Wild Apricot export can carry "Phone" AND
  // "Mobile phone", and the first one is the one to use.
  const claimed = new Set<ImportField>();
  const mapping = guesses.map((f) => {
    if (!f || claimed.has(f)) return null;
    claimed.add(f);
    return f;
  });

  const keys = firstRow.map(key);
  const source: DetectedMapping['source'] =
    keys.includes('userid') || (keys.includes('membershiplevel') && keys.includes('email'))
      ? 'wildapricot'
      : keys.join(',') === 'name,email,phone,gender,age,ntrp,utr,sport,notes'
        ? 'template'
        : 'generic';

  return { mapping, hasHeader: true, source };
}

/* -------------------------------------------------------------------- rows */

const GENDER_MAP: Record<string, string> = {
  m: 'male', male: 'male', man: 'male', men: 'male',
  f: 'female', female: 'female', woman: 'female', women: 'female',
  nb: 'non_binary', 'non-binary': 'non_binary', nonbinary: 'non_binary', non_binary: 'non_binary',
};

const SPORT_MAP: Record<string, string> = {
  tennis: 'tennis', t: 'tennis',
  pickleball: 'pickleball', pb: 'pickleball', pickle: 'pickleball',
  padel: 'padel',
  squash: 'squash',
  badminton: 'badminton',
  racquetball: 'racquetball',
  'table tennis': 'table_tennis', table_tennis: 'table_tennis', tt: 'table_tennis', 'ping pong': 'table_tennis',
};

/**
 * A membership status from any system, as cc_vault_players can hold it
 * ('active' | 'inactive' | 'guest'), or null when it does not say. Wild
 * Apricot's are Active, Lapsed, Suspended, "Pending - New" and
 * "Pending - Renewal". A pending renewal is still a member; a pending NEW
 * application is not one yet.
 */
export function normalizeMembershipStatus(raw: string): 'active' | 'inactive' | 'guest' | null {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return null;
  if (/renewal/.test(v)) return 'active';
  if (/^(active|current|paid|member|yes)\b/.test(v)) return 'active';
  if (/(lapsed|expired|suspended|inactive|archived|cancel|terminated|former|no\b)/.test(v)) return 'inactive';
  if (/(pending|new|guest|trial|prospect)/.test(v)) return 'guest';
  return null;
}

/** YYYY-MM-DD from "1961-04-12", "4/12/1961" or "12 Apr 1961"; else null. */
export function normalizeDate(raw: string): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v); // US month/day/year
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type ImportedPlayer = {
  full_name: string;
  email: string;
  phone: string;
  gender: string;
  age: string;
  date_of_birth: string;
  usta_rating: string;
  utr_rating: string;
  primary_sport: string;
  membership_status: 'active' | 'inactive' | 'guest' | null;
  notes: string;
  valid: boolean;
  error?: string;
};

/**
 * One spreadsheet row, through the mapping, into a vault player.
 *
 * cc_vault_players has membership_status but no level or join date, so those
 * are written into notes rather than lost — "Membership: Senior Singles
 * (Lapsed) · Member since 2019-03-01" is what a director wants to see on the
 * card. A status the column cannot hold goes the same way.
 */
export function buildPlayer(cells: string[], mapping: ColumnMapping): ImportedPlayer {
  const get = (field: ImportField) => {
    const i = mapping.indexOf(field);
    return i >= 0 ? (cells[i] ?? '').trim() : '';
  };

  const first = get('first_name');
  const last = get('last_name');
  const full = get('full_name') || [first, last].filter(Boolean).join(' ');

  const level = get('membership_level');
  const statusRaw = get('membership_status');
  const status = normalizeMembershipStatus(statusRaw);
  const since = get('member_since');

  const memberBits: string[] = [];
  if (level || statusRaw) {
    memberBits.push(`Membership: ${[level, statusRaw ? `(${statusRaw})` : ''].filter(Boolean).join(' ')}`);
  }
  if (since) memberBits.push(`Member since ${normalizeDate(since) ?? since}`);
  const notes = [get('notes'), memberBits.join(' · ')].filter(Boolean).join('\n');

  const player: ImportedPlayer = {
    full_name: full.replace(/\s+/g, ' ').trim(),
    email: get('email').toLowerCase(),
    phone: get('phone'),
    gender: GENDER_MAP[get('gender').toLowerCase()] || '',
    age: get('age').replace(/[^0-9]/g, ''),
    date_of_birth: normalizeDate(get('date_of_birth')) ?? '',
    usta_rating: get('usta_rating'),
    utr_rating: get('utr_rating'),
    primary_sport: SPORT_MAP[get('primary_sport').toLowerCase()] || 'tennis',
    membership_status: status,
    notes,
    valid: true,
  };

  if (!player.full_name) {
    player.valid = false;
    player.error = 'Name is required';
  }
  if (player.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(player.email)) {
    player.valid = false;
    player.error = `Not an email address: ${player.email}`;
  }
  const ntrp = parseFloat(player.usta_rating);
  if (player.usta_rating && (Number.isNaN(ntrp) || ntrp < 1 || ntrp > 7)) {
    player.valid = false;
    player.error = `Invalid NTRP: ${player.usta_rating}`;
  }
  const utr = parseFloat(player.utr_rating);
  if (player.utr_rating && (Number.isNaN(utr) || utr < 1 || utr > 16.5)) {
    player.valid = false;
    player.error = `Invalid UTR: ${player.utr_rating}`;
  }
  return player;
}

/** The whole file through a mapping. */
export function buildPlayers(rows: string[][], mapping: ColumnMapping, hasHeader: boolean): ImportedPlayer[] {
  return (hasHeader ? rows.slice(1) : rows).map((r) => buildPlayer(r, mapping));
}

/* -------------------------------------------------------------------- plan */

export type ImportPlan = {
  inserts: ImportedPlayer[];
  /** Existing vault rows matched by email, with the player to merge in. */
  updates: { id: string; player: ImportedPlayer }[];
  skippedNoEmail: ImportedPlayer[];
  skippedDuplicateInFile: ImportedPlayer[];
  skippedInvalid: ImportedPlayer[];
};

/**
 * What an import will do, before it does it.
 *
 * Email is the identity. A player already in this director's vault with the
 * same email is UPDATED, not duplicated — importing next month's Wild Apricot
 * export again must not double the vault. A row with no email cannot be
 * checked for a duplicate, so it is skipped unless the director opts in; the
 * same email twice in one file keeps the first.
 */
export function planImport(
  players: ImportedPlayer[],
  existingByEmail: Map<string, string>,
  opts: { includeNoEmail?: boolean } = {},
): ImportPlan {
  const plan: ImportPlan = {
    inserts: [],
    updates: [],
    skippedNoEmail: [],
    skippedDuplicateInFile: [],
    skippedInvalid: [],
  };
  const seen = new Set<string>();
  for (const p of players) {
    if (!p.valid) {
      plan.skippedInvalid.push(p);
      continue;
    }
    if (!p.email) {
      if (opts.includeNoEmail) plan.inserts.push(p);
      else plan.skippedNoEmail.push(p);
      continue;
    }
    if (seen.has(p.email)) {
      plan.skippedDuplicateInFile.push(p);
      continue;
    }
    seen.add(p.email);
    const id = existingByEmail.get(p.email);
    if (id) plan.updates.push({ id, player: p });
    else plan.inserts.push(p);
  }
  return plan;
}

/** "42 new, 3 updated, 2 skipped: no email" — only the parts that happened. */
export function summarizePlan(plan: ImportPlan): string {
  const parts: string[] = [`${plan.inserts.length} new`, `${plan.updates.length} updated`];
  if (plan.skippedNoEmail.length) parts.push(`${plan.skippedNoEmail.length} skipped: no email`);
  if (plan.skippedDuplicateInFile.length) {
    parts.push(`${plan.skippedDuplicateInFile.length} skipped: email repeated in the file`);
  }
  if (plan.skippedInvalid.length) parts.push(`${plan.skippedInvalid.length} skipped: needs fixing`);
  return parts.join(', ');
}

/**
 * The columns written for a player.
 *
 * On an UPDATE, blank cells are left out rather than written as null, so a
 * sparse export (Wild Apricot has no ratings) never erases the NTRP a director
 * typed in by hand. Notes are appended by the caller, not replaced.
 */
export function vaultColumns(p: ImportedPlayer, mode: 'insert' | 'update'): Record<string, unknown> {
  const cols: Record<string, unknown> = {
    full_name: p.full_name,
    email: p.email || null,
    phone: p.phone || null,
    gender: p.gender || null,
    age: p.age ? parseInt(p.age, 10) : null,
    date_of_birth: p.date_of_birth || null,
    usta_rating: p.usta_rating ? parseFloat(p.usta_rating) : null,
    utr_rating: p.utr_rating ? parseFloat(p.utr_rating) : null,
    primary_sport: p.primary_sport || 'tennis',
    membership_status: p.membership_status,
    notes: p.notes || null,
  };
  if (mode === 'insert') {
    if (cols.membership_status == null) delete cols.membership_status; // column default
    return { ...cols, rating_source: 'manual' };
  }
  for (const k of Object.keys(cols)) {
    if (cols[k] === null || cols[k] === '') delete cols[k];
  }
  // The sport defaults to tennis when blank; on an update that default must
  // not overwrite a pickleball player.
  if (!p.primary_sport || p.primary_sport === 'tennis') delete cols.primary_sport;
  delete cols.notes;
  return cols;
}
