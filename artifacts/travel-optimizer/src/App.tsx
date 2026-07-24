import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Link, useLocation } from 'wouter';
import { useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleDot, Clock3, Compass, Euro, Home, Info, Luggage, MapPin, Menu, Mountain,
  Navigation, Plus, Route as RouteIcon, Sparkles, TrainFront, Users, Wallet, X, Zap
} from 'lucide-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

type PlanData = {
  places: string; start: string; dates: string; travelers: string; budget: string;
  budgetPreference: string; interests: string[]; pace: string; preferences: string[];
};

const defaultPlan: PlanData = {
  places: 'Northern Italy + Slovenia', start: 'Milan, Italy', dates: '18–29 September 2025',
  travelers: 'Just me', budget: '€1,800–2,400', budgetPreference: 'Balance',
  interests: ['Mountain landscapes', 'Local food'], pace: 'Unhurried', preferences: ['Small towns over capitals', 'Train where possible'],
};

const destinations = [
  { name: 'Lake Bled', country: 'Slovenia', score: 96, color: 'bg-[#a9c6b4]', note: 'A quiet alpine reset with enough structure for your first few days.', tags: ['lake mornings', 'easy trails'], initials: 'BL' },
  { name: 'Bolzano', country: 'Italy', score: 91, color: 'bg-[#c2b39a]', note: 'The best bridge between Italian food culture and the Dolomites.', tags: ['mountain access', 'apertivo'], initials: 'BZ' },
  { name: 'Bergamo', country: 'Italy', score: 84, color: 'bg-[#d5a58f]', note: 'A compact, characterful final stop before flying home.', tags: ['old city', 'slow evenings'], initials: 'BG' },
];

function Logo({ light = false }: { light?: boolean }) {
  return <Link href="/" className={`flex items-center gap-2.5 ${light ? 'text-[#f5f0e6]' : 'text-[#203b47]'}`} data-testid="link-logo">
    <span className={`flex h-8 w-8 items-center justify-center rounded-[10px] ${light ? 'bg-[#e8bc5a] text-[#203b47]' : 'bg-[#203b47] text-[#f5f0e6]'}`}><Mountain size={17} strokeWidth={2.2} /></span>
    <span className="font-display text-[22px] tracking-[-.04em]">roamwise</span>
  </Link>;
}

