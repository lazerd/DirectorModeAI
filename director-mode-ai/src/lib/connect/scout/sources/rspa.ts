/**
 * RSPA (formerly USPTA) Career Center — https://jobs.rspa.net
 * SmartJobBoard; robots.txt allows /rss/ and /job/ for all agents
 * (only /files/files/, /download/, /application-redirect/ are disallowed).
 * Every posting is a racquets job, but league "ambassador" gigs etc. are
 * still filtered by title.
 */
import type { SourceAdapter } from '../types';
import { readSmartJobBoardFeeds } from './smartjobboard';

export const rspa: SourceAdapter = {
  id: 'rspa',
  label: 'RSPA Career Center',
  homeUrl: 'https://jobs.rspa.net/jobs/',
  cap: 60,
  list: () =>
    readSmartJobBoardFeeds({
      source: 'rspa',
      feedUrls: ['https://jobs.rspa.net/rss/'],
      filterTitles: true,
    }),
};
