'use client';

import { useEffect, useState } from 'react';
import { supabase } from "../Clients/Supabase/SupabaseClients";
import UnifiedTopNavBar from '@/components/UnifiedTopNavBar';
import Footer from '@/components/Footer';
import Link from 'next/link';

type Warranty = {
  id: number;
  title: string;
  description: string;
};

export default function DeliveryPage() {
  const [steps, setSteps] = useState<Warranty[]>([]);

  useEffect(() => {
    const fetchSteps = async () => {
      const { data, error } = await supabase
        .from('warranties')
        .select('*')
        .order('id', { ascending: true });
      if (error) {
        console.error('Error fetching delivery steps:', error.message);
      } else {
        setSteps(data || []);
      }
    };
    fetchSteps();
  }, []);

  return (
    <div className="bg-white text-gray-800 min-h-screen flex flex-col gl-page-shell">
      <UnifiedTopNavBar />

      <main className="flex-1 gl-page-main">

      {/* Hero */}
      <section className="text-center py-12 bg-gray-100 gl-hero-stage gl-reveal">
        <h1 className="text-3xl font-bold border-b-4 border-red-700 inline-block pb-2">
          Delivery & Ordering Process
        </h1>
      </section>

      {/* Steps */}
      <section
        className="relative py-12 px-6 bg-cover bg-center gl-reveal gl-reveal-delay-1"
        style={{ backgroundImage: "url('/Delivery&Ordering.avif')" }} // replace with your background
      >
        <div className="bg-white/90 max-w-4xl mx-auto rounded-lg shadow-lg p-8 gl-outline-panel">
          <div className="grid md:grid-cols-2 gap-6">
            {steps.map((step, idx) => (
              <div key={step.id} className="flex items-start gap-4 gl-card-lift rounded-lg p-2">
                <span className="text-red-700 text-3xl font-bold">
                  {idx + 1}
                </span>
                <div>
                  <h3 className="font-bold text-lg">{step.title}</h3>
                  <p className="text-gray-700">{step.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Warranty Note */}
          <div className="mt-8 text-sm text-gray-600 border-t pt-4">
            <strong>Service Warranty Note:</strong> Warranty does not cover
            damages from natural disasters (e.g., earthquakes, tsunamis,
            typhoons) or other uncontrollable events. The signed shop drawing’s
            design and measurements will be strictly followed. Additional fees
            may apply for post-warranty maintenance or repairs of window and
            door parts.
          </div>
        </div>
      </section>

      {/* CTA to Inquiry */}
      <section className="bg-red-800 text-white py-10 text-center gl-reveal gl-reveal-delay-2">
        <h2 className="text-xl font-semibold">
          Can’t find the answer to your question?
        </h2>
        <Link
          href="/Inquire"
          className="mt-4 inline-block bg-white text-red-700 font-bold px-6 py-3 rounded shadow hover:bg-gray-100 transition"
        >
          Contact Us Now!
        </Link>
      </section>

      </main>

      <Footer />
    </div>
  );
}
