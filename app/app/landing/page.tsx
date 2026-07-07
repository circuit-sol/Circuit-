'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import NewsletterForm from '@/components/NewsletterForm';
import { getEditions } from '@/lib/db';

interface FAQItemProps {
  question: string;
  answer: string;
}

function FAQItem({ question, answer }: FAQItemProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-white/10">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-6 flex items-center justify-between text-left group"
      >
        <span className="text-lg md:text-xl font-medium group-hover:text-white/80 transition-colors">{question}</span>
        <span className={`text-2xl transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}>+</span>
      </button>
      <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isOpen ? 'max-h-[500px] pb-8' : 'max-h-0'}`}>
        <p className="text-[#666] leading-relaxed max-w-2xl text-sm md:text-base">
          {answer}
        </p>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [editions, setEditions] = useState<any[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadEditions() {
      try {
        const data = await getEditions();
        setEditions(data);
        if (data && data.length > 0) {
          setSelectedEdition(data[0]);
        }
      } catch (err) {
        console.error('Error loading editions from Supabase:', err);
      } finally {
        setLoading(false);
      }
    }
    loadEditions();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-black text-white selection:bg-white selection:text-black">
      <Navbar customEditions={editions} />

      <main className="flex-1">
        {/* HERO SECTION */}
        <section className="section-container pt-32 pb-16 md:pt-44 md:pb-8 text-center relative overflow-hidden">
          {/* Ambient Glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.03)_0%,_transparent_70%)] pointer-events-none" />

          <div className="animate-fade-in flex flex-col items-center relative z-10">
            <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666] mb-8 px-4 py-1.5 border border-white/10 rounded-full">
              Built on Solana
            </span>
            <h1 className="text-5xl md:text-8xl font-bold tracking-tight leading-[0.95] mb-10 max-w-5xl">
              Fashion sold before <br className="hidden md:block" /> it’s made.
            </h1>
            <p className="text-base md:text-xl text-[#888] leading-relaxed max-w-2xl mb-12">
              Circuit is a demand-first fashion brand where garments are only produced after buyers commit.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
              <a href="#collections-slider" className="btn-circuit py-4 px-10 text-xs w-full sm:w-auto justify-center">
                <span>Browse Editions</span>
              </a>
              <a href="#how-it-works" className="btn-outline-circuit py-4 px-10 text-xs w-full sm:w-auto justify-center border-white/10 hover:border-white/30">
                How It Works
              </a>
            </div>
          </div>
        </section>

        {/* COLLECTIONS SLIDER SECTION */}
        <section id="collections-slider" className="py-20 border-t border-white/[0.05] relative overflow-hidden bg-white/[0.01]">
          <div className="section-container relative z-10">
            <div className="text-center mb-12">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666] mb-4 block">
                Current Collections
              </span>
              <h2 className="text-4xl md:text-6xl font-bold tracking-tight">
                Select Your Edition.
              </h2>
              <p className="text-[#888] mt-4 text-sm max-w-md mx-auto">
                Explore active editions.
              </p>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
                <span className="text-xs font-mono text-[#555]">Checking availability. One moment...</span>
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Edition Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                  {editions.map((edition) => (
                    <Link
                      key={edition.id}
                      href={`/drop?edition=${edition.id}`}
                      className="group block relative rounded-2xl overflow-hidden transition-all duration-500 cursor-pointer border border-white/10 bg-white/[0.02] hover:border-white/30 hover:bg-white/[0.04] hover:-translate-y-1 hover:shadow-[0_10px_40px_rgba(255,255,255,0.05)]"
                    >
                      <div className="aspect-[4/5] relative overflow-hidden">
                        <Image
                          src={edition.images?.[0]?.url || '/satin.png'}
                          alt={edition.name}
                          fill
                          className="object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent transition-opacity duration-500" />

                        <div className="absolute bottom-6 left-6 right-6">
                          <span className="text-[0.6rem] font-bold tracking-[0.15em] text-white/50 uppercase block mb-2">
                            Limited to {edition.max_supply} pieces
                          </span>
                          <h3 className="text-xl font-bold text-white mb-3 group-hover:text-emerald-400 transition-colors">{edition.name}</h3>

                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-white/90">
                              {edition.has_variable_prices ? 'Variable Pricing' : `${edition.price_usd} USD`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* SECTION TWO — WHY CIRCUIT EXISTS */}
        <section className="bg-white/[0.01] border-y border-white/[0.05] py-16 md:py-20">
          <div className="section-container grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
            <div className="order-2 lg:order-1 max-w-xl">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#444] mb-8 block">
                Why Circuit Exists
              </span>
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-8 leading-tight">
                Fashion often produces before real demand exists.
              </h2>
              <div className="space-y-6 text-[#888] leading-relaxed text-sm md:text-base">
                <p>When those bets fail, the result is excess inventory, markdowns, and waste.</p>
                <p>Circuit changes the order.</p>
                <p className="text-white font-medium">Production only begins after demand is confirmed.</p>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <div className="card-glass overflow-hidden relative aspect-[4/5] lg:aspect-square group border-white/[0.08]">
                <Image src={selectedEdition?.images?.[0]?.url || "/satin.png"} alt="Process shot" fill className="object-cover opacity-60 group-hover:scale-105 transition-transform duration-1000" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-8 left-8">
                  <div className="w-12 h-0.5 bg-white mb-4" />
                  <p className="text-[0.65rem] font-bold uppercase tracking-widest text-white/40">Current Editions</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="pt-12 pb-10 md:pt-20 md:pb-16 section-container">
          <div className="text-center mb-20">
            <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#444] mb-4 block">Process</span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">How It Works.</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-white/10 border border-white/10 rounded-3xl overflow-hidden">
            {[
              { title: 'Commit', desc: 'Secure your place in the drop by placing an order for the garment.' },
              { title: 'Secure Payment', desc: 'Your payment goes into a secure hold that neither you nor Circuit can touch until delivery' },
              { title: 'Production', desc: 'Production begins after your order is confirmed.' },
              { title: 'Delivery', desc: 'Confirm delivery and your payment releases to Circuit' }
            ].map((item, i) => (
              <div key={i} className="bg-black p-10 flex flex-col gap-4 group hover:bg-white/[0.02] transition-colors">
                <span className="text-[0.6rem] font-mono text-[#333] group-hover:text-white/40 transition-colors">0{i + 1}</span>
                <h4 className="text-lg font-bold">{item.title}</h4>
                <p className="text-xs text-[#666] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* THE GARMENT (Editorial Gallery) */}
        <section className="section-container pt-10 pb-16 md:pt-16 md:pb-32">
          <div className="flex items-end justify-between mb-8 md:mb-12">
            <div className="flex flex-col gap-2">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#666]">Craftsmanship</span>
              <h2 className="text-2xl md:text-4xl font-bold tracking-tight">Precision Tailoring.</h2>
            </div>
            <span className="text-[0.65rem] font-mono text-[#666] uppercase tracking-widest hidden sm:block border border-white/10 px-4 py-2 rounded-full">
              Made to Measure // Circuit
            </span>
          </div>

          <div className="flex flex-col md:flex-row gap-6 md:gap-10 md:h-[80vh]">
            {/* Image 1 */}
            <div className="relative w-full aspect-[3/4] md:aspect-auto md:flex-1 md:h-full rounded-[2rem] overflow-hidden border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.5)] group bg-[#0A0A0A]">
              <Image src="/yellow-gown.jpg" alt="Craft Detail Front" fill className="object-cover object-top md:object-[center_10%] group-hover:scale-105 transition-transform duration-[2s] ease-out" />
              

            </div>

            {/* Image 2 (Staggered on Desktop) */}
            <div className="relative w-full aspect-[3/4] md:aspect-auto md:flex-1 md:h-full rounded-[2rem] overflow-hidden border border-white/[0.08] shadow-[0_20px_50px_rgba(0,0,0,0.5)] group bg-[#0A0A0A] md:mt-16">
              <Image src="/yellow-gown2.jpg" alt="Craft Detail Angle" fill className="object-cover object-top md:object-[center_10%] group-hover:scale-105 transition-transform duration-[2s] ease-out" />
              

            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="section-container py-20 md:py-32" id="faq">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 lg:gap-20">
            <div>
              <h2 className="text-4xl font-bold tracking-tight">FAQ</h2>
              <p className="text-[#666] mt-4 text-sm leading-relaxed max-w-xs">
                FAQ
              </p>
            </div>
            <div className="lg:col-span-2">
              <FAQItem
                question="1. What does made-to-order actually mean?"
                answer="Your garment is only produced after you place an order. We do not manufacture inventory in advance and hope it sells later."
              />
              <FAQItem
                question="2. Do I need crypto or a wallet to use Circuit?"
                answer="No. You sign up with your email and complete your order normally."
              />
              <FAQItem
                question="3. What happens to my payment while I wait?"
                answer="Your payment is secured until your order is delivered. Circuit does not receive funds upfront. Payment is only released after delivery is confirmed."
              />
              <FAQItem
                question="4. What is the digital record attached to each garment?"
                answer="Each Circuit garment includes a permanent digital record showing when it was produced, what drop it belongs to, and its ownership history."
              />
              <FAQItem
                question="5. Can I resell my Circuit garment?"
                answer="Yes. Each garment carries a verifiable ownership record, making resale and authenticity easier to track."
              />
              <FAQItem
                question="6. How limited is each drop?"
                answer="Each drop has a fixed maximum quantity. Once that number is reached, orders close."
              />
              <FAQItem
                question="7. How long does production take?"
                answer="Production begins only after your order is confirmed. Timeline is specific to each drop and communicated before you commit."
              />
              <FAQItem
                question="8. When does Drop Zero open?"
                answer="Drop Zero opens to the waitlist first. Join to be notified before the public."
              />
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="section-container pb-32">
          <div className="card-glass p-12 md:p-24 text-center overflow-hidden relative border-white/[0.05]">
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_#fff_0%,_transparent_70%)]" />
            <div className="relative z-10 max-w-2xl mx-auto">
              <h2 className="text-4xl md:text-6xl font-bold mb-8 tracking-tighter text-white">
                Get early access
              </h2>

              <NewsletterForm />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
