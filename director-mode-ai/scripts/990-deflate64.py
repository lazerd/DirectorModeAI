#!/usr/bin/env python3
"""Extract the 990 filings that 990-ingest.mjs (Node) couldn't: the IRS ships a
chunk of e-file zips with compression method 9 (Deflate64), which Node's zlib
can't inflate. Python's `inflate64` can. This finishes the job — same target set,
same rows.jsonl schema, resumable (skips EINs already present).

    pip install inflate64
    python scripts/990-deflate64.py
"""
import json, os, re, struct, sys, threading, urllib.request, zlib
from concurrent.futures import ThreadPoolExecutor
import inflate64

CACHE = r'C:/Users/darri/AppData/Local/Temp/claude/C--Users-darri/c562ea4e-4206-4435-806d-e6804043334a/scratchpad/990cache'
ROWS = os.path.join(CACHE, 'rows.jsonl')
HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.join(HERE, '..', 'src', 'app', 'benchmarks', '_data', 'benchmarks.json')
YEARS = [2025, 2024, 2023]
UA = {'User-Agent': 'clubmode-benchmarks-ingest/1.0 (darrinjco@gmail.com)'}

INCLUDE = re.compile(r'(COUNTRY CLUB|GOLF AND COUNTRY|GOLF & COUNTRY|GOLF CLUB|GOLF LINKS|TENNIS CLUB|TENNIS CENTER|RACQUET|RACKET|ATHLETIC CLUB|FIELD CLUB|YACHT CLUB|HUNT CLUB|UNIVERSITY CLUB|CITY CLUB|TOWN CLUB|PLATFORM TENNIS|BATH AND TENNIS|BATH & TENNIS|SWIM AND TENNIS|SWIM & TENNIS|SWIM AND RACQUET|SWIM & RACQUET|SWIM AND RACKET|TENNIS AND SWIM|TENNIS & SWIM|PADDLE|CRICKET CLUB|LAWN CLUB|BEACH AND TENNIS|BEACH & TENNIS)')
EXCLUDE = re.compile(r'(FOUNDATION|SCHOLARSHIP|CHARITABLE|BOOSTER|ALUMNI|MEMORIAL FUND|ENDOWMENT|JUNIOR GOLF|JUNIOR TENNIS|YOUTH|POLITICAL|HOMEOWNER|PROPERTY OWNER|CONDOMINIUM|MASTER ASSOCIATION)')


def http(url, rng=None):
    h = dict(UA)
    if rng:
        h['Range'] = rng
    for _ in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=60).read()
        except Exception:
            pass
    return None


def existing_eins():
    eins = set()
    try:
        for r in json.load(open(BENCH, encoding='utf8')):
            if r.get('ein'):
                eins.add(re.sub(r'\D', '', r['ein']))
    except Exception:
        pass
    return eins


def discover():
    exist = existing_eins()
    best = {}
    for year in YEARS:
        p = os.path.join(CACHE, f'index_{year}.csv')
        if not os.path.exists(p):
            continue
        for line in open(p, encoding='utf8', errors='replace'):
            c = line.rstrip('\n').split(',')
            if len(c) < 10:
                continue
            ein, taxp = c[2], c[3]
            rtype, oid = c[-4], c[-2]
            name = ','.join(c[5:-4])
            if rtype != '990':
                continue
            if not (ein in exist or (INCLUDE.search(name) and not EXCLUDE.search(name))):
                continue
            prev = best.get(ein)
            if not prev or taxp > prev['taxp']:
                best[ein] = {'ein': ein, 'name': name, 'taxp': taxp, 'oid': oid, 'year': year}
    return best


def batch_list(year):
    s = set()
    for line in open(os.path.join(CACHE, f'index_{year}.csv'), encoding='utf8', errors='replace'):
        c = line.rstrip('\n').split(',')
        if len(c) < 10:
            continue
        b = c[-1].strip().upper()           # uppercase: some index rows use lowercase batch suffix
        if b.startswith(f'{year}_'):
            s.add(b)
    return sorted(s)


def load_cd(year, batch):
    cache = os.path.join(CACHE, f'cd_{year}_{batch}.json')
    if os.path.exists(cache):
        return json.load(open(cache))
    url = f'https://apps.irs.gov/pub/epostcard/990/xml/{year}/{batch}.zip'
    try:
        length = int(urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers=UA), timeout=60).headers['Content-Length'])
    except Exception:
        return None
    tail = http(url, f'bytes={length-65536}-{length-1}')
    if not tail:
        return None
    e = tail.rfind(b'PK\x05\x06')
    if e < 0:
        return None
    cd_size = struct.unpack('<I', tail[e+12:e+16])[0]
    cd_off = struct.unpack('<I', tail[e+16:e+20])[0]
    cd = http(url, f'bytes={cd_off}-{cd_off+cd_size-1}')
    m, off = {}, 0
    while off + 46 <= len(cd) and cd[off:off+4] == b'PK\x01\x02':
        method = struct.unpack('<H', cd[off+10:off+12])[0]
        comp = struct.unpack('<I', cd[off+20:off+24])[0]
        fnl = struct.unpack('<H', cd[off+28:off+30])[0]
        exl = struct.unpack('<H', cd[off+30:off+32])[0]
        cml = struct.unpack('<H', cd[off+32:off+34])[0]
        loff = struct.unpack('<I', cd[off+42:off+46])[0]
        name = cd[off+46:off+46+fnl].decode('latin1')
        base = name.rsplit('/', 1)[-1]
        m[base] = {'method': method, 'compSize': comp, 'localOff': loff}
        off += 46 + fnl + exl + cml
    json.dump(m, open(cache, 'w'))
    return m


