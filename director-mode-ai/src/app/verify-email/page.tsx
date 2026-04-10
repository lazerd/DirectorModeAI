'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Trophy } from 'lucide-react';

function VerifyEmailContent() {
  const params = useSearchParams();
  const email = params.get('email') || '';

  return (
    <div className="min-h-screen bg-[#001820] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <span className="font-display text-2xl text-white">CoachMode AI</span>
        </div>

        <div className="card p-6 sm:p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-[#D3FB52]/10 flex items-center justify-center mx-auto mb-4">
            <Mail size={28} className="text-[#D3FB52]" />
          </div>
          <h2 className="font-display text-2xl mb-2 text-white">Check your email</h2>
          <p className="text-white/60 mb-6">
            We sent a confirmation link to{' '}
            {email ? <strong className="text-white">{email}</strong> : 'your email address'}.
            Click the link to activate your account, then sign in.
          </p>

          <Link href="/login" className="btn btn-primary w-full">
            Go to Sign In
          </Link>

          <p className="text-xs text-white/40 mt-4">
            Didn&apos;t get the email? Check your spam folder, or{' '}
            <Link href="/register" className="underline hover:text-white">
              try again
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#001820]" />}>
      <VerifyEmailContent />
    </Suspense>
  );
}
