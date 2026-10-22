/**
 * MyCoachingTree Career Center — https://jobs.mycoachingtree.com
 * A general sports-jobs SmartJobBoard (college athletics dominate), but clubs
 * and search firms (e.g. Kopplin, Kuebler & Wallace) post Director of
 * Tennis/Racquets roles here too. robots.txt allows /rss/ and /job/ for all
 * agents. We read the keyword RSS feeds and keep racquets club titles only.
 */
import type { SourceAdapter } from '../types';
import { readSmartJobBoardFeeds } from './smartjobboard';

const KEYWORDS = ['tennis', 'racquet', 'pickleball', 'padel'];

export const mycoachingtree: SourceAdapter = {
  id: 'mycoachingtree',
  label: 'MyCoachingTree',
  homeUrl: 'https://jobs.mycoachingtree.com/categories/tennis',
  cap: 50,
  list: () =>
    readSmartJobBoardFeeds({
      source: 'mycoachingtree',
      feedUrls: KEYWORDS.map((k) => `https://jobs.mycoachingtree.com/rss/?keywords=${k}`),
      filterTitles: true,
    }),
};
