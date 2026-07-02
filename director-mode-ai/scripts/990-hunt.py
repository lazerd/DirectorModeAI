#!/usr/bin/env python3
"""Targeted IRS 990 hunt for specific club names missed by 990-ingest.mjs.

The main ingest only considers filers whose LEGAL name matches racquet/golf/
country-club patterns, so clubs with plain names ("Chevy Chase Club", "Piedmont
Driving Club") never become candidates even though they file 990s. This script
takes an explicit name list (directors-club-db hunt_targets.json), finds those
filers in the IRS index CSVs, range-reads their XML out of the batch zips
(handling Deflate64 natively via inflate64), and appends Part VII rows to the
same rows.jsonl that 990-merge.mjs consumes.

    python scripts/990-hunt.py            # scan + fetch + report
    python scripts/990-hunt.py --scan     # index scan only, print matches, no fetch

Run `node scripts/990-merge.mjs --dry` afterwards to preview the merge.
"""
import json
import os
import re
import struct
import sys
import urllib.request
import zlib
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import threading

import inflate64

CACHE = r'C:/Users/darri/AppData/Local/Temp/claude/C--Users-darri/c562ea4e-4206-4435-806d-e6804043334a/scratchpad/990cache'
ROWS = os.path.join(CACHE, 'rows.jsonl')
HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.join(HERE, '..', 'src', 'app', 'benchmarks', '_data', 'benchmarks.json')
BLOCKLIST = os.path.join(HERE, '990-blocklist.json')
TARGETS = r'C:/Users/darri/directors-club-db/exports/hunt_targets.json'
REPORT = r'C:/Users/darri/directors-club-db/exports/hunt_report.json'
YEARS = [2025, 2024, 2023]
UA = {'User-Agent': 'clubmode-benchmarks-ingest/1.0 (darrinjco@gmail.com)'}
SCAN_ONLY = '--scan' in sys.argv

# Same normalization as directors-club-db/crossmatch_benchmarks.py.
SUFFIXES = re.compile(r'\b(incorporated|inc|corp|corporation|company|co|ltd|llc|the|assn|association|of america)\b')
NOISE = re.compile(r'[^a-z0-9& ]')
EXCLUDE = re.compile(r'(FOUNDATION|SCHOLARSHIP|CHARITABLE|BOOSTER|ALUMNI|MEMORIAL FUND|ENDOWMENT|JUNIOR GOLF|JUNIOR TENNIS|YOUTH|PAC\b|POLITICAL|HOMEOWNER|PROPERTY OWNER|CONDOMINIUM|MASTER ASSOCIATION|HOA\b|EMPLOYEE|BENEFIT TRUST|WELFARE)')

# Index names verified by eye as NOT the club the DCA target refers to
# (universities, charities, theaters, same-prefix strangers). Compared with
# startswith against norm(index name).
DENY_NAMES = (
    'belmont university', 'queens college', 'university of puget sound',
    'players club of swarthmore', 'center court tennis', 'four seasons orchestra',
    'love serving autism', 'ocean reef art league', 'ocean reef conservation',
    'ocean reef yacht club', 'boca raton', 'tennis australia', 'four seasons villas',
)


def norm(name):
    s = (name or '').lower().replace('&amp;', '&').replace(' and ', ' & ')
    s = NOISE.sub(' ', s)
    s = SUFFIXES.sub(' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def http(url, rng=None, tries=4):
    h = dict(UA)
    if rng:
        h['Range'] = rng
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=90).read()
        except Exception:
            pass
    return None


