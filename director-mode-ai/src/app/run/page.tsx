import { redirect } from 'next/navigation';

// /run has no page of its own — "Run the club" is a space, not a screen.
// Land on All tools, which lists every section and every product in it.
export default function RunIndexPage() {
  redirect('/run/tools');
}
