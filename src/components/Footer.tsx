"use client";

import Link from "next/link";
import { FaFacebookF } from "react-icons/fa";
import { FiPhone } from "react-icons/fi";
import { useEffect, useState } from "react";

export default function Footer() {
  const [chromeSettings, setChromeSettings] = useState({
    footerFacebookUrl: "https://facebook.com/grandlink",
    footerPhoneText: "Smart || 09082810586 Globe (Viber) || 09277640475",
    footerInquireLabel: "INQUIRE NOW",
    footerInquireLink: "/Inquire",
  });

  useEffect(() => {
    const loadChromeSettings = async () => {
      try {
        const res = await fetch("/api/home", { cache: "no-store" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const content = (payload?.content ?? payload ?? {}) as Record<string, any>;
        setChromeSettings((prev) => ({
          ...prev,
          footerFacebookUrl: String(content.footerFacebookUrl || prev.footerFacebookUrl),
          footerPhoneText: String(content.footerPhoneText || prev.footerPhoneText),
          footerInquireLabel: String(content.footerInquireLabel || prev.footerInquireLabel),
          footerInquireLink: String(content.footerInquireLink || prev.footerInquireLink),
        }));
      } catch {
        // keep defaults
      }
    };

    loadChromeSettings();
  }, []);

  return (
    <footer className="bg-[#f5f5f5] pt-8">
      <div className="max-w-6xl mx-auto px-4">
        <h2 className="text-lg font-semibold mb-6 text-black">Quick Links</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pb-8">
          <div>
            <h3 className="font-bold mb-2 text-black">About Us</h3>
            <ul>
              <li>
                <Link
                  href="/showroom"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Showroom
                </Link>
              </li>
              <li>
                <Link
                  href="/locations"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Locations
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-bold mb-2 text-black">Services We Offer</h3>
            <ul>
              <li>
                <Link
                  href="/services"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  List of Services
                </Link>
              </li>
              <li>
                <Link
                  href="/Featured"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Featured Projects
                </Link>
              </li>
              <li>
                <Link
                  href="/order-process"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Delivery & Order Process
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-bold mb-2 text-black">Products</h3>
            <ul>
              <li>
                <Link
                  href="/Product"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  All Products
                </Link>
              </li>
              <li>
                <Link
                  href="/Product?category=Doors"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Doors
                </Link>
              </li>
              <li>
                <Link
                  href="/Product?category=Windows"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Windows
                </Link>
              </li>
              <li>
                <a
                  href="/Product?category=Enclosure"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Enclosure
                </a>
              </li>
              <li>
                <a
                  href="/Product?category=Casement"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Casement
                </a>
              </li>
              <li>
                <a
                  href="/Product?category=Sliding"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Sliding
                </a>
              </li>
              <li>
                <a
                  href="/Product?category=Railings"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Railings
                </a>
              </li>
              <li>
                <a
                  href="/Product?category=Canopy"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Canopy
                </a>
              </li>
              <li>
                <a
                  href="/Product?category=Curtain Wall"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  Curtain Wall
                </a>
              </li>
            <ul>
              <li>
                <a
                  href="/FAQs"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  FAQs
                </a>
              </li>
                </ul>
            </ul>
          </div>
          <div>
             <div>
          <ul>
              <h3 className="font-bold mb-2 text-black">FAQs</h3>
              <li>
                <a
                  href="/FAQs"
                  className="text-gray-400 font-semibold hover:text-[#232d3b] transition-colors cursor-pointer"
                >
                  FAQs
                </a>
              </li>
                </ul>
                </div>
          </div>
        </div>
      </div>
      <div className="bg-[#232d3b] py-4 px-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:grid md:grid-cols-[1fr_auto] md:items-center">
          <div className="flex flex-wrap items-center justify-center gap-4 text-center md:justify-start md:gap-6">
            <a href={chromeSettings.footerFacebookUrl || "https://www.facebook.com/grandeast.aluminum/"} target="_blank" rel="noopener noreferrer" aria-label="Facebook page">
              <FaFacebookF className="text-white text-2xl bg-[#4267B2] rounded p-1 w-8 h-8 flex items-center justify-center" />
            </a>
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white">
              <FiPhone className="text-[#232d3b] text-2xl" />
            </span>
            <span className="text-white text-lg text-center">
              {chromeSettings.footerPhoneText}
            </span>
          </div>

          <div className="flex justify-end">
            <a
              href={chromeSettings.footerInquireLink || "/Inquire"}
              className="bg-[#8B1C1C] text-white px-8 py-2 rounded font-semibold hover:bg-[#a83232] transition text-sm inline-block"
            >
              {chromeSettings.footerInquireLabel || "INQUIRE NOW"}
            </a>
          </div>
        </div>
      </div>
        <div className="bg-[#1b2230] py-2 px-4 text-center text-xs text-gray-300">
        © {new Date().getFullYear()} Grand East. GRAND EAST™ and related marks are trademarks of their respective owners.
      </div>
    </footer>
  );
}