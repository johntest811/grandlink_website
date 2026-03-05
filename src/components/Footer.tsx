"use client";

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
    <footer className="bg-[#f5f5f5] border-t border-gray-200">
      <div className="max-w-6xl mx-auto px-4 pt-8 pb-6">
        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 pb-6 border-b border-gray-200">
            <div>
              <h2 className="text-2xl font-bold text-[#232d3b]">Grand East</h2>
              <p className="text-sm text-gray-600 mt-1">Doors, windows, glass, and custom aluminum solutions.</p>
            </div>
            <a
              href={chromeSettings.footerInquireLink || "/Inquire"}
              className="bg-[#8B1C1C] text-white px-6 py-2 rounded font-semibold hover:bg-[#a83232] transition text-sm inline-block"
            >
              {chromeSettings.footerInquireLabel || "INQUIRE NOW"}
            </a>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 pt-6">
            <div>
              <h3 className="font-bold mb-3 text-[#232d3b]">About Us</h3>
              <ul className="space-y-2">
                <li>
                  <a href="/showroom" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Showroom
                  </a>
                </li>
                <li>
                  <a href="/locations" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Locations
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold mb-3 text-[#232d3b]">Services</h3>
              <ul className="space-y-2">
                <li>
                  <a href="/services" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    List of Services
                  </a>
                </li>
                <li>
                  <a href="/Featured" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Featured Projects
                  </a>
                </li>
                <li>
                  <a href="/order-process" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Delivery & Order Process
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold mb-3 text-[#232d3b]">Products</h3>
              <ul className="space-y-2">
                <li>
                  <a href="/Product" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    All Products
                  </a>
                </li>
                <li>
                  <a href="/Product?category=Doors" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Doors
                  </a>
                </li>
                <li>
                  <a href="/Product?category=Windows" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Windows
                  </a>
                </li>
                <li>
                  <a href="/Product?category=Enclosure" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Enclosure
                  </a>
                </li>
                <li>
                  <a href="/Product?category=Casement" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Casement
                  </a>
                </li>
                <li>
                  <a href="/Product?category=Sliding" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Sliding
                  </a>
                </li>
                <li>
                  <a href="/Product?category=Railings" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Railings
                  </a>
                </li>
                <li>
                  <a href="/Product?category=Canopy" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Canopy
                  </a>
                </li>
                <li>
                  <a href="/Product?category=Curtain Wall" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    Curtain Wall
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold mb-3 text-[#232d3b]">Help</h3>
              <ul className="space-y-2">
                <li>
                  <a href="/FAQs" className="text-gray-600 font-medium hover:text-[#232d3b] transition-colors">
                    FAQs
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#232d3b] py-4 px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-white text-sm">
            <a
              href={chromeSettings.footerFacebookUrl || "https://www.facebook.com/grandeast.aluminum/"}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook page"
            >
              <FaFacebookF className="text-white text-xl bg-[#4267B2] rounded p-1 w-7 h-7" />
            </a>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white">
              <FiPhone className="text-[#232d3b] text-lg" />
            </span>
            <span>{chromeSettings.footerPhoneText}</span>
          </div>
          <a
            href={chromeSettings.footerInquireLink || "/Inquire"}
            className="bg-[#8B1C1C] text-white px-6 py-2 rounded font-semibold hover:bg-[#a83232] transition text-sm"
          >
            {chromeSettings.footerInquireLabel || "INQUIRE NOW"}
          </a>
        </div>
      </div>

      <div className="bg-[#1b2230] py-2 px-4 text-center text-xs text-gray-300">
        © {new Date().getFullYear()} Grand East. GRAND EAST™ and related marks are trademarks of their respective owners.
      </div>
    </footer>
  );
}