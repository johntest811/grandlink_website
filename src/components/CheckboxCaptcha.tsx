"use client";

import { useEffect, useState } from "react";

type CheckboxCaptchaProps = {
  onVerifiedChange: (verified: boolean) => void;
  label?: string;
};

export default function CheckboxCaptcha({ onVerifiedChange, label }: CheckboxCaptchaProps) {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    onVerifiedChange(checked);
  }, [checked, onVerifiedChange]);

  return (
    <div className="rounded-lg border border-gray-300 bg-gray-50 px-3 py-3">
      <label className="flex items-center gap-3 select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="h-5 w-5 accent-[#8B1C1C]"
          aria-label="Captcha checkbox"
        />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-gray-800">{label || "I’m not a robot"}</span>
          <span className="text-xs text-gray-600">Tick the box to continue</span>
        </div>
      </label>
    </div>
  );
}
