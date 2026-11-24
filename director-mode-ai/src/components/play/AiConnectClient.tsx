'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { C, PlayHeader } from './shared';

const MCP_URL = 'https://clubmode.ai/api/mcp';

const ASKS = [
  'Set up pickleball Saturday 9am at Lakeside Park, 3 courts, open to everyone.',
  'Make a 3.5–4.0 tennis doubles mixer Thursday at 6, 4 courts, King of the Court.',
  'Everyone’s here, check them all in and start it.',
  'Court 2 was 11–7. Next round.',
  'End it and give me the recap.',
  'Run it back next week, same group.',
];

/** /play/ai: how an organizer connects Racquets IRL to Claude or ChatGPT (the MCP server). */
export default function AiConnectClient() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(MCP_URL); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* old browser: the URL is on screen */ }
  };
  return (
    <div className="min-h-screen" style={{ background: C.paper, color: C.ink }}>
      <PlayHeader right={<Link href="/play/new" className="text-[14px] font-semibold underline underline-offset-4">Start a game</Link>} />
      <main className="mx-auto w-full max-w-xl px-5 pb-16">
        <h1 className="mt-4 text-[34px] font-semibold leading-[1.05] tracking-tight">Run your games from ChatGPT or Claude</h1>
        <p className="mt-3 text-[16px] leading-relaxed" style={{ color: C.muted }}>
          Connect Racquets IRL once, then just say what you want: “pickleball Saturday at 9, three courts.” Your AI makes the game, writes the group-chat invite, checks people in, runs the rounds, keeps score and does the recap.
          Your players don’t need anything: they still just tap the link.
        </p>

        <section className="mt-6 rounded-3xl p-5" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: C.muted }}>Connector URL</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-xl px-3 py-3 text-[14px]" style={{ background: '#eef1e8' }}>{MCP_URL}</code>
            <button onClick={copy} className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-4 text-[15px] font-semibold" style={{ background: C.lime, color: C.ink }}>
              {copied ? <><Check className="h-4 w-4" />Copied</> : <><Copy className="h-4 w-4" />Copy</>}
            </button>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>No account or password needed. Free to host your first game.</p>
        </section>

        <section className="mt-6">
          <h2 className="text-[18px] font-semibold">In Claude</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
            <li>Open <b>Settings → Connectors</b> and choose <b>Add custom connector</b>.</li>
            <li>Name it <b>Racquets IRL</b> and paste the URL above.</li>
            <li>In a new chat, turn on Racquets IRL and tell it about your game.</li>
          </ol>
        </section>

        <section className="mt-6">
          <h2 className="text-[18px] font-semibold">In ChatGPT</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
            <li>In <b>Settings → Apps &amp; Connectors</b>, open <b>Advanced settings</b> and turn on <b>Developer mode</b>.</li>
            <li>Create a connector named <b>Racquets IRL</b> with the URL above (no authentication).</li>
            <li>In a new chat, add Racquets IRL and tell it about your game.</li>
          </ol>
          <p className="mt-2 text-[12px]" style={{ color: C.muted }}>Custom connectors depend on your ChatGPT or Claude plan. Menu names can change as they update their apps.</p>
        </section>

        <section className="mt-6 rounded-3xl p-5" style={{ background: C.ink, color: C.paper }}>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: C.lime }}>Things to say</p>
          <ul className="mt-3 space-y-2 text-[15px] leading-snug">
            {ASKS.map((a) => <li key={a}>“{a}”</li>)}
          </ul>
        </section>

        <p className="mt-6 text-[14px] leading-relaxed" style={{ color: C.muted }}>
          Your AI gets a private host link for each game, the same one you’d get here. Open it on your phone to run the night by hand anytime.
        </p>
        <div className="mt-8 grid gap-2">
          <Link href="/play/new" className="flex h-14 items-center justify-center rounded-2xl text-[17px] font-semibold" style={{ background: C.lime, color: C.ink }}>Or start a game right here</Link>
        </div>
      </main>
    </div>
  );
}
