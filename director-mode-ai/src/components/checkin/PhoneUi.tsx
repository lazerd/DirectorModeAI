'use client';

/**
 * The building blocks of the check-in phone pages.
 *
 * Built for someone standing at a fence in the sun, possibly 80, possibly with
 * reading glasses in the car: 18px body and up, 56px buttons, one decision per
 * screen, light background with dark ink regardless of the app's navy theme.
 * Inputs carry inline colors because globals.css styles form controls with
 * unlayered CSS that beats Tailwind's text-* utilities.
 */

import type { ReactNode } from 'react';

export const INK = '#10231f';
export const MUTED = '#4b5b57';
export const ACCENT = '#0f5f6b';
export const PAGE_BG = '#f4f6f2';

export function Shell({
  clubName,
  logoUrl,
  children,
}: {
  clubName: string;
  logoUrl?: string | null;
  children: ReactNode;
}) {
  return (
    <div style={{ background: PAGE_BG, color: INK, minHeight: '100vh' }} className="w-full">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-10 pt-5" style={{ fontSize: 19, lineHeight: 1.45 }}>
        <header className="mb-5 flex items-center gap-3">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-11 w-11 rounded-lg bg-white object-contain p-1" />
          ) : null}
          <div className="text-[17px] font-semibold" style={{ color: MUTED }}>
            {clubName}
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}

export function Title({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? '#0b6b3a' : tone === 'warn' ? '#8a4b00' : tone === 'bad' ? '#9b1c1c' : INK;
  return (
    <h1 className="text-[32px] font-extrabold leading-tight" style={{ color }}>
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-[20px]" style={{ color: MUTED }}>
      {children}
    </p>
  );
}

export function BigButton({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'good';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: ACCENT, color: '#fff', border: `2px solid ${ACCENT}` },
    good: { background: '#0b6b3a', color: '#fff', border: '2px solid #0b6b3a' },
    danger: { background: '#fff', color: '#9b1c1c', border: '2px solid #9b1c1c' },
    secondary: { background: '#fff', color: INK, border: '2px solid #c9d2cf' },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="mt-3 w-full rounded-2xl px-5 text-[21px] font-bold transition active:scale-[0.99] disabled:opacity-50"
      style={{ minHeight: 60, ...styles[variant] }}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoFocus,
  list,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  list?: string;
  autoComplete?: string;
}) {
  return (
    <label className="mt-4 block">
      <span className="mb-1 block text-[18px] font-semibold">{label}</span>
      <input
        type={type}
        value={value}
        autoFocus={autoFocus}
        list={list}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-4"
        style={{ minHeight: 56, fontSize: 20, color: INK, backgroundColor: '#fff', border: '2px solid #c9d2cf' }}
      />
    </label>
  );
}

export function Card({ children, tone }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'info' }) {
  const bg = tone === 'good' ? '#e3f4ea' : tone === 'warn' ? '#fff1d6' : tone === 'bad' ? '#fde5e5' : tone === 'info' ? '#e4f0f2' : '#fff';
  const border = tone === 'good' ? '#9fd4b4' : tone === 'warn' ? '#f0c574' : tone === 'bad' ? '#f1a9a9' : tone === 'info' ? '#a9ccd2' : '#dde3e1';
  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: bg, border: `2px solid ${border}` }}>
      {children}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="mt-4 rounded-xl p-4 text-[19px] font-semibold" style={{ background: '#fde5e5', color: '#7f1d1d' }}>
      {children}
    </div>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 text-center text-[16px]" style={{ color: MUTED }}>
      {children}
    </p>
  );
}
