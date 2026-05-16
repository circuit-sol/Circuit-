'use client';

import { useState } from 'react';
import Image from 'next/image';
import Navbar from '@/components/Navbar';

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
  return (
    <div className="min-h-screen flex flex-col bg-black text-white selection:bg-white selection:text-black">
      <Navbar />
      
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
              Circuit is a demand-first fashion production system where garments are only produced after buyers commit.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
              <a href="/drop" className="btn-circuit py-4 px-10 text-xs w-full sm:w-auto justify-center">
                <span>Join Drop Zero</span>
              </a>
              <a href="#how-it-works" className="btn-outline-circuit py-4 px-10 text-xs w-full sm:w-auto justify-center border-white/10 hover:border-white/30">
                How It Works
              </a>
            </div>
          </div>
        </section>

        {/* SECTION TWO — WHY CIRCUIT EXISTS */}
        <section className="bg-white/[0.01] border-y border-white/[0.05] py-20 md:pt-16 md:pb-32">
          <div className="section-container grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
            <div className="order-2 lg:order-1 max-w-xl">
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#444] mb-8 block">
                Why Circuit Exists
              </span>
              <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-8 leading-tight">
                Fashion still produces what it hopes will sell.
              </h2>
              <div className="space-y-6 text-[#888] leading-relaxed text-sm md:text-base">
                <p>Garments are often designed, manufactured, and marketed before real demand is known.</p>
                <p>When those bets fail, the result is excess inventory, markdowns, and waste.</p>
                <p>The problem is not fashion itself. The problem is production happening too early.</p>
                <p className="text-white font-medium">Circuit reverses that order by making production conditional on confirmed demand.</p>
              </div>
            </div>
            
            <div className="order-1 lg:order-2">
              <div className="card-glass overflow-hidden relative aspect-[4/5] lg:aspect-square group border-white/[0.08]">
                <Image src="/satin.png" alt="Process shot" fill className="object-cover opacity-60 group-hover:scale-105 transition-transform duration-1000" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <div className="absolute bottom-8 left-8">
                   <div className="w-12 h-0.5 bg-white mb-4" />
                   <p className="text-[0.65rem] font-bold uppercase tracking-widest text-white/40">Drop Zero Selection</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="py-20 md:py-32 section-container">
          <div className="text-center mb-20">
            <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-[#444] mb-4 block">Process</span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight">How It Works.</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-white/10 border border-white/10 rounded-3xl overflow-hidden">
            {[
              { title: 'Commit', desc: 'Secure your place in the drop by placing an order for the garment.' },
              { title: 'Secure Payment', desc: 'Your funds are held in a trustless Solana escrow until delivery.' },
              { title: 'Production', desc: 'The designer receives the signal and begins crafting your specific unit.' },
              { title: 'Delivery', desc: 'Your garment is shipped. You scan to confirm and release the escrow.' }
            ].map((item, i) => (
              <div key={i} className="bg-black p-10 flex flex-col gap-4 group hover:bg-white/[0.02] transition-colors">
                <span className="text-[0.6rem] font-mono text-[#333] group-hover:text-white/40 transition-colors">0{i+1}</span>
                <h4 className="text-lg font-bold">{item.title}</h4>
                <p className="text-xs text-[#666] leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* THE GARMENT (Full Width Visual) */}
        <section className="relative h-[70vh] md:h-[90vh] overflow-hidden border-y border-white/10">
          <Image src="/satin.png" alt="Craft Detail" fill className="object-cover opacity-40 brightness-75" />
          <div className="absolute inset-0 flex items-center justify-center text-center p-8">
            <h3 className="text-3xl md:text-6xl font-bold tracking-tighter max-w-4xl leading-tight">
              A physical garment with a digital certificate.
            </h3>
          </div>
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-px h-20 bg-gradient-to-b from-white/0 to-white/40" />
        </section>

        {/* FAQ Section */}
        <section className="section-container py-20 md:py-32" id="faq">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 lg:gap-20">
            <div>
              <h2 className="text-4xl font-bold tracking-tight">FAQ</h2>
              <p className="text-[#666] mt-4 text-sm leading-relaxed max-w-xs">
                Addressing the specifics of our demand-first model.
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
                answer="Drop Zero opens to the waitlist first. Join above to be notified before the public."
              />
            </div>
          </div>
        </section>

        {/* FINAL CTA (Drop Zero is coming) */}
        <section className="section-container pb-32">
          <div className="card-glass p-12 md:p-24 text-center overflow-hidden relative border-white/[0.05]">
             <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_#fff_0%,_transparent_70%)]" />
             <div className="relative z-10 max-w-2xl mx-auto">
               <h2 className="text-4xl md:text-6xl font-bold mb-8 tracking-tighter text-white">
                 Drop Zero is coming. <br /> Be first to know.
               </h2>
               
               <div className="flex flex-col md:flex-row gap-4 justify-center items-center">
                 <input 
                   type="email" 
                   placeholder="Enter email address" 
                   className="w-full bg-white/[0.05] border border-white/10 px-8 py-5 rounded-full text-sm focus:outline-none focus:border-white/30 transition-all placeholder:text-[#333]"
                 />
                 <button className="btn-circuit w-full md:w-auto justify-center whitespace-nowrap py-5 px-10">
                   <span>Notify Me</span>
                 </button>
               </div>
             </div>
          </div>
        </section>
      </main>
    </div>
  );
}
