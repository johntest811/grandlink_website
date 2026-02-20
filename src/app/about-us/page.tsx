"use client";
import { useEffect, useState } from "react";
import { supabase } from "../Clients/Supabase/SupabaseClients";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import Image from "next/image";

export default function AboutUsPage() {
  const [about, setAbout] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      const { data, error } = await supabase.from("about").select("*").single();
      if (!error) setAbout(data);
    };
    fetchData();
  }, []);

  if (!about) return <p className="text-center mt-10">Loading...</p>;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <UnifiedTopNavBar />
      <main className="flex-1 bg-white">
        {/* Hero Section */}
        <section className="relative w-full h-[320px] md:h-[400px] flex flex-col justify-center items-center bg-[#232d3b]">
          <div className="absolute inset-0 z-0">
            <Image
              src="/aboutus.avif"
              alt="About Us Hero"
              fill
              className="object-cover opacity-60"
              priority
            />
          </div>
          <div className="relative z-10 flex flex-col items-center justify-center h-full w-full">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-2 mt-8">
              About Us
            </h2>
            <div className="w-16 h-1 bg-[#8B1C1C] mb-4"></div>
            <p className="text-xl italic text-white">
              High Quality, Long lasting performance
            </p>
          </div>
        </section>

        {/* Logo and Description */}
        <section className="py-10 px-4 bg-white flex flex-col items-center">
          {/* <Image
            src="/GE Logo.avif"
            alt="Grand East Logo"
            width={220}
            height={120}
            className="mb-4"
          /> */}
          <div className="max-w-4xl mx-auto text-center">
            <h3 className="text-3xl font-extrabold text-gray-900 mb-4">
              {about.grand}
            </h3>
            <div
              className="blog-content text-lg text-gray-700 leading-relaxed text-left md:text-center"
              dangerouslySetInnerHTML={{ __html: about.description || "" }}
            />
          </div>
        </section>


        {/* Mission & Vision Section */}
        <section className="flex flex-col md:flex-row w-full">
          <div
            className="flex-1 flex flex-col justify-center items-center px-8 py-16"
            style={{
              backgroundColor: "#8B1C1C",
              minHeight: "174px",
            }}
          >
            <div className="w-full h-full flex flex-col justify-center items-center">
              <h4 className="text-4xl font-normal mb-4 tracking-tight text-center text-white max-w-lg mx-auto">
                MISSION
              </h4>
              <div
                className="blog-content blog-content-light text-center text-xl font-normal text-white max-w-lg mx-auto leading-snug"
                dangerouslySetInnerHTML={{ __html: about.mission || "" }}
              />
            </div>
          </div>
          <div
            className="flex-1 flex flex-col justify-center items-center px-8 py-16"
            style={{
              backgroundColor: "#232d3b",
              minHeight: "174px",
            }}
          >
            <div className="w-full h-full flex flex-col justify-center items-center">
              <h4 className="text-4xl font-normal mb-4 tracking-tight text-center text-white max-w-lg mx-auto">
                VISION
              </h4>
              <div
                className="blog-content blog-content-light text-center text-xl font-normal text-white max-w-lg mx-auto leading-snug"
                dangerouslySetInnerHTML={{ __html: about.vision || "" }}
              />
            </div>
          </div>
        </section>

        {/* Call to Action Section */}
        <section
          className="py-8 px-4"
          style={{
            backgroundImage: "url('/aboutus.avif')", // <-- your image path here
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="bg-[#f8f9fa] rounded flex flex-col md:flex-row items-center justify-between max-w-6xl mx-auto px-8 py-8">
            <div>
              <h3 className="text-2xl font-bold text-[#8B1C1C] mb-2">
                Ready to elevate your space?
              </h3>
              <p className="text-2xl text-[#232d3b]">
                Inquire now for a custom solution!
              </p>
            </div>
            <a
              href="/Inquire"
              className="mt-6 md:mt-0 bg-[#8B1C1C] text-white font-semibold px-10 py-5 rounded text-lg flex items-center gap-2 hover:bg-[#a82c2c] transition"
            >
              CONTACT US NOW
              <svg
                width="28"
                height="28"
                fill="none"
                stroke="white"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M22 16.92V19a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3 5.18 2 2 0 0 1 5 3h2.09a2 2 0 0 1 2 1.72c.13 1.13.37 2.23.72 3.28a2 2 0 0 1-.45 2.11l-1.27 1.27a16 16 0 0 0 6.29 6.29l1.27-1.27a2 2 0 0 1 2.11-.45c1.05.35 2.15.59 3.28.72a2 2 0 0 1 1.72 2z" />
              </svg>
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}