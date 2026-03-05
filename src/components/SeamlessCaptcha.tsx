"use client";

import { useEffect, useMemo, useState } from "react";

type SeamlessCaptchaProps = {
  onVerifiedChange: (verified: boolean) => void;
};

const createChallenge = () => {
  const a = Math.floor(Math.random() * 7) + 2;
  const b = Math.floor(Math.random() * 7) + 2;
  return { a, b };
};

export default function SeamlessCaptcha({ onVerifiedChange }: SeamlessCaptchaProps) {
  const [challenge, setChallenge] = useState(createChallenge);
  const [answer, setAnswer] = useState("");
  const [verified, setVerified] = useState(false);

  const expected = useMemo(() => challenge.a + challenge.b, [challenge]);

  useEffect(() => {
    onVerifiedChange(verified);
  }, [verified, onVerifiedChange]);

  const onChangeAnswer = (value: string) => {
    setAnswer(value);
    if (Number(value) === expected) {
      setVerified(true);
      return;
    }
    setVerified(false);
  };

  const refreshChallenge = () => {
    setChallenge(createChallenge());
    setAnswer("");
    setVerified(false);
  };

  return (
    <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-700">Quick security check</p>
          <p className="text-xs text-gray-600 mt-0.5">Solve to continue (anti-bot verification)</p>
        </div>
        <button
          type="button"
          onClick={refreshChallenge}
          className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-100"
        >
          Refresh
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <span className="text-sm font-medium text-gray-800 min-w-[90px]">
          {challenge.a} + {challenge.b} =
        </span>
        <input
          type="text"
          value={answer}
          onChange={(event) => onChangeAnswer(event.target.value)}
          className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-gray-900"
          inputMode="numeric"
          placeholder="Answer"
          aria-label="Captcha answer"
        />
        {verified ? (
          <span className="text-xs font-semibold text-green-700">Verified</span>
        ) : (
          <span className="text-xs text-gray-600">Not verified</span>
        )}
      </div>
    </div>
  );
}
