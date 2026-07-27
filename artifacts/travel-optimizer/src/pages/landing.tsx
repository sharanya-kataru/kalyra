import { Link } from 'wouter';
import { ArrowRight, ArrowUpRight, Navigation } from 'lucide-react';
import { Header } from '@/components/Header';
import { Logo } from '@/components/Logo';

export default function Landing() {
  return (
    <div className="page-grain min-h-[100dvh] overflow-hidden bg-[#f3f0e8]">
      <section className="relative min-h-[700px] overflow-hidden bg-[#203b47]">
        <Header dark />
        <div className="absolute -right-[12%] top-[10%] h-[600px] w-[600px] rounded-full bg-[#315b63]/40 blur-3xl" />
        <div className="absolute bottom-0 left-0 right-0 h-[47%] bg-[#2f5456] opacity-80 mountain-cut" />
        <div className="absolute bottom-0 left-0 right-0 h-[38%] bg-[#18333c] mountain-cut" />
        <div className="relative mx-auto flex min-h-[700px] max-w-[1180px] items-center px-5 pb-12 pt-28 sm:px-8">
          <div className="max-w-[660px] text-[#f5f0e6]">
            <div className="rise mb-7 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[.18em] text-[#e8bc5a]">
              <span className="h-px w-8 bg-[#e8bc5a]" /> Travel, considered
            </div>
            <h1 className="rise rise-delay-1 font-display text-[clamp(3.4rem,8vw,7.5rem)] leading-[.9] tracking-[-.065em]">
              Go further.
              <br />
              <em className="text-[#e8bc5a]">Feel at home.</em>
            </h1>
            <p className="rise rise-delay-2 mt-8 max-w-[460px] text-[17px] leading-7 text-[#d9dfd9]">
              Roamwise turns the way you like to travel into a route worth remembering. Tell us what matters. We'll
              make the thoughtful calls.
            </p>
            <Link
              href="/plan"
              className="rise rise-delay-3 mt-9 inline-flex items-center gap-3 rounded-full bg-[#e8bc5a] px-6 py-3.5 text-[14px] font-bold text-[#203b47] transition hover:-translate-y-0.5 hover:bg-[#f0cb77]"
              data-testid="link-hero-start"
            >
              Start with your trip <ArrowRight size={17} />
            </Link>
          </div>
          <div className="absolute bottom-20 right-10 hidden w-60 rotate-[-4deg] rounded-2xl border border-white/20 bg-[#f3f0e8]/10 p-3 backdrop-blur-sm lg:block">
            <div className="rounded-xl bg-[#e8bc5a] p-4 text-[#203b47]">
              <Navigation size={17} />
              <p className="mt-8 font-display text-xl leading-tight">
                A slower way
                <br />
                through the Alps.
              </p>
              <div className="mt-6 flex justify-between text-[10px] font-bold uppercase tracking-widest">
                <span>12 days</span>
                <span>3 regions</span>
              </div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 items-center gap-3 text-[10px] uppercase tracking-[.2em] text-[#c4d2cc] sm:flex">
          <span className="h-7 w-px bg-[#c4d2cc]/60" /> Scroll to explore
        </div>
      </section>
      <section id="how-it-works" className="mx-auto max-w-[1180px] px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-14 md:grid-cols-[.8fr_1.2fr] md:gap-24">
          <div>
            <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">01 / The difference</p>
            <h2 className="mt-4 max-w-sm font-display text-5xl leading-[.98] tracking-[-.05em] text-[#203b47] sm:text-6xl">
              Not more places.
              <br />
              <span className="text-[#a17d4b]">Better choices.</span>
            </h2>
          </div>
          <div className="grid gap-10 sm:grid-cols-2">
            {[
              ['01', 'We listen closely', 'A short set of purposeful questions helps us understand your rhythm, not just your bucket list.'],
              ['02', 'We connect the dots', 'We weigh distance, energy, season and the small details that make a place feel like yours.'],
              ['03', 'You get a point of view', 'One considered route, with honest trade-offs. No endless scroll of nearly identical options.'],
              ['04', 'You stay in control', 'Every recommendation is explainable, editable and ready to make your own.'],
            ].map(([num, title, body]) => (
              <div key={num} className="border-t border-[#d7d0c2] pt-4">
                <span className="font-mono-custom text-xs text-[#bb7a52]">{num}</span>
                <h3 className="mt-6 text-[17px] font-bold text-[#203b47]">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#65706d]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section id="example-trip" className="bg-[#e7e5d9] px-5 py-24 sm:px-8 sm:py-32">
        <div className="mx-auto max-w-[1180px]">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">02 / A glimpse</p>
              <h2 className="mt-3 font-display text-5xl leading-none tracking-[-.05em] text-[#203b47]">
                A trip with
                <br />
                <em>room to breathe.</em>
              </h2>
            </div>
            <p className="max-w-xs text-sm leading-6 text-[#65706d]">
              For the curious solo traveler who wants alpine mornings, unhurried meals, and no logistical puzzles.
            </p>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-[1.4fr_.8fr_.8fr]">
            <div className="relative min-h-[420px] overflow-hidden rounded-2xl bg-[#718f88] p-7 text-[#f5f0e6] md:row-span-2">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_25%,#d9d39d55,transparent_17%),linear-gradient(135deg,transparent_40%,#345b5d_41%_59%,#1d414b_60%)] opacity-80" />
              <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-center justify-between text-xs">
                  <span className="rounded-full bg-white/15 px-3 py-1.5">Your route</span>
                  <span className="font-mono-custom">SEP 18 — 29</span>
                </div>
                <div>
                  <p className="font-mono-custom text-[10px] uppercase tracking-widest text-[#e8bc5a]">
                    Northern Italy + Slovenia
                  </p>
                  <h3 className="mt-2 font-display text-4xl leading-none">
                    The limestone
                    <br />
                    and the lake
                  </h3>
                  <div className="mt-6 flex items-center gap-3 text-sm">
                    <span>Milan</span>
                    <span className="h-px w-10 bg-white/50" />
                    <span>Bled</span>
                    <span className="h-px w-10 bg-white/50" />
                    <span>Bolzano</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="rounded-2xl bg-[#203b47] p-6 text-[#f5f0e6]">
              <p className="mt-12 text-xs text-[#b9c7c0]">The feeling</p>
              <p className="mt-2 font-display text-2xl leading-tight">Unhurried, grounded, quietly full.</p>
            </div>
            <div className="rounded-2xl bg-[#d4b78e] p-6 text-[#203b47]">
              <p className="mt-12 text-xs opacity-70">The rhythm</p>
              <p className="mt-2 font-display text-2xl leading-tight">
                3 bases.
                <br />
                No one-night stays.
              </p>
            </div>
            <div className="rounded-2xl bg-[#f5f0e6] p-6 text-[#203b47]">
              <p className="font-mono-custom text-[10px] uppercase tracking-widest text-[#bb7a52]">Roamwise note</p>
              <p className="mt-8 text-lg leading-7">
                "The best part of this route is what we left out: Venice, a rental car, and the need to rush."
              </p>
              <p className="mt-6 text-xs font-semibold text-[#65706d]">— your travel brief</p>
            </div>
            <div className="flex items-end justify-between rounded-2xl bg-[#c3d1c6] p-6 text-[#203b47]">
              <div>
                <p className="text-xs opacity-70">Matched to you</p>
                <p className="mt-1 font-mono-custom text-4xl">
                  94<span className="text-xl">%</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <footer className="bg-[#203b47] px-5 py-10 text-[#d9dfd9] sm:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-col justify-between gap-5 sm:flex-row sm:items-center">
          <Logo light />
          <p className="text-xs text-[#9eb1a9]">A better way to find your way.</p>
          <p className="font-mono-custom text-[10px] uppercase tracking-widest text-[#9eb1a9]">© 2025 roamwise</p>
        </div>
      </footer>
    </div>
  );
}