# ---- Stage 1: scan index CSVs for target names ----
def scan():
    targets = json.load(open(TARGETS, encoding='utf-8'))
    tmap = {}  # norm -> original
    for t in targets:
        n = norm(t)
        if len(n.split()) >= 2:  # 1-word names are too generic to match safely
            tmap[n] = t

    blocked = set()
    try:
        blocked = {re.sub(r'\D', '', str(e)) for e in json.load(open(BLOCKLIST))['eins']}
    except Exception:
        pass
    in_bench = set()
    for r in json.load(open(BENCH, encoding='utf-8')):
        if r.get('ein'):
            in_bench.add(re.sub(r'\D', '', r['ein']))

    best = {}          # ein -> filing dict (latest taxPeriod, 990 only)
    hits = defaultdict(list)   # target original -> list of match info
    for year in YEARS:
        path = os.path.join(CACHE, f'index_{year}.csv')
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                c = line.rstrip('\n').split(',')
                if len(c) < 10:
                    continue
                ein, tax_period = c[2], c[3]
                rtype = c[-4]
                oid = c[-2]
                batch = c[-1].strip()
                name = ','.join(c[5:len(c) - 4])
                if rtype not in ('990', '990EZ'):
                    continue
                nn = norm(name)
                if not nn:
                    continue
                tier = None
                tkey = None
                if nn in tmap:
                    tier, tkey = 'exact', nn
                else:
                    # legal name = target + short tail ("... of washington")
                    for tn in tmap:
                        if nn.startswith(tn + ' ') and len(nn) - len(tn) <= 16:
                            tier, tkey = 'prefix', tn
                            break
                if not tier:
                    continue
                if EXCLUDE.search(name.upper()):
                    continue
                if any(nn.startswith(d) for d in DENY_NAMES):
                    continue
                status = ('blocked' if ein in blocked else
                          'already_in_benchmarks' if ein in in_bench else
                          'ez_only' if rtype == '990EZ' else 'candidate')
                hits[tmap[tkey]].append({'ein': ein, 'name': name.strip(), 'tier': tier,
                                         'rtype': rtype, 'year': year, 'status': status})
                if status == 'candidate':
                    prev = best.get(ein)
                    if not prev or tax_period > prev['taxPeriod']:
                        best[ein] = {'ein': ein, 'name': name.strip(), 'taxPeriod': tax_period,
                                     'oid': oid, 'batch': batch, 'year': year}
        print(f'index {year}: scanned, cumulative candidate EINs {len(best)}')
    return tmap, hits, best


# ---- Stage 2: zip central directories (cached) + range reads ----
_cd_lock = threading.Lock()


def batch_list(year):
    out = set()
    with open(os.path.join(CACHE, f'index_{year}.csv'), encoding='utf-8', errors='replace') as f:
        for line in f:
            c = line.split(',')
            if len(c) < 10:
                continue
            b = c[-1].strip()
            if b.startswith(f'{year}_'):
                out.add(b)
    return sorted(out)


def load_batch_dir(year, batch):
    cd_cache = os.path.join(CACHE, f'cd_{year}_{batch}.json')
    if os.path.exists(cd_cache):
        return json.load(open(cd_cache))
    url = f'https://apps.irs.gov/pub/epostcard/990/xml/{year}/{batch}.zip'
    req = urllib.request.Request(url, method='HEAD', headers=UA)
    try:
        length = int(urllib.request.urlopen(req, timeout=60).headers['Content-Length'])
    except Exception:
        print(f'  ! no length for {batch}')
        return None
    tail = http(url, f'bytes={length - 65536}-{length - 1}')
    if not tail:
        return None
    eocd = tail.rfind(b'PK\x05\x06')
    if eocd < 0:
        return None
    cd_size, cd_off = struct.unpack('<II', tail[eocd + 12:eocd + 20])
    cd = http(url, f'bytes={cd_off}-{cd_off + cd_size - 1}')
    if not cd:
        return None
    entries = {}
    off = 0
    while off + 46 <= len(cd) and cd[off:off + 4] == b'PK\x01\x02':
        method, = struct.unpack('<H', cd[off + 10:off + 12])
        comp_size, = struct.unpack('<I', cd[off + 20:off + 24])
        fn_len, ex_len, cm_len = struct.unpack('<HHH', cd[off + 28:off + 34])
        local_off, = struct.unpack('<I', cd[off + 42:off + 46])
        name = cd[off + 46:off + 46 + fn_len].decode('latin1')
        base = name.rsplit('/', 1)[-1]
        entries[base] = {'method': method, 'compSize': comp_size, 'localOff': local_off}
        off += 46 + fn_len + ex_len + cm_len
    json.dump(entries, open(cd_cache, 'w'))
    return entries


def build_year_index(year):
    idx = {}
    for batch in batch_list(year):
        d = load_batch_dir(year, batch)
        if not d:
            continue
        for base, e in d.items():
            if base not in idx:
                idx[base] = dict(e, batch=batch)
    print(f'  year {year}: {len(idx)} zip entries indexed')
    return idx


def fetch_xml(year, entry):
    url = f'https://apps.irs.gov/pub/epostcard/990/xml/{year}/{entry["batch"]}.zip'
    win = 30 + 4096 + entry['compSize']
    w = http(url, f'bytes={entry["localOff"]}-{entry["localOff"] + win - 1}')
    if not w or w[:4] != b'PK\x03\x04':
        return None
    lfn, lex = struct.unpack('<HH', w[26:30])
    data = w[30 + lfn + lex:30 + lfn + lex + entry['compSize']]
    try:
        if entry['method'] == 0:
            raw = data
        elif entry['method'] == 9:
            raw = inflate64.Inflater().inflate(data)
        else:
            raw = zlib.decompressobj(-15).decompress(data)
        return raw.decode('utf-8', errors='replace')
    except Exception:
        return None


