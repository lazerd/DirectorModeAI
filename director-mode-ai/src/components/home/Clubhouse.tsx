'use client';

/**
 * Inside clubmode.ai (11/25/26): what a member code (or a member sign-in) opens.
 *
 * Agent-first and text-first. The room with the staff in it is the picture; the pitch
 * is "your staff texts you, you reply YES"; every tool built before still lives here,
 * one tap away, under "The rooms".
 *
 *   mode 'insider'  has a code, no account yet -> claim a membership
 *   mode 'member'   signed in                  -> open the Pro Shop, text your staff
 */
import { useState } from 'react';
import { PRODUCTS } from '@/config/nav';
import { STAFF } from '@/lib/proshop/staff';
import { createClient } from '@/lib/supabase/client';

const PORTRAIT: Record<string, string> = {
  ledger: 'ledger', proshop: 'proshop', frontdesk: 'frontdesk', courts: 'courts', league: 'league',
  grounds: 'grounds', pay: 'pay', host: 'host', juniors: 'juniors', analyst: 'analyst',
};

export default function Clubhouse({ mode }: { mode: 'insider' | 'member' }) {
  const [out, setOut] = useState(false);
  const member = mode === 'member';
  async function signOut() {
    setOut(true);
    try { await createClient().auth.signOut(); } catch {}
    window.location.href = '/';
  }

  return (
    <main className="ch">
      <style>{CSS}</style>
      <header className="ch-top">
        <a href="/" className="ch-brand"><span className="ch-crest">CM</span><span>CLUBMODE</span></a>
        <nav className="ch-nav">
          {member ? (
            <>
              <a href="/proshop">Pro Shop</a>
              <a href="/text">Texts</a>
              <button onClick={signOut} disabled={out}>Sign out</button>
            </>
          ) : (
            <a href="/login">Members, sign in</a>
          )}
        </nav>
      </header>

      <section className="ch-hero">
        <div className="ch-hero-img" aria-hidden="true" />
        <div className="ch-hero-veil" aria-hidden="true" />
        <div className="ch-hero-in">
          <p className="ch-kicker">{member ? 'Welcome back' : 'You’re in'}</p>
          <h1 className="ch-h1">Your staff is already at work.</h1>
          <p className="ch-lead">
            Ten staff run the back office of your club: charges, clinic reminders, payroll, the inbox, the courts.
            They text you what needs you. You reply YES.
          </p>
          <div className="ch-ctas">
            {member ? (
              <>
                <a className="ch-btn" href="/proshop">Open the Pro Shop</a>
                <a className="ch-btn ch-ghost" href="/text">Text your staff</a>
              </>
            ) : (
              <>
                <a className="ch-btn" href="/register?next=/text">Claim your membership</a>
                <a className="ch-btn ch-ghost" href="/login?next=/">Members, sign in</a>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="ch-sec">
        <p className="ch-label">How it works</p>
        <h2 className="ch-h2">No app. No dashboard. Just a text.</h2>
        <div className="ch-steps">
          <div className="ch-step"><b>7:00am</b><p>“Morning. 2 things need you: 1) Last week’s lesson charges are ready. 2) Tuesday clinic has 2 spots, a note to 11 regulars is ready.”</p></div>
          <div className="ch-step"><b>You reply “2”, then YES</b><p>Eleven personal emails go out, one each. Nobody gets a blast.</p></div>
          <div className="ch-step"><b>6:00pm</b><p>“Today: 17 reminders sent, charges built, 1 spot filled. Nothing needs you.”</p></div>
        </div>
        <p className="ch-fine">Nothing involving money is approved by a text alone. You get a link and tap yes yourself.</p>
      </section>

      <section className="ch-sec">
        <p className="ch-label">The staff</p>
        <h2 className="ch-h2">Ten of them. They never miss a Monday.</h2>
        <div className="ch-staff">
          {STAFF.map((s) => (
            <div key={s.id} className="ch-person">
              <div className="ch-face" style={{ backgroundImage: `url(/proshop/staff/${PORTRAIT[s.id] ?? s.id}.jpg)`, borderColor: s.color }} />
              <div className="ch-name">{s.name}</div>
              <div className="ch-role">{s.role}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="ch-sec">
        <p className="ch-label">The rooms</p>
        <h2 className="ch-h2">Everything else in the club.</h2>
        <div className="ch-rooms">
          {PRODUCTS.map((t) => (
            <a key={t.name} href={t.href} className="ch-room">
              <span className="ch-dot" style={{ background: t.color }} />
              <span className="ch-room-name">{t.name}</span>
              <span className="ch-room-d">{t.description}</span>
            </a>
          ))}
          <a href="https://racquetsirl.com" className="ch-room">
            <span className="ch-dot" style={{ background: '#d7f25a' }} />
            <span className="ch-room-name">Racquets IRL</span>
            <span className="ch-room-d">Pickup games for your members: one link, courts and partners done.</span>
          </a>
        </div>
      </section>

      <footer className="ch-foot">
        <span>ClubMode · Members only</span>
        <span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/sms">Texts</a></span>
      </footer>
    </main>
  );
}

const CSS = `
.ch{min-height:100vh;background:#07120e;color:#efe8d6;font-family:Archivo,system-ui,sans-serif}
.ch a{color:inherit}
.ch-top{position:absolute;top:0;left:0;right:0;z-index:3;display:flex;justify-content:space-between;align-items:center;padding:18px clamp(16px,4vw,40px)}
.ch-brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-size:12px;letter-spacing:.38em;color:#d9bd7c}
.ch-crest{width:34px;height:34px;border-radius:50%;border:1.5px solid #c9ac6a;display:grid;place-items:center;font:600 12px Georgia,serif;letter-spacing:.04em}
.ch-nav{display:flex;gap:16px;align-items:center;font-size:14px}
.ch-nav a,.ch-nav button{color:rgba(239,232,214,.8);text-decoration:none;background:none;border:0;cursor:pointer;font:inherit}
.ch-nav a:hover,.ch-nav button:hover{color:#fff}
.ch-hero{position:relative;min-height:88vh;display:flex;align-items:flex-end;overflow:hidden}
.ch-hero-img{position:absolute;inset:0;background:url(/proshop/scene.jpg) center 40%/cover no-repeat}
.ch-hero-veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(7,18,14,.55) 0%,rgba(7,18,14,.2) 35%,rgba(7,18,14,.85) 78%,#07120e 100%)}
.ch-hero-in{position:relative;z-index:2;max-width:760px;padding:0 clamp(18px,5vw,56px) 64px}
.ch-kicker{font-size:12px;letter-spacing:.32em;text-transform:uppercase;color:#d9bd7c;margin:0 0 14px}
.ch-h1{font:400 clamp(38px,6vw,68px)/1.04 Georgia,'Times New Roman',serif;margin:0 0 16px;color:#fbf5e6}
.ch-lead{font-size:clamp(16px,2vw,19px);line-height:1.55;color:rgba(239,232,214,.82);margin:0 0 26px;max-width:620px}
.ch-ctas{display:flex;gap:10px;flex-wrap:wrap}
.ch-btn{display:inline-block;background:#d9bd7c;color:#15110a !important;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px}
.ch-ghost{background:rgba(255,255,255,.08);color:#efe8d6 !important;border:1px solid rgba(217,189,124,.45)}
.ch-sec{max-width:1080px;margin:0 auto;padding:72px clamp(18px,5vw,40px) 8px}
.ch-label{font-size:12px;letter-spacing:.32em;text-transform:uppercase;color:#c9ac6a;margin:0 0 10px}
.ch-h2{font:400 clamp(28px,4vw,40px)/1.15 Georgia,serif;margin:0 0 28px;color:#fbf5e6}
.ch-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
.ch-step{background:rgba(255,255,255,.035);border:1px solid rgba(217,189,124,.18);border-radius:18px;padding:20px}
.ch-step b{display:block;color:#d9bd7c;margin-bottom:8px;font-size:14px;letter-spacing:.02em}
.ch-step p{margin:0;color:rgba(239,232,214,.8);line-height:1.5}
.ch-fine{color:rgba(239,232,214,.5);font-size:14px;margin:16px 0 0}
.ch-staff{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px}
.ch-person{text-align:center}
.ch-face{width:108px;height:108px;margin:0 auto 10px;border-radius:50%;background:#123 center/cover no-repeat;border:2px solid}
.ch-name{font-weight:700}
.ch-role{color:rgba(239,232,214,.6);font-size:13px}
.ch-rooms{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.ch-room{display:grid;grid-template-columns:14px 1fr;column-gap:10px;row-gap:4px;text-decoration:none;padding:16px;border-radius:16px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.025);transition:border-color .15s,background .15s}
.ch-room:hover{border-color:rgba(217,189,124,.5);background:rgba(217,189,124,.06)}
.ch-dot{width:10px;height:10px;border-radius:50%;margin-top:6px}
.ch-room-name{font-weight:700}
.ch-room-d{grid-column:2;color:rgba(239,232,214,.6);font-size:14px;line-height:1.45}
.ch-foot{max-width:1080px;margin:0 auto;padding:60px clamp(18px,5vw,40px) 40px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:13px;color:rgba(239,232,214,.45)}
.ch-foot a{text-decoration:none}
`;
