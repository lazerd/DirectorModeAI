/**
 * Curated walkout track library — 15 public-domain / freely-redistributable
 * tracks served from your Supabase dj-audio bucket under /library/<id>.mp3
 *
 * Source URLs point at archive.org PD recordings; the seed admin endpoint
 * (/api/admin/dj/seed-library) downloads each server-side and rehosts on
 * Supabase so audio playback in the browser is CORS-clean and stable.
 */

export interface LibraryTrack {
  id: string;
  title: string;
  vibe: string;
  composer: string;
  durationSec: number;
  /** archive.org or other public-source URL, used by the seed endpoint */
  sourceUrl: string;
}

export const LIBRARY_TRACKS: LibraryTrack[] = [
  {
    id: 'fifth-symphony',
    title: "Beethoven's 5th — Opening",
    vibe: 'Iconic four-note hammer; instant drama',
    composer: 'Beethoven',
    durationSec: 90,
    sourceUrl:
      'https://archive.org/download/Symphony5_761/Beethoven_-_Symphony_No._5_in_C_Minor%2C_Op._67_-_I._Allegro_con_brio.mp3',
  },
  {
    id: 'ride-of-valkyries',
    title: 'Ride of the Valkyries',
    vibe: 'Apocalypse Now charge — pure aggression',
    composer: 'Wagner',
    durationSec: 60,
    sourceUrl:
      'https://archive.org/download/RideOfTheValkyries_201601/Ride%20of%20the%20Valkyries.mp3',
  },
  {
    id: 'william-tell-finale',
    title: 'William Tell Overture — Finale',
    vibe: 'Lone Ranger gallop; classic chase energy',
    composer: 'Rossini',
    durationSec: 60,
    sourceUrl:
      'https://archive.org/download/WilliamTellOverture/William%20Tell%20Overture%20-%20Finale.mp3',
  },
  {
    id: 'mountain-king',
    title: 'In the Hall of the Mountain King',
    vibe: 'Slow build → mad rush; tension into release',
    composer: 'Grieg',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/grieg_peer_gynt_hall_mountain_king/Hall_of_the_Mountain_King.mp3',
  },
  {
    id: '1812-finale',
    title: '1812 Overture — Cannon Finale',
    vibe: 'Cannons, bells, fireworks — championship vibes',
    composer: 'Tchaikovsky',
    durationSec: 60,
    sourceUrl: 'https://archive.org/download/1812Overture_201912/1812%20Overture%20Finale.mp3',
  },
  {
    id: 'stars-and-stripes',
    title: 'Stars and Stripes Forever',
    vibe: 'Marching-band patriot energy',
    composer: 'Sousa',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/StarsAndStripesForever_809/Stars_and_Stripes_Forever.mp3',
  },
  {
    id: 'liberty-bell-march',
    title: 'Liberty Bell March',
    vibe: 'Monty Python theme — comic-strut walk-on',
    composer: 'Sousa',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/LibertyBellMarch_201912/Liberty_Bell_March.mp3',
  },
  {
    id: 'washington-post',
    title: 'The Washington Post March',
    vibe: 'Pep-band-energy charge',
    composer: 'Sousa',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/WashingtonPostMarch_201912/Washington_Post_March.mp3',
  },
  {
    id: 'toreador',
    title: 'Toreador Song (Carmen)',
    vibe: 'Bullfighter swagger — chest-out walk',
    composer: 'Bizet',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/CarmenToreadorSong/Toreador_Song.mp3',
  },
  {
    id: 'hungarian-rhapsody-2',
    title: 'Hungarian Rhapsody No. 2 — Friska',
    vibe: 'Looney Tunes piano flourish',
    composer: 'Liszt',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/HungarianRhapsody2_201912/Hungarian_Rhapsody_2_Friska.mp3',
  },
  {
    id: 'mars',
    title: 'Mars, the Bringer of War',
    vibe: 'Holst — battle drums, doom-march',
    composer: 'Holst',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/HolstThePlanets_201912/01_Mars_The_Bringer_of_War.mp3',
  },
  {
    id: 'aida-march',
    title: 'Triumphal March (Aida)',
    vibe: 'Trumpets-and-glory victory parade',
    composer: 'Verdi',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/AidaTriumphalMarch/Aida_Triumphal_March.mp3',
  },
  {
    id: 'anvil-chorus',
    title: 'Anvil Chorus (Il Trovatore)',
    vibe: 'Hammers on iron — workshop hype',
    composer: 'Verdi',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/IlTrovatoreAnvilChorus/Anvil_Chorus.mp3',
  },
  {
    id: 'eine-kleine',
    title: 'Eine kleine Nachtmusik — Allegro',
    vibe: 'Refined, witty, classy entrance',
    composer: 'Mozart',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/EineKleineNachtmusik_201912/Eine_kleine_Nachtmusik_Allegro.mp3',
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy (Symphony No. 9)',
    vibe: 'Triumphant celebration — final-of-finals',
    composer: 'Beethoven',
    durationSec: 90,
    sourceUrl: 'https://archive.org/download/OdeToJoy_201912/Ode_To_Joy.mp3',
  },
];

export const LIBRARY_STORAGE_PREFIX = 'library/';

export function libraryStoragePath(trackId: string): string {
  return `${LIBRARY_STORAGE_PREFIX}${trackId}.mp3`;
}
