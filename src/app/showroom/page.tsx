"use client";
//import { createClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import { supabase } from "../Clients/Supabase/SupabaseClients";

type Showroom = {
  id: number;
  title: string;
  address: string;
  description: string;
  image?: string;
};

function normalizeRichText(input?: string) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (/<[a-z][\s\S]*>/i.test(value)) return value;
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
}

function Expandable({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      if (open) {
        ref.current.style.height = ref.current.scrollHeight + "px";
      } else {
        ref.current.style.height = "0px";
      }
    }
  }, [open]);

  return (
    <div
      ref={ref}
      style={{ height: "0px" }}
      className="overflow-hidden transition-[height] duration-500 ease-in-out"
    >
      <div className="p-2">{children}</div>
    </div>
  );
}

export default function ShowroomPage() {
  const [showrooms, setShowrooms] = useState<Showroom[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [selectedShowroom, setSelectedShowroom] = useState<Showroom | null>(null);
  const [zoom, setZoom] = useState<number>(1);

  useEffect(() => {
    fetchShowrooms();
  }, []);

  const fetchShowrooms = async () => {
    const { data, error } = await supabase.from("showrooms").select("*");
    if (error) console.error("Error fetching showrooms:", error.message);
    else setShowrooms(data || []);
  };

  const toggle = (id: number) => setOpenIndex(openIndex === id ? null : id);

  const openModal = (showroom: Showroom) => {
    setSelectedShowroom(showroom);
    setZoom(1);
  };

  const closeModal = () => {
    setSelectedShowroom(null);
    setZoom(1);
  };

  const clampZoom = (value: number) => Math.max(1, Math.min(3, value));
  const zoomIn = () => setZoom((z) => clampZoom(Number((z + 0.25).toFixed(2))));
  const zoomOut = () => setZoom((z) => clampZoom(Number((z - 0.25).toFixed(2))));
  const zoomReset = () => setZoom(1);

  useEffect(() => {
    if (!selectedShowroom) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [selectedShowroom]);

  const chunked: Showroom[][] = [];
  for (let i = 0; i < showrooms.length; i += 3) chunked.push(showrooms.slice(i, i + 3));

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <UnifiedTopNavBar />
      <main className="flex-1 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <h2 className="text-center text-3xl font-extrabold leading-tight text-black">
            Visit us
            <br />
            <span className="inline-block mt-1">at our Showroom Locations</span>
          </h2>
          <div className="w-16 h-1 bg-red-600 mx-auto mt-3 mb-10 rounded-full" />

          {chunked.map((row, rowIdx) => (
            <div key={rowIdx} className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch mb-10">
              {row.map((s) => {
                const isOpen = openIndex === s.id;
                const normalizedDescription = normalizeRichText(s.description);
                return (
                  <article
                    key={s.id}
                    className="rounded-xl border border-gray-200 shadow-sm bg-white overflow-hidden flex flex-col h-[600px] max-w-[350px] mx-auto"
                  >
                    <div className="w-full h-[350px] flex items-center justify-center bg-gray-100">
                      {s.image && (
                        <button
                          type="button"
                          onClick={() => openModal(s)}
                          className="w-full h-full"
                          aria-label={`Open image for ${s.title}`}
                        >
                          <img
                            src={s.image}
                            alt={s.title}
                            className="w-full h-full object-cover object-center cursor-zoom-in"
                            style={{ aspectRatio: "4/3" }}
                          />
                        </button>
                      )}
                    </div>
                    <div className="p-4 flex-1 flex flex-col items-center justify-start">
                      <h3 className="text-center text-lg font-bold text-[#B11C1C] mb-2">{s.title}</h3>
                      <p className="text-center text-base text-black mb-2">{s.address}</p>
                      {!isOpen ? (
                        <div
                          className="blog-content mt-1 text-base text-gray-700 min-h-[72px] max-h-[120px] overflow-hidden [&_*]:text-inherit"
                          dangerouslySetInnerHTML={{ __html: normalizedDescription }}
                        />
                      ) : (
                        <div
                          className="blog-content mt-1 text-base text-black min-h-[72px] [&_*]:text-inherit"
                          dangerouslySetInnerHTML={{ __html: normalizedDescription }}
                        />
                      )}
                      <Expandable open={isOpen} children={undefined}>
                        {/* You can add more details here if needed */}
                      </Expandable>
                      <button
                        onClick={() => toggle(s.id)}
                        className="mt-2 text-red-600 font-semibold text-sm hover:underline"
                      >
                        {isOpen ? "Show Less" : "Show More"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ))}
        </div>
      </main>
      <Footer />

      {selectedShowroom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Showroom image preview"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="w-full max-w-5xl bg-white rounded-xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-semibold text-black truncate">
                  {selectedShowroom.title}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={zoom <= 1}
                  className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-50"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={zoom >= 3}
                  className="px-3 py-1.5 rounded-md border border-gray-300 text-sm disabled:opacity-50"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={zoomReset}
                  className="px-3 py-1.5 rounded-md border border-gray-300 text-sm"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="ml-2 px-3 py-1.5 rounded-md bg-[#B11C1C] text-white text-sm"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
              <div
                className="bg-gray-50 flex items-center justify-center p-4 max-h-[70vh] overflow-auto"
                onWheel={(e) => {
                  if (!e.ctrlKey) return;
                  e.preventDefault();
                  const delta = e.deltaY > 0 ? -0.1 : 0.1;
                  setZoom((z) => clampZoom(Number((z + delta).toFixed(2))));
                }}
              >
                {selectedShowroom.image ? (
                  <img
                    src={selectedShowroom.image}
                    alt={selectedShowroom.title}
                    className="max-w-full h-auto origin-center transition-transform duration-150"
                    style={{ transform: `scale(${zoom})` }}
                    draggable={false}
                  />
                ) : (
                  <div className="text-gray-600">No image</div>
                )}
              </div>

              <div className="p-5 overflow-auto max-h-[70vh]">
                <div className="text-sm font-semibold text-black">Description</div>
                <div
                  className="blog-content mt-2 text-sm sm:text-base text-gray-800 [&_*]:text-inherit"
                  dangerouslySetInnerHTML={{ __html: normalizeRichText(selectedShowroom.description) }}
                />
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 text-xs text-gray-600">
              Tip: Hold Ctrl and scroll to zoom.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
