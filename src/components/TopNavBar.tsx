import Image from "next/image";
import { FaEnvelope, FaThumbsUp, FaPhone } from "react-icons/fa";
import { useState } from "react";

export default function TopNavBar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Header */}
      <header className="w-full bg-white flex items-center justify-between px-4 py-2 shadow z-10">
        <div className="flex items-center gap-2 mb-3 mt-3">
          <Image src="/ge-logo.avif" alt="Grand East Logo" width={170} height={170}/>
        </div>
        <div className="flex items-center gap-2">
          {/* hamburger for small screens */}
          <button
            className="md:hidden p-2 rounded hover:bg-gray-100"
            aria-expanded={mobileOpen}
            aria-label="Toggle site menu"
            onClick={() => setMobileOpen((s) => !s)}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <button className="hidden md:inline-block bg-[#8B1C1C] text-white px-4 py-2 rounded font-semibold hover:bg-[#a83232] transition">
            INQUIRE NOW
          </button>
        </div>
      </header>
      {/* Mobile menu */}
      {mobileOpen && (
        <nav className="md:hidden bg-white border-t shadow-sm">
          <div className="px-4 py-3 flex flex-col gap-2">
            <a href="/home" className="py-2">Home</a>
            <a href="/about-us" className="py-2">About</a>
            <a href="/services" className="py-2">Services</a>
            <a href="/Product" className="py-2">Products</a>
            <a href="/FAQs" className="py-2">FAQs</a>
          </div>
        </nav>
      )}
      {/* Contact Bar */}
      <div className="w-full bg-[#232d3b] text-white flex flex-col sm:flex-row items-center justify-center gap-4 py-2 px-2 text-xs sm:text-sm z-10">
        <div className="flex items-center gap-1">
          <FaEnvelope className="text-base" /> grandeast.org@gmail.com
        </div>
        <span className="hidden sm:inline">|</span>
        <div className="flex items-center gap-1">
          <FaThumbsUp className="text-base" /> Click here visit to our FB Page
        </div>
        <span className="hidden sm:inline">|</span>
        <div className="flex items-center gap-1">
          <FaPhone className="text-base" /> Smart | 09082810586 Globe (Viber) | 09277640475
        </div>
      </div>
    </>
  );
}