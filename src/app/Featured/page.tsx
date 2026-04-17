"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../Clients/Supabase/SupabaseClients";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";

interface Project {
  id: number;
  title: string;
  description: string;
  image_url?: string;
  link_url?: string;
}

function FeaturedProjectsContent() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);

  useEffect(() => {
    async function fetchProjects() {
      const { data, error } = await supabase.from("featured_projects").select("*");
      if (error) console.error(error);
      else setProjects(data || []);
    }
    fetchProjects();
  }, []);

  const content = (
    <div className="py-10 gl-page-main">
      <h2 className="text-3xl font-bold text-center mb-2 text-white">Featured Projects</h2>
      <div className="h-1 w-20 bg-[#B11C1C] mx-auto mb-6" />
      <p className="text-center text-gray-300 max-w-2xl mx-auto mb-10">
        Our featured projects showcase the quality, precision, and innovation that define Grand East .
        From sleek residential transformations to large-scale commercial installations, 
        these projects highlight our commitment to delivering exceptional results. 
        Each project is a testament to our craftsmanship, attention to detail, 
        and dedication to client satisfaction. Explore the success stories we’re 
        proud to share and see how we’ve helped bring our clients' visions to life.
      </p>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 px-4">
        {projects.map((p) => (
          <motion.div
            key={p.id}
            whileHover={{ scale: 1.03 }}
            className="group cursor-pointer rounded-xl shadow-lg border border-gray-200 overflow-hidden gl-card-lift"
            onClick={() => setSelected(p)}
          >
            <div className="relative w-full aspect-[5/4] min-h-[250px] bg-gray-100 overflow-hidden">
              <Image
                src={p.image_url || "/placeholder.jpg"}
                alt={p.title}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <div className="text-base sm:text-lg font-semibold text-white leading-tight line-clamp-2">
                  {p.title}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selected && (
          <motion.div
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelected(null)}
          >
            <motion.div
              className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 relative"
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <Image
                src={selected.image_url || "/placeholder.jpg"}
                alt={selected.title}
                width={600}
                height={400}
                className="rounded-lg mb-4 w-full object-cover"
              />
              <h3 className="text-xl font-bold text-gray-800">{selected.title}</h3>
              <p className="text-gray-600 my-2">{selected.description}</p>
              {selected.link_url && (
                <a
                  href={selected.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 font-semibold underline"
                >
                  View Project
                </a>
              )}
              <button
                onClick={() => setSelected(null)}
                className="absolute top-2 right-2 text-gray-600 hover:text-red-500 text-lg"
              >
                ✕
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  
  return <section className="bg-[#232d3b] text-white">{content}</section>;
}

export default function FeaturedProjectsPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#232d3b] gl-page-shell-dark">
      <UnifiedTopNavBar />
      <main className="flex-1 gl-page-main">
        <div className="gl-reveal">
          <FeaturedProjectsContent />
        </div>
      </main>
      <Footer />
    </div>
  );
}