function Header({ dark = false }: { dark?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className={`absolute inset-x-0 top-0 z-30 ${dark ? 'text-[#f5f0e6]' : 'text-[#203b47]'}`}>
    <div className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-5 sm:px-8 sm:py-7">
      <Logo light={dark} />
      <nav className="hidden items-center gap-8 text-[13px] font-semibold md:flex">
        <a href="#how-it-works" className="opacity-80 transition hover:opacity-100" data-testid="link-how-it-works">How it works</a>
        <a href="#example-trip" className="opacity-80 transition hover:opacity-100" data-testid="link-example-trip">Example trip</a>
        <Link href="/plan" className={`rounded-full px-5 py-2.5 transition ${dark ? 'bg-[#e8bc5a] text-[#203b47] hover:bg-[#f0cb77]' : 'bg-[#203b47] text-[#f5f0e6] hover:bg-[#315565]'}`} data-testid="link-start-planning">Start planning <ArrowUpRight className="ml-1 inline-block" size={14} /></Link>
      </nav>
      <button className="md:hidden" onClick={() => setMenuOpen(!menuOpen)} aria-label="Open menu" data-testid="button-open-menu">{menuOpen ? <X size={22} /> : <Menu size={22} />}</button>
    </div>
    {menuOpen && <div className={`mx-4 rounded-2xl p-4 shadow-lg md:hidden ${dark ? 'bg-[#203b47] text-[#f5f0e6]' : 'bg-[#fbfaf6] text-[#203b47]'}`}>
      <a href="#how-it-works" className="block border-b border-current/10 px-3 py-3 text-sm" onClick={() => setMenuOpen(false)}>How it works</a>
      <a href="#example-trip" className="block border-b border-current/10 px-3 py-3 text-sm" onClick={() => setMenuOpen(false)}>Example trip</a>
      <Link href="/plan" className="block px-3 py-3 text-sm font-semibold" data-testid="link-mobile-start">Start planning <ArrowUpRight className="ml-1 inline" size={14} /></Link>
    </div>}
  </header>;
}

function Landing() {
  return <div className="page-grain min-h-[100dvh] overflow-hidden bg-[#f3f0e8]">
    <section className="relative min-h-[700px] overflow-hidden bg-[#203b47]">
      <Header dark />
      <div className="absolute -right-[12%] top-[10%] h-[600px] w-[600px] rounded-full bg-[#315b63]/40 blur-3xl" />
      <div className="absolute bottom-0 left-0 right-0 h-[47%] bg-[#2f5456] opacity-80 mountain-cut" />
      <div className="absolute bottom-0 left-0 right-0 h-[38%] bg-[#18333c] mountain-cut" />
      <div className="relative mx-auto flex min-h-[700px] max-w-[1180px] items-center px-5 pb-12 pt-28 sm:px-8">
        <div className="max-w-[660px] text-[#f5f0e6]">
          <div className="rise mb-7 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[.18em] text-[#e8bc5a]"><span className="h-px w-8 bg-[#e8bc5a]" /> Travel, considered</div>
          <h1 className="rise rise-delay-1 font-display text-[clamp(3.4rem,8vw,7.5rem)] leading-[.9] tracking-[-.065em]">Go further.<br /><em className="text-[#e8bc5a]">Feel at home.</em></h1>
          <p className="rise rise-delay-2 mt-8 max-w-[460px] text-[17px] leading-7 text-[#d9dfd9]">Roamwise turns the way you like to travel into a route worth remembering. Tell us what matters. We’ll make the thoughtful calls.</p>
          <Link href="/plan" className="rise rise-delay-3 mt-9 inline-flex items-center gap-3 rounded-full bg-[#e8bc5a] px-6 py-3.5 text-[14px] font-bold text-[#203b47] transition hover:-translate-y-0.5 hover:bg-[#f0cb77]" data-testid="link-hero-start">Start with your trip <ArrowRight size={17} /></Link>
        </div>
        <div className="absolute bottom-20 right-10 hidden w-60 rotate-[-4deg] rounded-2xl border border-white/20 bg-[#f3f0e8]/10 p-3 backdrop-blur-sm lg:block">
          <div className="rounded-xl bg-[#e8bc5a] p-4 text-[#203b47]"><Navigation size={17} /><p className="mt-8 font-display text-xl leading-tight">A slower way<br />through the Alps.</p><div className="mt-6 flex justify-between text-[10px] font-bold uppercase tracking-widest"><span>12 days</span><span>3 regions</span></div></div>
        </div>
      </div>
      <div className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 items-center gap-3 text-[10px] uppercase tracking-[.2em] text-[#c4d2cc] sm:flex"><span className="h-7 w-px bg-[#c4d2cc]/60" /> Scroll to explore</div>
    </section>
    <section id="how-it-works" className="mx-auto max-w-[1180px] px-5 py-24 sm:px-8 sm:py-32">
      <div className="grid gap-14 md:grid-cols-[.8fr_1.2fr] md:gap-24">
        <div><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">01 / The difference</p><h2 className="mt-4 max-w-sm font-display text-5xl leading-[.98] tracking-[-.05em] text-[#203b47] sm:text-6xl">Not more places.<br /><span className="text-[#a17d4b]">Better choices.</span></h2></div>
        <div className="grid gap-10 sm:grid-cols-2">
          {[['01', 'We listen closely', 'A short set of purposeful questions helps us understand your rhythm, not just your bucket list.'], ['02', 'We connect the dots', 'We weigh distance, energy, season and the small details that make a place feel like yours.'], ['03', 'You get a point of view', 'One considered route, with honest trade-offs. No endless scroll of nearly identical options.'], ['04', 'You stay in control', 'Every recommendation is explainable, editable and ready to make your own.']].map(([num, title, body]) => <div key={num} className="border-t border-[#d7d0c2] pt-4"><span className="font-mono-custom text-xs text-[#bb7a52]">{num}</span><h3 className="mt-6 text-[17px] font-bold text-[#203b47]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#65706d]">{body}</p></div>)}
        </div>
      </div>
    </section>
    <section id="example-trip" className="bg-[#e7e5d9] px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end"><div><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">02 / A glimpse</p><h2 className="mt-3 font-display text-5xl leading-none tracking-[-.05em] text-[#203b47]">A trip with<br /><em>room to breathe.</em></h2></div><p className="max-w-xs text-sm leading-6 text-[#65706d]">For the curious solo traveler who wants alpine mornings, unhurried meals, and no logistical puzzles.</p></div>
        <div className="mt-14 grid gap-4 md:grid-cols-[1.4fr_.8fr_.8fr]">
          <div className="relative min-h-[420px] overflow-hidden rounded-2xl bg-[#718f88] p-7 text-[#f5f0e6] md:row-span-2"><div className="absolute inset-0 bg-[radial-gradient(circle_at_68%_25%,#d9d39d55,transparent_17%),linear-gradient(135deg,transparent_40%,#345b5d 41% 59%,#1d414b 60%)] opacity-80" /><div className="relative flex h-full flex-col justify-between"><div className="flex items-center justify-between text-xs"><span className="rounded-full bg-white/15 px-3 py-1.5">Your route</span><span className="font-mono-custom">SEP 18 — 29</span></div><div><p className="font-mono-custom text-[10px] uppercase tracking-widest text-[#e8bc5a]">Northern Italy + Slovenia</p><h3 className="mt-2 font-display text-4xl leading-none">The limestone<br />and the lake</h3><div className="mt-6 flex items-center gap-3 text-sm"><span>Milan</span><span className="h-px w-10 bg-white/50" /><span>Bled</span><span className="h-px w-10 bg-white/50" /><span>Bolzano</span></div></div></div></div>
          <div className="rounded-2xl bg-[#203b47] p-6 text-[#f5f0e6]"><MapPin size={20} className="text-[#e8bc5a]" /><p className="mt-12 text-xs text-[#b9c7c0]">The feeling</p><p className="mt-2 font-display text-2xl leading-tight">Unhurried, grounded, quietly full.</p></div>
          <div className="rounded-2xl bg-[#d4b78e] p-6 text-[#203b47]"><Clock3 size={20} /><p className="mt-12 text-xs opacity-70">The rhythm</p><p className="mt-2 font-display text-2xl leading-tight">3 bases.<br />No one-night stays.</p></div>
          <div className="rounded-2xl bg-[#f5f0e6] p-6 text-[#203b47]"><p className="font-mono-custom text-[10px] uppercase tracking-widest text-[#bb7a52]">Roamwise note</p><p className="mt-8 text-lg leading-7">“The best part of this route is what we left out: Venice, a rental car, and the need to rush.”</p><p className="mt-6 text-xs font-semibold text-[#65706d]">— your travel brief</p></div>
          <div className="flex items-end justify-between rounded-2xl bg-[#c3d1c6] p-6 text-[#203b47]"><div><p className="text-xs opacity-70">Matched to you</p><p className="mt-1 font-mono-custom text-4xl">94<span className="text-xl">%</span></p></div><Sparkles size={25} /></div>
        </div>
      </div>
    </section>
    <footer className="bg-[#203b47] px-5 py-10 text-[#d9dfd9] sm:px-8"><div className="mx-auto flex max-w-[1180px] flex-col justify-between gap-5 sm:flex-row sm:items-center"><Logo light /><p className="text-xs text-[#9eb1a9]">A better way to find your way.</p><p className="font-mono-custom text-[10px] uppercase tracking-widest text-[#9eb1a9]">© 2025 roamwise</p></div></footer>
  </div>;
}

const planSteps = [
  { key: 'places', eyebrow: 'Let’s start with the shape of it', title: 'Where are you drawn to?', hint: 'Name a country, region, or a loose idea. We’ll help find the through-line.', type: 'text' },
  { key: 'start', eyebrow: 'The first step sets the rhythm', title: 'Where will you begin?', hint: 'A city, an airport, or wherever you’ll land.', type: 'text' },
  { key: 'dates', eyebrow: 'Timing changes everything', title: 'When are you going?', hint: 'Even a rough window helps us read the season.', type: 'text' },
  { key: 'travelers', eyebrow: 'A route should fit the company', title: 'Who’s coming along?', hint: 'This changes the pace, the stays, and the shape of your days.', type: 'choice', options: ['Just me', 'A partner', 'Friends', 'Family'] },
  { key: 'budget', eyebrow: 'Make room for what matters', title: 'What feels comfortable?', hint: 'A total trip budget, excluding international flights.', type: 'choice', options: ['€900–1,400', '€1,400–1,800', '€1,800–2,400', '€2,400+'] },
  { key: 'budgetPreference', eyebrow: 'There’s no wrong answer', title: 'Where should we spend well?', hint: 'We’ll use this to make the right trade-offs.', type: 'choice', options: ['Keep it lean', 'Balance', 'A few beautiful splurges'] },
  { key: 'pace', eyebrow: 'The most important detail', title: 'How should it feel?', hint: 'Think about how you want to come home feeling.', type: 'choice', options: ['Unhurried', 'A little of everything', 'See it all'] },
];

function Plan() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<PlanData>(defaultPlan);
  const [interests, setInterests] = useState(defaultPlan.interests);
  const [preferences, setPreferences] = useState(defaultPlan.preferences);
  const current = planSteps[step];
  const value = data[current.key as keyof PlanData] as string;
  const choices = current.options ?? [];
  const finish = step === planSteps.length - 1;
  const setValue = (next: string) => setData((old) => ({ ...old, [current.key]: next }));
  const canNext = Boolean(value);
  return <div className="page-grain min-h-[100dvh] bg-[#f3f0e8] text-[#203b47]">
    <div className="mx-auto flex min-h-[100dvh] max-w-[1440px] flex-col px-5 sm:px-10">
      <div className="flex items-center justify-between py-6 sm:py-8"><Logo /><span className="font-mono-custom text-[10px] uppercase tracking-[.18em] text-[#76827d]">Your travel brief</span></div>
      <div className="relative flex flex-1 items-start justify-center pb-12 pt-10 sm:pt-20">
        <div className="w-full max-w-[710px]">
          <div className="mb-14 flex items-center gap-2"><div className="flex flex-1 gap-1">{planSteps.map((_, i) => <div key={i} className={`h-1 flex-1 rounded-full transition ${i <= step ? 'bg-[#203b47]' : 'bg-[#d8d2c5]'}`} />)}</div><span className="ml-3 font-mono-custom text-[11px] text-[#76827d]">{String(step + 1).padStart(2, '0')} / {String(planSteps.length).padStart(2, '0')}</span></div>
          <div key={current.key} className="rise"><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">{current.eyebrow}</p><h1 className="mt-4 max-w-xl font-display text-5xl leading-[.98] tracking-[-.05em] sm:text-7xl">{current.title}</h1><p className="mt-6 max-w-md text-[15px] leading-6 text-[#65706d]">{current.hint}</p>
            {current.type === 'text' && <div className="mt-12"><input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && canNext && (finish ? setLocation('/analysis') : setStep(step + 1))} className="w-full border-b-2 border-[#a9b5ad] bg-transparent py-4 text-2xl outline-none transition placeholder:text-[#a9b5ad] focus:border-[#203b47]" placeholder={current.key === 'places' ? 'e.g. The Alps, but not too much hiking' : current.key === 'start' ? 'e.g. Amsterdam' : 'e.g. 18–29 September 2025'} data-testid={`input-plan-${current.key}`} /></div>}
            {current.type === 'choice' && <div className="mt-10 grid gap-3 sm:grid-cols-2">{choices.map((choice) => <button key={choice} onClick={() => setValue(choice)} className={`flex items-center justify-between rounded-xl border px-5 py-4 text-left text-[15px] transition hover:-translate-y-0.5 ${value === choice ? 'border-[#203b47] bg-[#dbe3d9] shadow-sm' : 'border-[#d7d0c2] bg-[#f8f6ef] hover:border-[#a9b5ad]'}`} data-testid={`button-choice-${choice.replace(/\W/g, '-').toLowerCase()}`}><span>{choice}</span>{value === choice && <Check size={17} />}</button>)}</div>}
          </div>
          {step === 0 && <div className="mt-10 border-t border-[#d7d0c2] pt-5"><p className="mb-3 text-xs font-semibold text-[#65706d]">A few places that work beautifully together</p><div className="flex flex-wrap gap-2">{['Northern Italy + Slovenia', 'Portugal coast', 'Scotland by train'].map((x) => <button key={x} onClick={() => setValue(x)} className="rounded-full border border-[#c9c1b2] px-3 py-2 text-xs transition hover:border-[#203b47] hover:bg-[#e7e5d9]" data-testid={`button-suggestion-${x}`}>{x}</button>)}</div></div>}
          {step === 6 && <div className="mt-10 space-y-7 border-t border-[#d7d0c2] pt-7"><div><p className="mb-3 text-xs font-semibold">What pulls you in?</p><div className="flex flex-wrap gap-2">{['Mountain landscapes', 'Local food', 'Art & design', 'Water & swimming', 'Small-town life', 'Architecture'].map((x) => <button key={x} onClick={() => setInterests(interests.includes(x) ? interests.filter((i) => i !== x) : [...interests, x])} className={`rounded-full border px-3.5 py-2 text-xs transition ${interests.includes(x) ? 'border-[#203b47] bg-[#203b47] text-[#f5f0e6]' : 'border-[#c9c1b2]'}`} data-testid={`button-interest-${x}`}>{x}</button>)}</div></div><div><p className="mb-3 text-xs font-semibold">And one last preference</p><div className="space-y-2">{['Small towns over capitals', 'Train where possible', 'A free afternoon in every base'].map((x) => <button key={x} onClick={() => setPreferences(preferences.includes(x) ? preferences.filter((i) => i !== x) : [...preferences, x])} className="flex w-full items-center gap-3 rounded-lg py-1 text-left text-sm" data-testid={`button-preference-${x}`}><span className={`flex h-5 w-5 items-center justify-center rounded border ${preferences.includes(x) ? 'border-[#203b47] bg-[#203b47] text-white' : 'border-[#b5bcb6]'}`}>{preferences.includes(x) && <Check size={13} />}</span>{x}</button>)}</div></div></div>}
          <div className="mt-16 flex items-center justify-between border-t border-[#d7d0c2] pt-5"><button onClick={() => step > 0 ? setStep(step - 1) : setLocation('/')} className="flex items-center gap-2 text-sm font-semibold text-[#65706d] transition hover:text-[#203b47]" data-testid="button-plan-back"><ArrowLeft size={16} /> Back</button><button onClick={() => finish ? setLocation('/analysis') : setStep(step + 1)} disabled={!canNext} className="flex items-center gap-3 rounded-full bg-[#203b47] px-5 py-3 text-sm font-semibold text-[#f5f0e6] transition hover:bg-[#315565] disabled:cursor-not-allowed disabled:opacity-35" data-testid="button-plan-next">{finish ? 'See my direction' : 'Continue'} <ArrowRight size={16} /></button></div>
        </div>
      </div>
    </div>
  </div>;
}

function Analysis() {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(0);
  const [loading, setLoading] = useState(false);
  const generate = () => { setLoading(true); window.setTimeout(() => setLocation('/trip'), 850); };
  return <div className="page-grain min-h-[100dvh] bg-[#f3f0e8] text-[#203b47]">
    <div className="mx-auto max-w-[1180px] px-5 pb-20 sm:px-8"><div className="flex items-center justify-between py-6 sm:py-8"><Logo /><Link href="/plan" className="flex items-center gap-2 text-xs font-semibold text-[#65706d]" data-testid="link-edit-brief"><ArrowLeft size={15} /> Edit brief</Link></div>
      <div className="border-b border-[#d7d0c2] pb-16 pt-12 sm:pt-24"><div className="max-w-3xl"><p className="rise font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Your direction is taking shape</p><h1 className="rise rise-delay-1 mt-5 font-display text-5xl leading-[.94] tracking-[-.06em] sm:text-8xl">Go north,<br /><em>then slow down.</em></h1><p className="rise rise-delay-2 mt-8 max-w-xl text-[16px] leading-7 text-[#65706d]">Based on your love of mountain landscapes, local food, and unhurried days, we found a route that lets the landscape do the talking.</p></div><div className="mt-14 grid max-w-4xl gap-3 sm:grid-cols-3"><div className="rounded-xl bg-[#203b47] p-5 text-[#f5f0e6]"><Sparkles className="text-[#e8bc5a]" size={18} /><p className="mt-8 text-xs text-[#aebeb5]">The strategy</p><p className="mt-1 font-display text-2xl">Fewer bases, deeper days</p></div><div className="rounded-xl bg-[#d4b78e] p-5"><Clock3 size={18} /><p className="mt-8 text-xs text-[#5d6863]">The pace</p><p className="mt-1 font-display text-2xl">Unhurried</p></div><div className="rounded-xl bg-[#c3d1c6] p-5"><RouteIcon size={18} /><p className="mt-8 text-xs text-[#5d6863]">The shape</p><p className="mt-1 font-display text-2xl">3 bases · 11 nights</p></div></div></div>
      <section className="py-16"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">The shortlist</p><h2 className="mt-3 font-display text-4xl tracking-[-.04em] sm:text-5xl">Places that fit your brief</h2></div><p className="max-w-xs text-sm leading-6 text-[#65706d]">Not ranked by popularity. Ranked by the kind of days you said you want.</p></div><div className="mt-9 space-y-3">{destinations.map((d, i) => <div key={d.name} className={`overflow-hidden rounded-2xl border transition ${expanded === i ? 'border-[#9aada3] bg-[#fbfaf6]' : 'border-[#d7d0c2] bg-transparent'}`}><button onClick={() => setExpanded(expanded === i ? -1 : i)} className="flex w-full items-center gap-4 p-4 text-left sm:p-5" data-testid={`button-expand-destination-${i}`}><div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${d.color} font-display text-xl text-[#203b47]`}>{d.initials}</div><div className="min-w-0 flex-1"><p className="text-xs text-[#65706d]">{d.country}</p><h3 className="mt-0.5 text-lg font-bold">{d.name}</h3></div><div className="hidden text-right sm:block"><p className="font-mono-custom text-2xl text-[#bb7a52]">{d.score}%</p><p className="text-[10px] uppercase tracking-wider text-[#65706d]">experience match</p></div><ChevronDown size={18} className={`transition ${expanded === i ? 'rotate-180' : ''}`} /></button>{expanded === i && <div className="grid gap-5 border-t border-[#e2ddd2] px-5 pb-5 pt-4 sm:grid-cols-[1fr_auto] sm:pl-[86px]"><div><p className="max-w-2xl text-sm leading-6 text-[#65706d]">{d.note}</p><div className="mt-3 flex gap-2">{d.tags.map((tag) => <span key={tag} className="rounded-full bg-[#e7e5d9] px-3 py-1.5 text-[11px]">{tag}</span>)}</div></div><div className="sm:hidden"><span className="font-mono-custom text-lg text-[#bb7a52]">{d.score}%</span> <span className="text-xs text-[#65706d]">experience match</span></div></div>}</div>)}</div></section>
      <div className="flex flex-col items-start justify-between gap-5 rounded-2xl bg-[#d9e2d8] p-6 sm:flex-row sm:items-center sm:p-8"><div><p className="font-display text-2xl">Ready to see the whole shape?</p><p className="mt-1 text-sm text-[#65706d]">A considered route, day by day, with the practical bits in their place.</p></div><button onClick={generate} disabled={loading} className="flex items-center gap-3 rounded-full bg-[#203b47] px-6 py-3.5 text-sm font-semibold text-[#f5f0e6] transition hover:bg-[#315565] disabled:opacity-70" data-testid="button-generate-trip">{loading ? 'Drawing your route…' : 'Generate my trip'} {!loading && <ArrowRight size={16} />}</button></div>
    </div>
  </div>;
}

const days = [
  { date: 'Thu, 18 Sep', place: 'Milan', title: 'Arrive gently', items: [['15:40', 'Land at Milano Malpensa', 'Take the train into the city; no car, no fuss.'], ['18:30', 'Aperitivo at Bar Basso', 'A first taste of Milan’s generous evening ritual.']] },
  { date: 'Fri, 19 Sep', place: 'Milan → Bled', title: 'Make the crossing', items: [['09:20', 'Morning train to Ljubljana', 'A scenic, low-stress transfer through the foothills.'], ['16:00', 'Settle into Bled', 'Walk the lake shore as the light softens.']] },
  { date: 'Sat, 20 Sep', place: 'Lake Bled', title: 'The lake before breakfast', items: [['07:30', 'Row to Bled Island', 'Go early, before the tour groups arrive.'], ['12:30', 'Lunch at Oštarija Peglez’n', 'Local trout, seasonal vegetables, a long table.'], ['16:00', 'Free afternoon', 'No recommendation here. Follow your energy.']] },
  { date: 'Sun, 21 Sep', place: 'Lake Bled', title: 'Into the valley', items: [['09:00', 'Vintgar Gorge', 'A shaded walk, best done at the opening hour.'], ['14:30', 'Lake Bohinj', 'Swim if the day calls for it.']] },
];

function Trip() {
  const [tab, setTab] = useState<'overview' | 'days' | 'practical'>('overview');
  const [filter, setFilter] = useState('All days');
  const [checked, setChecked] = useState<string[]>([]);
  const [openDay, setOpenDay] = useState(0);
  const [toast, setToast] = useState('');
  const visibleDays = filter === 'All days' ? days : days.filter((d) => d.place.includes(filter));
  const toggleCheck = (id: string) => { setChecked(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]); setToast(checked.includes(id) ? '' : 'Added to your ready list'); window.setTimeout(() => setToast(''), 1800); };
  return <div className="page-grain min-h-[100dvh] bg-[#f3f0e8] text-[#203b47]">
    <header className="border-b border-[#d7d0c2] bg-[#f3f0e8]/90"><div className="mx-auto flex max-w-[1220px] items-center justify-between px-5 py-5 sm:px-8"><Logo /><div className="hidden items-center gap-3 sm:flex"><span className="h-2 w-2 rounded-full bg-[#6b9c7b]" /><span className="text-xs text-[#65706d]">Your trip is saved in this session</span></div><Link href="/plan" className="rounded-full border border-[#c9c1b2] px-4 py-2 text-xs font-semibold transition hover:border-[#203b47]" data-testid="link-new-trip">New trip</Link></div></header>
    <main className="mx-auto max-w-[1220px] px-5 pb-24 sm:px-8"><div className="border-b border-[#d7d0c2] py-12 sm:py-20"><div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end"><div><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Your Europe, considered</p><h1 className="mt-4 font-display text-5xl leading-[.93] tracking-[-.06em] sm:text-8xl">The limestone<br /><em>and the lake.</em></h1><p className="mt-7 flex items-center gap-2 text-sm text-[#65706d]"><MapPin size={15} /> Milan <ArrowRight size={13} /> Bled <ArrowRight size={13} /> Bolzano</p></div><div className="max-w-xs text-sm leading-6 text-[#65706d]"><p>11 nights · 3 bases · 2 countries</p><p className="mt-2">A route for slow starts, high horizons, and the kind of meals you remember.</p></div></div></div>
      <div className="sticky top-0 z-20 -mx-5 flex gap-1 overflow-x-auto border-b border-[#d7d0c2] bg-[#f3f0e8]/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8"><button onClick={() => setTab('overview')} className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${tab === 'overview' ? 'bg-[#203b47] text-[#f5f0e6]' : 'text-[#65706d] hover:bg-[#e7e5d9]'}`} data-testid="button-trip-overview">Overview</button><button onClick={() => setTab('days')} className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${tab === 'days' ? 'bg-[#203b47] text-[#f5f0e6]' : 'text-[#65706d] hover:bg-[#e7e5d9]'}`} data-testid="button-trip-days">Day by day</button><button onClick={() => setTab('practical')} className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${tab === 'practical' ? 'bg-[#203b47] text-[#f5f0e6]' : 'text-[#65706d] hover:bg-[#e7e5d9]'}`} data-testid="button-trip-practical">Practical notes</button></div>
      {(tab === 'overview' || tab === 'days') && <section className="py-12 sm:py-16"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">The route</p><h2 className="mt-2 font-display text-4xl tracking-[-.04em]">A little less map, a lot more place.</h2></div><div className="flex items-center gap-2 text-xs text-[#65706d]"><span>11 nights</span><span className="h-1 w-1 rounded-full bg-[#bb7a52]" /><span>Two gentle transfers</span></div></div><div className="mt-10 overflow-x-auto pb-3"><div className="flex min-w-[680px] items-center px-4"><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d5a58f] font-mono-custom text-xs">01</span><div><p className="font-bold">Milan</p><p className="text-xs text-[#65706d]">2 nights</p></div></div><div className="mx-6 h-px w-24 route-line" /><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#a9c6b4] font-mono-custom text-xs">02</span><div><p className="font-bold">Lake Bled</p><p className="text-xs text-[#65706d]">4 nights</p></div></div><div className="mx-6 h-px w-24 route-line" /><div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#c2b39a] font-mono-custom text-xs">03</span><div><p className="font-bold">Bolzano</p><p className="text-xs text-[#65706d]">5 nights</p></div></div></div></div><div className="mt-2 flex items-center gap-2 rounded-xl bg-[#e7e5d9] px-4 py-3 text-xs text-[#65706d]"><TrainFront size={16} /><span>Milan → Ljubljana</span><span className="ml-auto font-mono-custom">5h 45m</span><span className="mx-2 h-3 w-px bg-[#b9b7aa]" /><span>Ljubljana → Bled</span><span className="font-mono-custom">1h 15m</span></div></section>}
      {tab === 'overview' && <><section className="grid gap-4 border-t border-[#d7d0c2] py-12 sm:grid-cols-3 sm:py-16"><div className="sm:col-span-2"><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Your three bases</p><div className="mt-7 grid gap-3 sm:grid-cols-3">{destinations.map((d, i) => <div className={`rounded-2xl ${d.color} p-5`} key={d.name} data-testid={`card-trip-destination-${i}`}><div className="flex justify-between"><span className="font-mono-custom text-[10px]">0{i + 1}</span><ArrowUpRight size={16} /></div><p className="mt-16 text-xs">{d.country}</p><p className="font-display text-2xl">{d.name}</p><p className="mt-3 text-xs leading-5 opacity-70">{d.tags.join(' · ')}</p></div>)}</div></div><div className="rounded-2xl bg-[#203b47] p-6 text-[#f5f0e6] sm:p-7"><Wallet size={19} className="text-[#e8bc5a]" /><p className="mt-10 text-xs text-[#aebeb5]">Estimated on-the-ground</p><p className="mt-2 font-display text-4xl">€2,080</p><div className="mt-7 border-t border-white/15 pt-4 text-xs text-[#c0cec7]"><div className="flex justify-between py-1"><span>Stay</span><span>€1,020</span></div><div className="flex justify-between py-1"><span>Getting around</span><span>€370</span></div><div className="flex justify-between py-1"><span>Food & experiences</span><span>€690</span></div></div></div></section><Checklist checked={checked} toggleCheck={toggleCheck} /></>}
      {tab === 'days' && <section className="py-12 sm:py-16"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">A gentle rhythm</p><h2 className="mt-2 font-display text-4xl">Your days, with room in them.</h2></div><select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-full border border-[#c9c1b2] bg-transparent px-4 py-2 text-xs font-semibold outline-none" data-testid="select-day-filter"><option>All days</option><option>Milan</option><option>Lake Bled</option></select></div><div className="mt-8 space-y-3">{visibleDays.map((day, i) => <div key={day.date} className="rounded-2xl border border-[#d7d0c2] bg-[#f8f6ef]"><button onClick={() => setOpenDay(openDay === i ? -1 : i)} className="flex w-full items-center gap-4 p-5 text-left" data-testid={`button-expand-day-${i}`}><span className="w-20 shrink-0 font-mono-custom text-[10px] uppercase text-[#bb7a52]">{day.date}</span><span className="flex-1"><span className="block text-xs text-[#65706d]">{day.place}</span><span className="block font-display text-2xl">{day.title}</span></span><ChevronRight size={18} className={`transition ${openDay === i ? 'rotate-90' : ''}`} /></button>{openDay === i && <div className="space-y-5 border-t border-[#e2ddd2] px-5 pb-6 pt-5 sm:pl-[116px]">{day.items.map(([time, title, desc]) => <div className="grid grid-cols-[50px_1fr] gap-4" key={time}><span className="font-mono-custom text-[10px] text-[#bb7a52]">{time}</span><div><p className="font-semibold">{title}</p><p className="mt-1 text-sm leading-6 text-[#65706d]">{desc}</p></div></div>)}</div>}</div>)}</div></section>}
      {tab === 'practical' && <section className="grid gap-4 py-12 sm:grid-cols-2 sm:py-16"><div className="rounded-2xl bg-[#e7e5d9] p-6 sm:p-8"><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Money, clearly</p><h2 className="mt-3 font-display text-4xl">Budget shape</h2><div className="mt-8 space-y-5">{[['Stays', '€1,020', 49], ['Transport', '€370', 18], ['Food & experiences', '€690', 33]].map(([label, amount, pct]) => <div key={label as string}><div className="flex justify-between text-sm"><span>{label}</span><span className="font-mono-custom text-xs">{amount}</span></div><div className="mt-2 h-2 rounded-full bg-[#d0cec0]"><div className="h-2 rounded-full bg-[#203b47]" style={{ width: `${pct}%` }} /></div></div>)}</div></div><Checklist checked={checked} toggleCheck={toggleCheck} compact /></section>}
    </main>
    {toast && <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#203b47] px-5 py-3 text-xs font-semibold text-[#f5f0e6] shadow-xl"><CheckCircle2 size={15} className="text-[#e8bc5a]" /> {toast}</div>}
  </div>;
}

function Checklist({ checked, toggleCheck, compact = false }: { checked: string[]; toggleCheck: (id: string) => void; compact?: boolean }) {
  const items = [['stay', 'Confirm your stays', 'Bled · 4 nights'], ['train', 'Book the two scenic trains', 'Milan → Ljubljana → Bled'], ['arrival', 'Save your arrival plan', 'Malpensa → Milano Centrale']];
  return <section className={`${compact ? '' : 'border-t border-[#d7d0c2] py-12 sm:py-16'}`}><div className={`${compact ? '' : 'grid gap-8 sm:grid-cols-[.8fr_1.2fr]'}`}><div><p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Before you go</p><h2 className="mt-3 font-display text-4xl">The ready list.</h2>{!compact && <p className="mt-3 max-w-xs text-sm leading-6 text-[#65706d]">A few practical pieces, kept together so the trip can stay spacious.</p>}</div><div className="mt-7 space-y-2 sm:mt-0">{items.map(([id, title, detail]) => <button key={id} onClick={() => toggleCheck(id)} className="flex w-full items-center gap-4 rounded-xl border border-[#d7d0c2] bg-[#f8f6ef] p-4 text-left transition hover:border-[#a9b5ad]" data-testid={`button-checklist-${id}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${checked.includes(id) ? 'border-[#6b9c7b] bg-[#6b9c7b] text-white' : 'border-[#b5bcb6]'}`}>{checked.includes(id) && <Check size={14} />}</span><span className={`flex-1 ${checked.includes(id) ? 'text-[#76827d] line-through' : ''}`}><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block text-xs text-[#65706d]">{detail}</span></span><ChevronRight size={16} className="text-[#9ca79f]" /></button>)}</div></div></section>;
}

function AppRouter() {
  return <Switch><Route path="/" component={Landing} /><Route path="/plan" component={Plan} /><Route path="/analysis" component={Analysis} /><Route path="/trip" component={Trip} /><Route component={NotFound} /></Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><AppRouter /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;