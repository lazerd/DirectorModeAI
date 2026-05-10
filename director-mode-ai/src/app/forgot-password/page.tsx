'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Trophy, Mail, ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const redirectTo =
        typeof window !== 'undefined'
          ? `${window.location.origin}/reset-password`
          : '/reset-password';

      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo }
      );

      if (resetErr) {
        setError(resetErr.message);
        setLoading(false);
        return;
      }

      // Always show success — don't leak whether the email exists.
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#001820] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-10 h-10 rounded-xl bg-[#D3FB52] flex items-center justify-center">
            <Trophy size={22} className="text-[#002838]" />
          </div>
          <span className="font-semibold text-2xl text-white">CoachMode AI</span>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          {sent ? (
            <>
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-4">
                <Mail size={22} className="text-blue-600" />
              </div>
              <h2 className="font-semibold text-2xl mb-2 text-center">
                Check your email
              </h2>
              <p className="text-gray-500 text-sm text-center mb-6">
                If an account exists for <strong className="text-gray-900">{email}</strong>,
                we just sent a link to reset your password. Click the link in
                your inbox to continue.
              </p>
              <Link
                href="/login"
                className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700"
              >
                <ArrowLeft size={16} />
                Back to sign in
              </Link>
              <p className="text-xs text-gray-400 mt-4 text-center">
                Did not get the email? Check your spam folder, or{' '}
                <button
                  type="button"
                  onClick={() => setSent(false)}
                  className="text-blue-600 hover:underline"
                >
                  try again
                </button>
                .
              </p>
            </>
          ) : (
            <>
              <h2 className="font-semibold text-2xl mb-2">Reset your password</h2>
              <p className="text-gray-500 mb-6">
                Enter the email tied to your account and we will send you a
                link to set a new password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="you@example.com"
                    required
                    autoFocus
                  />
                </div>

                {error && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                  disabled={loading}
                >
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>

              <div className="mt-6 text-center text-sm text-gray-500">
                Remembered it?{' '}
                <Link href="/login" className="text-blue-600 font-medium hover:underline">
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
