import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Compass,
  Euro,
  Home,
  Info,
  Luggage,
  MapPin,
  Plus,
  Route as RouteIcon,
  Sparkles,
  TrainFront,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useTripContext } from '@/context/TripContext';
import { useModifyItinerary } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import type { ChangeMade } from '@workspace/api-client-react';

interface ModificationHistoryItem {
  request: string;
  reasoning: string;
  changes: ChangeMade[];
  timestamp: Date;
}

export default function Trip() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<'overview' | 'days' | 'practical'>('overview');
  const [filter, setFilter] = useState('All days');
  const [checked, setChecked] = useState<string[]>([]);
  const [openDay, setOpenDay] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [modificationHistory, setModificationHistory] = useState<ModificationHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const { tripId, itinerary, setItinerary } = useTripContext();
  const { toast } = useToast();
  const modifyItinerary = useModifyItinerary();

  useEffect(() => {
    if (!tripId || !itinerary) {
      setLocation('/plan');
    }
  }, [tripId, itinerary]);

  if (!tripId || !itinerary) {
    return null;
  }

  const visibleDays =
    filter === 'All days'
      ? itinerary.daily_schedule
      : itinerary.daily_schedule.filter((d) => d.location.includes(filter));

  const toggleCheck = (id: string) => {
    setChecked(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
    toast({
      title: checked.includes(id) ? 'Removed from list' : 'Added to your ready list',
    });
  };

  const handleChatSubmit = () => {
    if (!chatInput.trim() || modifyItinerary.isPending) return;

    const requestText = chatInput;
    setChatInput('');

    modifyItinerary.mutate(
      {
        id: tripId,
        data: { user_request: requestText },
      },
      {
        onSuccess: (data) => {
          setItinerary(data.itinerary);
          setModificationHistory((prev) => [
            {
              request: requestText,
              reasoning: data.reasoning,
              changes: data.changes_made,
              timestamp: new Date(),
            },
            ...prev,
          ]);
          toast({
            title: 'Trip updated',
            description: data.reasoning,
          });
        },
        onError: (error) => {
          console.error('Failed to modify itinerary:', error);
          toast({
            title: 'Modification failed',
            description: 'Unable to update your trip. Please try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const suggestionChips = [
    'Make this cheaper',
    'Add more nature',
    'Reduce travel days',
    'Add a food day',
    'Remove a destination',
    'Slow down the trip',
  ];

  // Parse route summary
  const totalNights = itinerary.route.reduce((sum, stop) => sum + stop.nights, 0);
  const baseCount = itinerary.route.length;
  const locationNames = itinerary.route.map((r) => r.location).join(' → ');

  return (
    <div className="page-grain min-h-[100dvh] bg-[#f3f0e8] text-[#203b47]">
      <header className="border-b border-[#d7d0c2] bg-[#f3f0e8]/90">
        <div className="mx-auto flex max-w-[1220px] items-center justify-between px-5 py-5 sm:px-8">
          <Logo />
          <div className="hidden items-center gap-3 sm:flex">
            <span className="h-2 w-2 rounded-full bg-[#6b9c7b]" />
            <span className="text-xs text-[#65706d]">Your trip is saved in this session</span>
          </div>
          <button
            onClick={() => setLocation('/plan')}
            className="rounded-full border border-[#c9c1b2] px-4 py-2 text-xs font-semibold transition hover:border-[#203b47]"
            data-testid="link-new-trip"
          >
            New trip
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-[1220px] px-5 pb-32 sm:px-8">
        <div className="border-b border-[#d7d0c2] py-12 sm:py-20">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div>
              <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">
                Your route, considered
              </p>
              <h1 className="mt-4 font-display text-5xl leading-[.93] tracking-[-.06em] sm:text-8xl">
                {itinerary.trip_strategy}
              </h1>
              <p className="mt-7 flex items-center gap-2 text-sm text-[#65706d]">
                <MapPin size={15} /> {locationNames}
              </p>
            </div>
            <div className="max-w-xs text-sm leading-6 text-[#65706d]">
              <p>
                {totalNights} nights · {baseCount} bases
              </p>
              <p className="mt-2">{itinerary.reasoning}</p>
            </div>
          </div>
        </div>
        <div className="sticky top-0 z-20 -mx-5 flex gap-1 overflow-x-auto border-b border-[#d7d0c2] bg-[#f3f0e8]/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8">
          <button
            onClick={() => setTab('overview')}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${
              tab === 'overview' ? 'bg-[#203b47] text-[#f5f0e6]' : 'text-[#65706d] hover:bg-[#e7e5d9]'
            }`}
            data-testid="button-trip-overview"
          >
            Overview
          </button>
          <button
            onClick={() => setTab('days')}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${
              tab === 'days' ? 'bg-[#203b47] text-[#f5f0e6]' : 'text-[#65706d] hover:bg-[#e7e5d9]'
            }`}
            data-testid="button-trip-days"
          >
            Day by day
          </button>
          <button
            onClick={() => setTab('practical')}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${
              tab === 'practical' ? 'bg-[#203b47] text-[#f5f0e6]' : 'text-[#65706d] hover:bg-[#e7e5d9]'
            }`}
            data-testid="button-trip-practical"
          >
            Practical notes
          </button>
        </div>
        {(tab === 'overview' || tab === 'days') && (
          <section className="py-12 sm:py-16">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">The route</p>
                <h2 className="mt-2 font-display text-4xl tracking-[-.04em]">
                  A little less map, a lot more place.
                </h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#65706d]">
                <span>{totalNights} nights</span>
                <span className="h-1 w-1 rounded-full bg-[#bb7a52]" />
                <span>{itinerary.route.filter((r) => r.transport_to_next).length} transfers</span>
              </div>
            </div>
            <div className="mt-10 overflow-x-auto pb-3">
              <div className="flex min-w-[680px] items-center px-4">
                {itinerary.route.map((stop, i) => {
                  const colors = ['bg-[#d5a58f]', 'bg-[#a9c6b4]', 'bg-[#c2b39a]', 'bg-[#c3d1c6]'];
                  return (
                    <div key={i} className="flex items-center">
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-12 w-12 items-center justify-center rounded-full ${
                            colors[i % colors.length]
                          } font-mono-custom text-xs`}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <p className="font-bold">{stop.location}</p>
                          <p className="text-xs text-[#65706d]">{stop.nights} nights</p>
                        </div>
                      </div>
                      {stop.transport_to_next && i < itinerary.route.length - 1 && (
                        <div className="mx-6 h-px w-24 route-line" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {itinerary.route.some((r) => r.transport_to_next) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#e7e5d9] px-4 py-3 text-xs text-[#65706d]">
                <TrainFront size={16} />
                {itinerary.route.map(
                  (stop, i) =>
                    stop.transport_to_next && (
                      <div key={i} className="flex items-center gap-2">
                        <span>
                          {stop.location} → {itinerary.route[i + 1]?.location}
                        </span>
                        <span className="font-mono-custom">
                          {stop.duration_hours ? `${stop.duration_hours}h` : stop.transport_to_next}
                        </span>
                        {i < itinerary.route.filter((r) => r.transport_to_next).length - 1 && (
                          <span className="mx-2 h-3 w-px bg-[#b9b7aa]" />
                        )}
                      </div>
                    )
                )}
              </div>
            )}
          </section>
        )}
        {tab === 'overview' && (
          <>
            <section className="grid gap-4 border-t border-[#d7d0c2] py-12 sm:grid-cols-3 sm:py-16">
              <div className="sm:col-span-2">
                <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">
                  Your destinations
                </p>
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  {itinerary.destinations.slice(0, 3).map((d, i) => {
                    const colors = ['bg-[#a9c6b4]', 'bg-[#c2b39a]', 'bg-[#d5a58f]'];
                    return (
                      <div className={`rounded-2xl ${colors[i]} p-5`} key={d.name} data-testid={`card-trip-destination-${i}`}>
                        <div className="flex justify-between">
                          <span className="font-mono-custom text-[10px]">0{i + 1}</span>
                          <ArrowUpRight size={16} />
                        </div>
                        <p className="mt-16 text-xs">Destination</p>
                        <p className="font-display text-2xl">{d.name}</p>
                        <p className="mt-3 text-xs leading-5 opacity-70">{d.reasoning.slice(0, 60)}...</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-2xl bg-[#203b47] p-6 text-[#f5f0e6] sm:p-7">
                <Wallet size={19} className="text-[#e8bc5a]" />
                <p className="mt-10 text-xs text-[#aebeb5]">Estimated on-the-ground</p>
                <p className="mt-2 font-display text-4xl">
                  €{itinerary.budget_breakdown.reduce((sum, item) => sum + item.estimated_amount, 0).toLocaleString()}
                </p>
                <div className="mt-7 border-t border-white/15 pt-4 text-xs text-[#c0cec7]">
                  {itinerary.budget_breakdown.slice(0, 3).map((item) => (
                    <div key={item.category} className="flex justify-between py-1">
                      <span>{item.category}</span>
                      <span>€{item.estimated_amount.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <Checklist checked={checked} toggleCheck={toggleCheck} itinerary={itinerary} />
          </>
        )}
        {tab === 'days' && (
          <section className="py-12">
            <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-2">
              <button
                onClick={() => setFilter('All days')}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${
                  filter === 'All days' ? 'bg-[#203b47] text-[#f5f0e6]' : 'border border-[#d7d0c2] text-[#65706d]'
                }`}
                data-testid="button-filter-all"
              >
                All days
              </button>
              {itinerary.route.map((stop) => (
                <button
                  key={stop.location}
                  onClick={() => setFilter(stop.location)}
                  className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold ${
                    filter === stop.location
                      ? 'bg-[#203b47] text-[#f5f0e6]'
                      : 'border border-[#d7d0c2] text-[#65706d]'
                  }`}
                  data-testid={`button-filter-${stop.location}`}
                >
                  {stop.location}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {visibleDays.map((day, i) => (
                <div
                  key={day.day}
                  className={`overflow-hidden rounded-2xl border transition ${
                    openDay === i ? 'border-[#9aada3] bg-[#fbfaf6]' : 'border-[#d7d0c2] bg-transparent'
                  }`}
                >
                  <button
                    onClick={() => setOpenDay(openDay === i ? -1 : i)}
                    className="flex w-full items-center gap-4 p-5 text-left"
                    data-testid={`button-day-${day.day}`}
                  >
                    <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-[#e7e5d9]">
                      <span className="font-mono-custom text-[10px] text-[#bb7a52]">DAY</span>
                      <span className="font-bold">{day.day}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-[#65706d]">{day.date}</p>
                      <h3 className="mt-0.5 font-bold">{day.location}</h3>
                    </div>
                    <ChevronRight size={18} className={`transition ${openDay === i ? 'rotate-90' : ''}`} />
                  </button>
                  {openDay === i && (
                    <div className="border-t border-[#e2ddd2] px-5 pb-5 pt-4 sm:pl-[86px]">
                      <div className="space-y-4">
                        <div>
                          <p className="text-xs font-semibold text-[#bb7a52]">Morning</p>
                          <p className="mt-1 text-sm text-[#65706d]">{day.activities.morning}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#bb7a52]">Afternoon</p>
                          <p className="mt-1 text-sm text-[#65706d]">{day.activities.afternoon}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#bb7a52]">Evening</p>
                          <p className="mt-1 text-sm text-[#65706d]">{day.activities.evening}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-[#bb7a52]">Food recommendation</p>
                          <p className="mt-1 text-sm text-[#65706d]">{day.activities.food_recommendation}</p>
                        </div>
                        {day.activities.transport && (
                          <div>
                            <p className="text-xs font-semibold text-[#bb7a52]">Transport</p>
                            <p className="mt-1 text-sm text-[#65706d]">{day.activities.transport}</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2 border-t border-[#d7d0c2] pt-3 text-xs text-[#65706d]">
                          <Euro size={14} />
                          <span>Estimated cost: €{day.activities.estimated_cost}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === 'practical' && (
          <section className="py-12">
            <div className="mb-8">
              <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Budget breakdown</p>
              <h2 className="mt-2 font-display text-4xl tracking-[-.04em]">Where your money goes</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {itinerary.budget_breakdown.map((item) => (
                <div key={item.category} className="rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-5">
                  <p className="text-xs text-[#bb7a52]">{item.category}</p>
                  <p className="mt-2 font-display text-3xl">€{item.estimated_amount.toLocaleString()}</p>
                  <p className="mt-3 text-xs leading-5 text-[#65706d]">{item.description}</p>
                </div>
              ))}
            </div>
            {itinerary.tradeoffs && itinerary.tradeoffs.length > 0 && (
              <div className="mt-12">
                <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">
                  The trade-offs
                </p>
                <h2 className="mt-2 font-display text-4xl tracking-[-.04em]">What we prioritized</h2>
                <div className="mt-6 space-y-3">
                  {itinerary.tradeoffs.map((item, i) => (
                    <div key={i} className="rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-5">
                      <p className="text-sm font-semibold">{item.description}</p>
                      <p className="mt-2 text-xs leading-5 text-[#65706d]">Impact: {item.impact}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Refine Your Trip Chat Interface */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#d7d0c2] bg-[#f3f0e8]/95 backdrop-blur">
        <div className="mx-auto max-w-[1220px] px-5 py-4 sm:px-8">
          {!showChat ? (
            <button
              onClick={() => setShowChat(true)}
              className="flex w-full items-center justify-between rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] px-5 py-3 text-left transition hover:border-[#203b47]"
              data-testid="button-open-chat"
            >
              <div className="flex items-center gap-3">
                <Sparkles size={18} className="text-[#bb7a52]" />
                <span className="text-sm font-semibold">Refine your trip</span>
              </div>
              <span className="text-xs text-[#65706d]">Click to adjust</span>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Sparkles size={18} className="text-[#bb7a52]" />
                  <span className="text-sm font-semibold">Refine your trip</span>
                </div>
                <button
                  onClick={() => setShowChat(false)}
                  className="text-xs text-[#65706d] hover:text-[#203b47]"
                  data-testid="button-close-chat"
                >
                  Close
                </button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {suggestionChips.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setChatInput(suggestion)}
                    className="whitespace-nowrap rounded-full border border-[#d7d0c2] bg-[#fbfaf6] px-3 py-1.5 text-xs transition hover:border-[#203b47] hover:bg-[#e7e5d9]"
                    data-testid={`button-suggestion-${suggestion}`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleChatSubmit()}
                  placeholder="Ask your travel advisor to adjust the trip..."
                  disabled={modifyItinerary.isPending}
                  className="flex-1 rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] px-4 py-2.5 text-sm outline-none transition focus:border-[#203b47] disabled:opacity-50"
                  data-testid="input-chat"
                />
                <button
                  onClick={handleChatSubmit}
                  disabled={!chatInput.trim() || modifyItinerary.isPending}
                  className="rounded-xl bg-[#203b47] px-5 py-2.5 text-sm font-semibold text-[#f5f0e6] transition hover:bg-[#315565] disabled:cursor-not-allowed disabled:opacity-35"
                  data-testid="button-chat-submit"
                >
                  {modifyItinerary.isPending ? 'Updating...' : 'Send'}
                </button>
              </div>
              {modificationHistory.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="flex items-center gap-2 text-xs text-[#65706d] hover:text-[#203b47]"
                    data-testid="button-toggle-history"
                  >
                    <ChevronRight size={14} className={`transition ${showHistory ? 'rotate-90' : ''}`} />
                    Modification history ({modificationHistory.length})
                  </button>
                  {showHistory && (
                    <div className="mt-3 max-h-60 space-y-2 overflow-y-auto rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-3">
                      {modificationHistory.map((item, i) => (
                        <div key={i} className="border-b border-[#e2ddd2] pb-2 last:border-0">
                          <p className="text-xs font-semibold">{item.request}</p>
                          <p className="mt-1 text-xs text-[#65706d]">{item.reasoning}</p>
                          {item.changes.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {item.changes.map((change, ci) => (
                                <li key={ci} className="flex items-start gap-2 text-xs text-[#65706d]">
                                  <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[#6b9c7b]" />
                                  <span>{change.description}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Checklist({
  checked,
  toggleCheck,
  itinerary,
}: {
  checked: string[];
  toggleCheck: (id: string) => void;
  itinerary: any;
}) {
  const checklistItems = [
    { id: 'passport', icon: Luggage, label: 'Check passport validity', detail: 'Valid for 6 months after return' },
    {
      id: 'accommodation',
      icon: Home,
      label: 'Book all accommodation',
      detail: `${itinerary.route.length} places to confirm`,
    },
    { id: 'transport', icon: TrainFront, label: 'Reserve train tickets', detail: 'Book 2-4 weeks ahead for best prices' },
    { id: 'activities', icon: Compass, label: 'Pre-book key experiences', detail: 'Popular spots fill quickly' },
    { id: 'insurance', icon: Info, label: 'Travel insurance', detail: 'Medical + trip cancellation coverage' },
  ];

  return (
    <section className="border-t border-[#d7d0c2] py-12 sm:py-16">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Ready to go</p>
          <h2 className="mt-2 font-display text-4xl tracking-[-.04em]">Your pre-trip checklist</h2>
        </div>
        <p className="text-xs text-[#65706d]">
          {checked.length} of {checklistItems.length} complete
        </p>
      </div>
      <div className="mt-8 space-y-2">
        {checklistItems.map((item) => {
          const Icon = item.icon;
          const isChecked = checked.includes(item.id);
          return (
            <button
              key={item.id}
              onClick={() => toggleCheck(item.id)}
              className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left transition hover:-translate-y-0.5 ${
                isChecked ? 'border-[#6b9c7b] bg-[#e7f0e9]' : 'border-[#d7d0c2] bg-[#fbfaf6]'
              }`}
              data-testid={`button-checklist-${item.id}`}
            >
              <div
                className={`flex h-5 w-5 items-center justify-center rounded border ${
                  isChecked ? 'border-[#6b9c7b] bg-[#6b9c7b]' : 'border-[#b5bcb6]'
                }`}
              >
                {isChecked && <Check size={14} className="text-white" />}
              </div>
              <Icon size={18} className={isChecked ? 'text-[#6b9c7b]' : 'text-[#65706d]'} />
              <div className="flex-1">
                <p className={`text-sm font-semibold ${isChecked ? 'line-through opacity-60' : ''}`}>{item.label}</p>
                <p className="text-xs text-[#65706d]">{item.detail}</p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
