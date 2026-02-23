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
    <div className="py-10">
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 px-4">
        {projects.map((p) => (
          <motion.div
            key={p.id}
            whileHover={{ scale: 1.05 }}
            className="cursor-pointer bg-white rounded-lg shadow border border-gray-200 overflow-hidden"
            onClick={() => setSelected(p)}
          >
            <Image
              src={p.image_url || "/placeholder.jpg"}
              alt={p.title}
              width={400}
              height={300}
              className="w-full h-40 object-cover"
            />
            <div className="bg-white px-3 py-2">
              <div className="text-sm font-semibold text-gray-900 truncate">{p.title}</div>
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
    <div className="flex flex-col min-h-screen bg-[#232d3b]">
      <UnifiedTopNavBar />
      <main className="flex-1">
        <FeaturedProjectsContent />
      </main>
      <Footer />
    </div>
  );
}

