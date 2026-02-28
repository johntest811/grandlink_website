"use client";
import { useEffect, useState } from "react";
import { supabase } from "../Clients/Supabase/SupabaseClients";
import UnifiedTopNavBar from "@/components/UnifiedTopNavBar";
import Footer from "@/components/Footer";

interface FAQCategory {
  id: number;
  name: string;
  faq_questions: {
    id: number;
    question: string;
    answer: string;
  }[];
}

export default function FAQsPage() {
  const [categories, setCategories] = useState<FAQCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [openQuestion, setOpenQuestion] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const fetchFaqs = async () => {
      const { data, error } = await supabase
        .from("faq_categories")
        .select(`
          id,
          name,
          faq_questions (
            id,
            question,
            answer
          )
        `)
        .order("id", { ascending: true });

      if (!error && data) {
        setCategories(data);
        if (data.length > 0) setActiveCategory(data[0].id);
      } else {
        console.error(error);
      }
    };

    fetchFaqs();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <UnifiedTopNavBar />

      <main className="flex-1">
        {/* Hero Section */}
        <section
          className="relative h-72 flex items-center justify-center text-center"
          style={{
            backgroundImage: "url('/faqs.avif')",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/70"></div>
          <div className="relative z-10 px-6">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-wide">
              FAQs
            </h1>
            <p className="text-gray-200 mt-2 text-lg">
              Find quick answers to your most common questions
            </p>
          </div>
        </section>

        {/* FAQs Section */}
        <section className="py-12 px-6">
          <div className="bg-white max-w-5xl mx-auto p-8 shadow-xl rounded-2xl">
            <h2 className="text-3xl font-bold text-center mb-8 text-gray-900">
              Frequently Asked Questions
            </h2>

            {/* Search */}
            <div className="max-w-2xl mx-auto mb-8">
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Search FAQs
              </label>
              <div className="relative">
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOpenQuestion(null);
                  }}
                  placeholder="Search by keyword (e.g., delivery, payment, warranty)"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300"
                />
                {search.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setOpenQuestion(null);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500 hover:text-red-600"
                  >
                    Clear
                  </button>
                )}
              </div>
              {search.trim().length > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                  Showing results across all categories. Clear search to browse by category.
                </p>
              )}
            </div>

            {/* Categories */}
            <div
              className={`flex flex-wrap justify-center gap-4 mb-10 ${
                search.trim().length > 0 ? "opacity-50 pointer-events-none" : ""
              }`}
            >
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setOpenQuestion(null);
                  }}
                  className={`px-5 py-2.5 rounded-full text-sm md:text-base font-semibold transition-all duration-300 shadow-sm
                    ${
                      activeCategory === cat.id
                        ? "bg-red-600 text-white shadow-md"
                        : "bg-gray-100 text-gray-700 hover:bg-red-50 hover:text-red-600"
                    }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Questions Accordion */}
            <div className="space-y-4">
              {(() => {
                const query = search.trim().toLowerCase();
                const isSearching = query.length > 0;

                const items = isSearching
                  ? categories.flatMap((cat) =>
                      cat.faq_questions
                        .filter((q) => {
                          const haystack = `${q.question} ${q.answer}`.toLowerCase();
                          return haystack.includes(query);
                        })
                        .map((q) => ({
                          categoryId: cat.id,
                          categoryName: cat.name,
                          ...q,
                        }))
                    )
                  : (categories
                      .find((cat) => cat.id === activeCategory)
                      ?.faq_questions.map((q) => ({
                        categoryId: activeCategory,
                        categoryName:
                          categories.find((c) => c.id === activeCategory)?.name || "",
                        ...q,
                      })) ?? []);

                if (isSearching && items.length === 0) {
                  return (
                    <div className="text-center py-10">
                      <p className="text-gray-700 font-semibold">No results found.</p>
                      <p className="text-gray-500 text-sm mt-1">
                        Try a different keyword or clear search to browse categories.
                      </p>
                    </div>
                  );
                }

                return items.map((q) => (
                  <div
                    key={`${q.categoryId ?? "cat"}-${q.id}`}
                    className="border rounded-lg overflow-hidden shadow-sm"
                  >
                    <button
                      onClick={() => {
                        if (search.trim().length > 0 && q.categoryId != null) {
                          setActiveCategory(q.categoryId as number);
                        }
                        setOpenQuestion(openQuestion === q.id ? null : q.id);
                      }}
                      className="w-full flex justify-between items-center text-left py-4 px-5 bg-gray-50 hover:bg-gray-100 transition"
                    >
                      <div className="min-w-0">
                        {search.trim().length > 0 && (
                          <div className="text-xs font-semibold text-gray-500 mb-1">
                            {q.categoryName}
                          </div>
                        )}
                        <div className="text-gray-900 font-semibold text-base truncate">
                          {q.question}
                        </div>
                      </div>
                      <span className="text-red-600 font-bold text-lg pl-4">
                        {openQuestion === q.id ? "−" : "+"}
                      </span>
                    </button>
                    {openQuestion === q.id && (
                      <div className="px-5 pb-4 bg-white text-gray-700 text-sm leading-relaxed animate-fadeIn">
                        {q.answer}
                      </div>
                    )}
                  </div>
                ));
              })()}
            </div>




          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