def year_index(year):
    idx = {}
    for b in batch_list(year):
        cd = load_cd(year, b)
        if not cd:
            print(f'  ! no dir {b}', flush=True)
            continue
        for base, e in cd.items():
            if base not in idx:
                e2 = dict(e); e2['batch'] = b; idx[base] = e2
    return idx


def fetch_xml(year, entry):
    url = f'https://apps.irs.gov/pub/epostcard/990/xml/{year}/{entry["batch"]}.zip'
    w = http(url, f'bytes={entry["localOff"]}-{entry["localOff"]+30+4096+entry["compSize"]-1}')
    if not w or w[0:4] != b'PK\x03\x04':
        return None
    fnl = struct.unpack('<H', w[26:28])[0]
    exl = struct.unpack('<H', w[28:30])[0]
    ds = 30 + fnl + exl
    comp = w[ds:ds+entry['compSize']]
    try:
        if entry['method'] == 8:
            return zlib.decompress(comp, -15).decode('utf8', 'replace')
        if entry['method'] == 9:
            return inflate64.Inflater().inflate(comp).decode('utf8', 'replace')
    except Exception:
        return None
    return None


def g(xml, tag):
    m = re.search(rf'<{tag}>([^<]+)</{tag}>', xml)
    return m.group(1) if m else None


def parse(xml, fb):
    filer = re.search(r'<Filer\b.*?</Filer>', xml, re.S)
    fb_block = filer.group(0) if filer else xml
    name = re.search(r'<BusinessNameLine1Txt>([^<]+)', fb_block)
    state = re.search(r'<StateAbbreviationCd>([^<]+)', fb_block)
    zipc = re.search(r'<ZIPCd>([^<]+)', fb_block)
    rev = g(xml, 'CYTotalRevenueAmt') or g(xml, 'TotalRevenueAmt')
    people = []
    for b in xml.split('<Form990PartVIISectionAGrp>')[1:]:
        pn = re.search(r'<PersonNm>([^<]+)', b)
        if not pn:
            continue
        title = re.search(r'<TitleTxt>([^<]+)', b)
        rep = re.search(r'<ReportableCompFromOrgAmt>(\d+)', b)
        oth = re.search(r'<OtherCompensationAmt>(\d+)', b)
        people.append({'name': pn.group(1).strip(), 'title': (title.group(1).strip() if title else ''),
                       'reported': int(rep.group(1)) if rep else 0, 'other': int(oth.group(1)) if oth else 0})
    return {'name': (name.group(1).strip() if name else fb['name']),
            'state': state.group(1) if state else None,
            'zip': (zipc.group(1)[:5] if zipc else None),
            'taxYr': g(xml, 'TaxYr') or fb['taxp'][:4],
            'revenue': int(rev) if rev else None, 'people': people}


def main():
    targets = discover()
    done = set()
    if os.path.exists(ROWS):
        for l in open(ROWS, encoding='utf8'):
            try:
                done.add(json.loads(l)['ein'])
            except Exception:
                pass
    print(f'targets {len(targets)}, already done {len(done)}', flush=True)

    by_year = {}
    for t in targets.values():
        if t['ein'] in done:
            continue
        by_year.setdefault(t['year'], []).append(t)

    lock = threading.Lock()
    out = open(ROWS, 'a', encoding='utf8')
    grand = 0
    for year, lst in by_year.items():
        print(f'year {year}: {len(lst)} missing -> building index', flush=True)
        idx = year_index(year)
        got = [0]

        def work(t):
            e = idx.get(f'{t["oid"]}_public.xml')
            if not e:
                return
            xml = fetch_xml(year, e)
            if not xml:
                return
            rec = {'ein': t['ein']}
            rec.update(parse(xml, t))
            with lock:
                out.write(json.dumps(rec) + '\n')
                out.flush()
                got[0] += 1

        with ThreadPoolExecutor(max_workers=8) as ex:
            list(ex.map(work, lst))
        grand += got[0]
        print(f'year {year}: extracted {got[0]} (grand {grand})', flush=True)
    out.close()
    print(f'DONE deflate64 leftovers: +{grand} filings', flush=True)


if __name__ == '__main__':
    main()
