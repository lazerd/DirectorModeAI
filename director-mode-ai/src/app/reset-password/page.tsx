'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Trophy, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null);

  // Supabase parses the recovery token from the URL hash automatically when
  // the auth client initializes. Confirm we actually have a session before
  // letting the user set a new password — otherwise updateUser would silently
  // do nothing or fail with a confusing error.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasRecoverySession(Boolean(session));
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY' || session) {
          setHasRecoverySession(true);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateErr } = await supabase.auth.updateUser({ password });

      if (updateErr) {
        setError(updateErr.message);
        setLoading(false);
        return;
      }

      setSuccess(true);
      // Send them to the homepage after a short pause so they see confirmation.
      setTimeout(() => {
        router.push('/');
        router.refresh();
      }, 1500);
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
          {success ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={22} className="text-green-600" />
              </div>
              <h2 className="font-semibold text-2xl mb-2">Password updated</h2>
              <p className="text-gray-500 text-sm">
                Redirecting you to your dashboard...
              </p>
            </div>
          ) : hasRecoverySession === false ? (
            <>
              <h2 className="font-semibold text-2xl mb-2">Reset link invalid</h2>
              <p className="text-gray-500 mb-6">
                This password reset link is missing, expired, or has already
                been used. Request a fresh one to continue.
              </p>
              <Link
                href="/forgot-password"
                className="w-full inline-flex items-center justify-center bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700"
              >
                Request a new link
              </Link>
            </>
          ) : (
            <>
              <h2 className="font-semibold text-2xl mb-2">Set a new password</h2>
              <p className="text-gray-500 mb-6">
                Pick a new password to finish signing in.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">New password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                      placeholder="At least 8 characters"
                      required
                      minLength={8}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Confirm password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Re-enter the same password"
                    required
                    minLength={8}
                    autoComplete="new-password"
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
                  disabled={loading || hasRecoverySession === null}
                >
                  {loading ? 'Updating...' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
