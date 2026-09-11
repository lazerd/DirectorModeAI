/**
 * Common daily chores a manager can choose from on first run.
 *
 * NEVER inserted automatically — the setup screen lists these with nothing
 * pre-ticked, and only the ones the manager picks are added.
 */
import type { Department } from './types';

export type StarterItem = {
  key: string;
  title: string;
  department: Department;
  location: string | null;
  days_of_week: number[];
  target_time: string | null;
};

const EVERY = [0, 1, 2, 3, 4, 5, 6];

export const STARTER_ROUTINE: StarterItem[] = [
  { key: 'blow-courts', title: 'Blow off all courts', department: 'tennis', location: 'Courts', days_of_week: EVERY, target_time: '07:00' },
  { key: 'check-nets', title: 'Check nets, straps and center straps', department: 'tennis', location: 'Courts', days_of_week: EVERY, target_time: '07:30' },
  { key: 'court-trash', title: 'Empty court-side trash and recycling', department: 'tennis', location: 'Courts', days_of_week: EVERY, target_time: null },
  { key: 'skim-pool', title: 'Skim pool and empty skimmer baskets', department: 'aquatics', location: 'Pool', days_of_week: EVERY, target_time: '07:00' },
  { key: 'pool-chem', title: 'Test and log pool chemicals', department: 'aquatics', location: 'Pool', days_of_week: EVERY, target_time: '08:00' },
  { key: 'pool-deck', title: 'Hose down pool deck and straighten chairs', department: 'aquatics', location: 'Pool deck', days_of_week: EVERY, target_time: '09:00' },
  { key: 'restrooms', title: 'Check and restock restrooms', department: 'clubhouse', location: 'Clubhouse', days_of_week: EVERY, target_time: '08:00' },
  { key: 'clubhouse-trash', title: 'Empty clubhouse trash', department: 'clubhouse', location: 'Clubhouse', days_of_week: EVERY, target_time: null },
  { key: 'towels', title: 'Restock towels', department: 'fitness', location: 'Fitness room', days_of_week: EVERY, target_time: null },
  { key: 'wipe-equipment', title: 'Wipe down fitness equipment', department: 'fitness', location: 'Fitness room', days_of_week: EVERY, target_time: null },
  { key: 'grounds-walk', title: 'Walk the grounds for trash and hazards', department: 'grounds', location: 'Grounds', days_of_week: EVERY, target_time: null },
  { key: 'lock-up', title: 'Evening lock-up check', department: 'clubhouse', location: 'Clubhouse', days_of_week: EVERY, target_time: '21:00' },
];
