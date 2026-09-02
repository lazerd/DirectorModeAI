import { redirect } from 'next/navigation';

/**
 * LessonMode's front door is the open booking page — the thing clients use and
 * the thing that fills courts on its own. The working calendar is one click
 * away in the rail; it used to be the landing page, which put setup for the
 * primary feature two levels down.
 */
export default function LessonsPage() {
  redirect('/lessons/open');
}