def parse_xml(xml, fallback):
    def g(tag):
        m = re.search(f'<{tag}>([^<]+)</{tag}>', xml)
        return m.group(1) if m else None

    tax_yr = g('TaxYr') or (fallback['taxPeriod'][:4] if fallback.get('taxPeriod') else None)
    revenue = g('CYTotalRevenueAmt') or g('TotalRevenueAmt')
    filer = re.search(r'<Filer[\s\S]*?</Filer>', xml)
    filer = filer.group(0) if filer else ''
    m = re.search(r'<BusinessNameLine1Txt>([^<]+)', filer) or re.search(r'<BusinessNameLine1Txt>([^<]+)', xml)
    name = m.group(1) if m else fallback['name']
    m = re.search(r'<StateAbbreviationCd>([^<]+)', filer)
    state = m.group(1) if m else None
    m = re.search(r'<ZIPCd>([^<]+)', filer)
    zipc = m.group(1)[:5] if m else None
    people = []
    for b in xml.split('<Form990PartVIISectionAGrp>')[1:]:
        pn = re.search(r'<PersonNm>([^<]+)', b)
        if not pn:
            continue
        title = re.search(r'<TitleTxt>([^<]+)', b)
        reported = re.search(r'<ReportableCompFromOrgAmt>(\d+)', b)
        other = re.search(r'<OtherCompensationAmt>(\d+)', b)
        people.append({'name': pn.group(1).strip(), 'title': title.group(1).strip() if title else '',
                       'reported': int(reported.group(1)) if reported else 0,
                       'other': int(other.group(1)) if other else 0})
    return {'name': (name or '').strip(), 'state': state, 'zip': zipc,
            'taxYr': tax_yr, 'revenue': int(revenue) if revenue else None, 'people': people}


def main():
    tmap, hits, best = scan()
    n_targets = len(tmap)
    print(f'targets: {n_targets}, targets with any index hit: {len(hits)}, candidate EINs to fetch: {len(best)}')

    if SCAN_ONLY:
        for t, hs in sorted(hits.items()):
            for h in hs[:3]:
                print(f'  {t!r:45} -> {h["name"]!r} [{h["tier"]}/{h["status"]}/{h["rtype"]}/{h["year"]}]')
        return

    done = set()
    if os.path.exists(ROWS):
        with open(ROWS, encoding='utf-8') as f:
            for line in f:
                try:
                    done.add(json.loads(line)['ein'])
                except Exception:
                    pass
    todo = [t for t in best.values() if t['ein'] not in done]
    print(f'already in rows.jsonl: {len(best) - len(todo)}, fetching: {len(todo)}')

    by_year = defaultdict(list)
    for t in todo:
        by_year[t['year']].append(t)

    out_lock = threading.Lock()
    stats = {'ok': 0, 'miss': 0}
    with open(ROWS, 'a', encoding='utf-8') as out:
        for year, batch in by_year.items():
            idx = build_year_index(year)

            def work(t):
                entry = idx.get(f'{t["oid"]}_public.xml')
                xml = fetch_xml(year, entry) if entry else None
                if not xml:
                    stats['miss'] += 1
                    return
                parsed = parse_xml(xml, t)
                with out_lock:
                    out.write(json.dumps({'ein': t['ein'], **parsed}) + '\n')
                    out.flush()
                stats['ok'] += 1
                if stats['ok'] % 20 == 0:
                    print(f'  fetched {stats["ok"]}/{len(todo)}')

            with ThreadPoolExecutor(8) as ex:
                list(ex.map(work, batch))

    # ---- report ----
    fetched_eins = {t['ein'] for t in todo}
    report = {}
    for orig in sorted(json.load(open(TARGETS, encoding='utf-8'))):
        hs = hits.get(orig, [])
        if any(h['status'] in ('candidate',) for h in hs):
            status = 'added'
        elif any(h['status'] == 'already_in_benchmarks' for h in hs):
            status = 'already_in_benchmarks'
        elif any(h['status'] == 'ez_only' for h in hs):
            status = 'ez_only'
        elif any(h['status'] == 'blocked' for h in hs):
            status = 'blocked'
        else:
            status = 'not_found'
        report[orig] = {'status': status,
                        'matches': [{k: h[k] for k in ('ein', 'name', 'tier', 'rtype', 'status')} for h in hs[:6]]}
    json.dump(report, open(REPORT, 'w', encoding='utf-8'), indent=1)
    counts = defaultdict(int)
    for r in report.values():
        counts[r['status']] += 1
    print(f'DONE. fetched {stats["ok"]} filings ({stats["miss"]} missing). target statuses: {dict(counts)}')
    print(f'report -> {REPORT}\nNext: node scripts/990-merge.mjs --dry')


if __name__ == '__main__':
    main()
