import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import type { IconType } from "react-icons";
import * as FaIcons from "react-icons/fa";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

type Service = {
  id: number;
  name: string;
  short_description: string;
  long_description: string;
  icon?: string | null;
  icon_url?: string | null;
};

const getIconComponent = (iconName?: string | null): IconType => {
  const icons = FaIcons as unknown as Record<string, IconType>;
  if (!iconName) return FaIcons.FaCogs;
  return icons[iconName] || FaIcons.FaCogs;
};

export default async function ServiceDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const serviceId = Number.parseInt(id, 10);
  if (!Number.isFinite(serviceId)) notFound();

  const { data, error } = await supabase
    .from("services")
    .select("*")
    .eq("id", serviceId)
    .limit(1)
    .single();

  if (error || !data) notFound();

  const service = data as Service;

  const IconComponent = getIconComponent(service.icon);

  const paragraphs = (service.long_description || "")
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <UnifiedTopNavBar />

      <main className="flex-1">
        <section className="max-w-5xl mx-auto px-6 py-10">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#232d3b] text-white flex items-center justify-center overflow-hidden">
                {service.icon_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={service.icon_url}
                    alt={service.name}
                    className="w-full h-full object-contain p-2 bg-white"
                  />
                ) : (
                  <IconComponent size={30} />
                )}
              </div>
              <div>
                <h1 className="text-3xl md:text-4xl font-extrabold text-[#232d3b]">
                  {service.name}
                </h1>
                <p className="text-gray-600 mt-1">{service.short_description}</p>
              </div>
            </div>

            <Link
              href="/services"
              className="inline-flex items-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-[#232d3b] hover:bg-gray-50"
            >
              ← Back to Services
            </Link>
          </div>

          <div className="mt-8 bg-white border border-gray-200 rounded-2xl shadow-sm p-6 md:p-8">
            {paragraphs.length ? (
              <div className="space-y-4">
                {paragraphs.map((p, idx) => (
                  <p key={idx} className="text-gray-700 leading-relaxed">
                    {p}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-gray-600">No details available yet.</p>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
