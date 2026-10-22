/**
 * Shared reader for SmartJobBoard career centers (RSPA, MyCoachingTree).
 * Their public RSS feed (/rss/, optionally ?keywords=) carries title, link,
 * pubDate and a description whose first two lines are the location and the
 * employer, followed by the posting HTML.
 */
import { politeGet } from '../http';
import { htmlToText, looksLikeRacquetsRole, parseRss, toIsoDate } from '../text';
import type { ListItem } from '../types';

export async function readSmartJobBoardFeeds(opts: {
  source: string;
  feedUrls: string[];
  /** Apply the racquets title pre-filter (for general sports boards). */
  filterTitles: boolean;
}): Promise<{ items: ListItem[]; errors: string[] }> {
  const items = new Map<string, ListItem>();
  const errors: string[] = [];
  for (const feed of opts.feedUrls) {
    const r = await politeGet(feed, 'application/rss+xml,application/xml,text/xml,*/*');
    if (!r.ok) {
      errors.push(`${feed}: ${r.error}`);
      continue;
    }
    for (const it of parseRss(r.body)) {
      if (items.has(it.link)) continue;
      if (opts.filterTitles && !looksLikeRacquetsRole(it.title)) continue;
      // description = "\n   <location>\n   <employer>\n   <html…>"
      const lines = it.description.split('\n');
      const head: string[] = [];
      let i = 0;
      while (i < lines.length && head.length < 2) {
        const l = lines[i].trim();
        i++;
        if (l.startsWith('<')) {
          i--;
          break;
        }
        head.push(l);
      }
      const body = lines.slice(i).join('\n');
      const idMatch = it.link.match(/\/job\/(\d+)\//);
      items.set(it.link, {
        source: opts.source,
        url: it.link,
        externalId: idMatch ? idMatch[1] : null,
        title: it.title.trim(),
        location: head[0] || null,
        club: head[1] || null,
        postedAt: toIsoDate(it.pubDate),
        text: htmlToText(body),
      });
    }
  }
  return { items: [...items.values()], errors };
}
