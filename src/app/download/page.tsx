"use client";

import { useEffect, useMemo, useState } from "react";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";

type DownloadsContent = {
  heroTitle?: string;
  heroDescription?: string;
  cardTitle?: string;
  cardDescription?: string;
  buttonLabel?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  apkUrl?: string;
  apkVersion?: string;
  apkSize?: string;
  apkFileName?: string;
  enabled?: boolean;
};

const fallbackContent: DownloadsContent = {
  heroTitle: "Download GrandLink Mobile",
  heroDescription: "Install our Android app to access reservations and updates from your phone.",
  cardTitle: "GrandLink Android App",
  cardDescription: "Official Google Drive download link from GrandLink.",
  buttonLabel: "Open Download Link",
  releaseNotes: "No release notes yet.",
  downloadUrl: "",
  apkUrl: "",
  apkVersion: "",
  apkSize: "",
  apkFileName: "",
  enabled: true,
};

export default function DownloadPage() {
  const [content, setContent] = useState<DownloadsContent>(fallbackContent);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/downloads");
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || "Failed to load downloads content");
        const next = (payload?.content ?? payload ?? {}) as DownloadsContent;
        setContent({ ...fallbackContent, ...next });
      } catch {
        setContent(fallbackContent);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const resolvedDownloadUrl = useMemo(
    () => (content.downloadUrl || content.apkUrl || "").trim(),
    [content.downloadUrl, content.apkUrl]
  );

  const canDownload = useMemo(
    () => content.enabled !== false && !!resolvedDownloadUrl,
    [content.enabled, resolvedDownloadUrl]
  );

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-white to-[#f6f7fb]">
      <UnifiedTopNavBar />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <section className="rounded-3xl border border-gray-200 bg-white shadow-sm p-6 sm:p-10">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold tracking-[0.18em] uppercase text-[#8B1C1C]">Mobile App</p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-[#1f1f1f]">{content.heroTitle || fallbackContent.heroTitle}</h1>
            <p className="mt-4 text-gray-600 text-sm sm:text-base leading-relaxed">
              {content.heroDescription || fallbackContent.heroDescription}
            </p>
          </div>

          <div className="mt-8 rounded-2xl border border-gray-200 bg-[#fafafa] p-5 sm:p-6">
            <h2 className="text-xl font-semibold text-[#1f1f1f]">{content.cardTitle || fallbackContent.cardTitle}</h2>
            <p className="text-sm text-gray-600 mt-2">{content.cardDescription || fallbackContent.cardDescription}</p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg bg-white border px-3 py-2">
                <span className="text-gray-500">Version</span>
                <div className="font-semibold text-gray-900">{content.apkVersion || "N/A"}</div>
              </div>
              <div className="rounded-lg bg-white border px-3 py-2">
                <span className="text-gray-500">File Size</span>
                <div className="font-semibold text-gray-900">{content.apkSize || "N/A"}</div>
              </div>
              <div className="rounded-lg bg-white border px-3 py-2">
                <span className="text-gray-500">File Name</span>
                <div className="font-semibold text-gray-900 truncate">{content.apkFileName || "N/A"}</div>
              </div>
            </div>

            <div className="mt-6">
              {canDownload ? (
                <a
                  href={resolvedDownloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-xl bg-[#8B1C1C] px-6 py-3 text-white font-semibold hover:bg-[#741717] transition-colors"
                >
                  {content.buttonLabel || "Open Download Link"}
                </a>
              ) : (
                <button
                  disabled
                  className="inline-flex items-center justify-center rounded-xl bg-gray-300 px-6 py-3 text-white font-semibold cursor-not-allowed"
                >
                  Download Link Not Available
                </button>
              )}
            </div>

            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="font-semibold text-gray-900">Release Notes</h3>
              <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{content.releaseNotes || "No notes available."}</p>
            </div>
          </div>

          {loading && <p className="mt-4 text-sm text-gray-500">Loading latest download details...</p>}
        </section>
      </main>

      <Footer />
    </div>
  );
}
