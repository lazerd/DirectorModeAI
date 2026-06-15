"use client";

import { useState } from "react";

export default function SurveyForm({
  clubSlug,
  clubName,
}: {
  clubSlug: string;
  clubName: string;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (score === null) {
      setError("Please pick a number from 0 to 10.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/nps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubSlug, score, comment, name }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Something went wrong.");
      }
      setDone(true);
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
        <div className="mb-2 text-4xl">🎾</div>
        <h2 className="text-xl font-bold text-gray-900">Thank you!</h2>
        <p className="mt-2 text-gray-600">
          Your feedback helps {clubName} keep improving the tennis program.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-xl font-bold text-gray-900">{clubName}</h1>
      <p className="mt-2 text-gray-700">
        How likely are you to recommend our tennis program to a friend or fellow member?
      </p>

      <div className="mt-5 grid grid-cols-11 gap-1.5">
        {Array.from({ length: 11 }, (_, i) => i).map((n) => (
          <button
            key={n}
            onClick={() => setScore(n)}
            className={`aspect-square rounded-lg text-sm font-semibold transition-colors ${
              score === n
                ? "bg-[#002838] text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-gray-400">
        <span>Not likely</span>
        <span>Very likely</span>
      </div>

      <label className="mt-5 block text-sm font-medium text-gray-700">
        Anything you'd like to add? (optional)
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-gray-900 focus:border-[#002838] focus:outline-none"
          placeholder="What's working, what could be better…"
        />
      </label>

      <label className="mt-3 block text-sm font-medium text-gray-700">
        Your name (optional)
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-gray-900 focus:border-[#002838] focus:outline-none"
          placeholder="Optional"
        />
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-5 w-full rounded-lg bg-[#002838] py-3 font-semibold text-white transition-colors hover:bg-[#013a52] disabled:opacity-60"
      >
        {submitting ? "Submitting…" : "Submit feedback"}
      </button>
    </div>
  );
}
