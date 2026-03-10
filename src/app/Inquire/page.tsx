'use client';

import { useEffect, useState } from 'react';
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

export default function InquirePage() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    service: '',
    message: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // content for left column (editable via admin)
  const [title, setTitle] = useState('Inquire Now');
  const [description, setDescription] = useState(
    "We’re happy to help you bring your vision to life. Kindly provide us with your requirements and contact information below. Our team will get back to you as soon as possible."
  );
  const [phone, setPhone] = useState("0927‑574‑9475");
  const [emailContact, setEmailContact] = useState("grand‑east@gmail.com");
  const [facebook, setFacebook] = useState("facebook.com/grandeast");

  useEffect(() => {
    let mounted = true;
    const loadContent = async () => {
      try {
        const { data, error } = await supabase
          .from("inqruire_content")
          .select("title, description, phone, email, facebook")
          .limit(1)
          .maybeSingle();
        if (error) {
          console.warn("Could not load inquire content", error);
          return;
        }
        if (!mounted) return;
        if (data?.title) setTitle(data.title);
        if (data?.description) setDescription(data.description);
        if (data?.phone) setPhone(data.phone);
        if (data?.email) setEmailContact(data.email);
        if (data?.facebook) setFacebook(data.facebook);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("load inquire content", err);
      }
    };
    loadContent();
    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!formData.firstName.trim() || !formData.lastName.trim() || !formData.service) {
      alert("Please fill required fields.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = (userData as any)?.user?.id ?? null;

      const payload = {
        user_id: userId,
        first_name: formData.firstName.trim(),
        last_name: formData.lastName.trim(),
        email: formData.email.trim() || null,
        phone: formData.phone.trim() || null,
        inquiry_type: formData.service,
        message: formData.message.trim() || null,
      };

      const { data, error } = await supabase.from("inquiries").insert([payload]).select();

      if (error) {
        // eslint-disable-next-line no-console
        console.error("inquiry insert error", error);
        alert("Could not send inquiry. Please try again.");
      } else {
        setFormData({ firstName: '', lastName: '', email: '', phone: '', service: '', message: '' });
        alert("Thank you — your inquiry was sent. We'll get back to you shortly.");
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("unexpected error sending inquiry", err);
      alert("Could not send inquiry. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white text-black">
      <UnifiedTopNavBar />

      <section className="py-12 px-4 max-w-6xl mx-auto">
        <div className="bg-white shadow-lg rounded-xl p-8 grid md:grid-cols-2 gap-8 items-start">
          {/* LEFT SIDE: Title + description (loaded from inqruire_content) */}
          <div>
            <h2 className="text-3xl font-bold text-red-700 mb-4">{title}</h2>
            <p className="text-black text-base leading-relaxed">
              {description}
            </p>

            <div className="mt-6 text-sm text-black space-y-1">
              <p><strong>Phone:</strong> {phone}</p>
              <p><strong>Email:</strong> {emailContact}</p>
              <p><strong>Facebook:</strong> {facebook}</p>
            </div>
          </div>

          {/* RIGHT SIDE: Form (unchanged layout) */}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-2 gap-4">
              <input
                name="firstName"
                onChange={handleChange}
                value={formData.firstName}
                required
                className="border rounded-lg p-3"
                placeholder="First Name"
              />
              <input
                name="lastName"
                onChange={handleChange}
                value={formData.lastName}
                required
                className="border rounded-lg p-3"
                placeholder="Last Name"
              />
            </div>
            <input
              name="email"
              onChange={handleChange}
              value={formData.email}
              type="email"
              className="border rounded-lg p-3"
              placeholder="Email"
            />
            <input
              name="phone"
              onChange={handleChange}
              value={formData.phone}
              className="border rounded-lg p-3"
              placeholder="Phone"
            />
            <select
              name="service"
              onChange={handleChange}
              value={formData.service}
              required
              className="border rounded-lg p-3"
            >
              <option value="">What is your inquiry about?</option>
              <option value="Doors">Doors</option>
              <option value="Windows">Windows</option>
              <option value="Enclosure">Enclosure</option>
              <option value="Casement">Casement</option>
              <option value="Sliding">Sliding</option>
              <option value="Railings">Railings</option>
              <option value="Canopy">Canopy</option>
              <option value="Curtain Wall">Curtain Wall</option>
              <option value="Custom Design">Custom Design</option>
            </select>
            <textarea
              name="message"
              onChange={handleChange}
              value={formData.message}
              rows={4}
              className="border rounded-lg p-3"
              placeholder="Message"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-red-700 text-white rounded-lg py-3 px-6 hover:bg-red-800 disabled:opacity-60"
            >
              {isSubmitting ? "Sending…" : "Send"}
            </button>
          </form>
        </div>
      </section>

      <section className="my-12 h-[700px]">
        <iframe
          title="Google Maps"
          data-src=""
          width="100%"
          height="100%"
          frameBorder="0"
          scrolling="no"
          allowFullScreen
          src="https://static.parastorage.com/services/editor-elements-library/dist/thunderbolt/media/googleMap.1fabcae9.html?defaultLocation=0&showZoom=true&showStreetView=true&showMapType=true&language=en&id=dataItem-m162bqu2&googleMapsScriptPath=%2Fservices%2Feditor-elements-library%2Fdist%2Fthunderbolt%2Fmedia%2Fgoogle-map.min.5d8ab435.js&origin=https%3A%2F%2Fwww.grandeast.ph&hasFocus=true"
          className="w-full h-full border-none"
        ></iframe>
      </section>

      <div className="h-[250px] bg-cover bg-center opacity-80" style={{ backgroundImage: "url('/images/city-night.jpg')" }}></div>

      <Footer />
    </div>
  );
}
