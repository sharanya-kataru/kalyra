import { firstChangedDay } from "@/lib/refinement-view";
import { planningStyle } from "@/lib/planning-style";
import { flightMetrics, flightDeltas, visibleFlightAlternatives } from "@/lib/flight-display";
import { weatherPresentation } from "@/lib/weather-label";
import { Fragment, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useRoute } from 'wouter';
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Compass,
  CloudSun,
  DollarSign,
  Home,
  Info,
  Luggage,
  MapPin,
  Plane,
  RefreshCw,
  Sparkles,
  TrainFront,
  Wallet,
} from 'lucide-react';
import { Logo } from '@/components/Logo';
import { walkingLabel } from '@/lib/walking-label';
import { TripMap } from '@/components/TripMap';
import { useTripContext } from '@/context/TripContext';
import { useAuth } from '@/context/AuthContext';
import { AuthDialog } from '@/components/AuthDialog';
import {
  useModifyItinerary,
  useRefreshLiveData,
  useSaveTrip,
  useGetTrip,
  getListTripsQueryKey,
} from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import type { ChangeMade, TripHealthScore } from '@workspace/api-client-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModificationHistoryItem {
  request: string;
  reasoning: string;
  changes: ChangeMade[];
  score_before: TripHealthScore | null;
  score_after: TripHealthScore | null;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Health Score UI helpers
// ---------------------------------------------------------------------------

const SCORE_COLORS: Record<string, { bar: string; text: string; bg: string; border: string }> = {
  Excellent:       { bar: 'bg-[#6b9c7b]', text: 'text-[#3d6b50]', bg: 'bg-[#e7f0e9]', border: 'border-[#b2d3bc]' },
  Good:            { bar: 'bg-[#bb7a52]', text: 'text-[#8b4f2a]', bg: 'bg-[#f5e9df]', border: 'border-[#d9b49a]' },
  Fair:            { bar: 'bg-[#c4a84c]', text: 'text-[#7a6420]', bg: 'bg-[#f5f0d9]', border: 'border-[#d9cc9a]' },
  'Needs attention': { bar: 'bg-[#b05050]', text: 'text-[#7a2828]', bg: 'bg-[#f5e0e0]', border: 'border-[#d9a4a4]' },
};

const OVERALL_COLORS: Record<string, string> = {
  Excellent: 'text-[#6b9c7b]',
  Good: 'text-[#e8bc5a]',
  Fair: 'text-[#d4a45a]',
  'Needs attention': 'text-[#c07070]',
};

const DIMENSION_LABELS: Record<string, string> = {
  experience_fit: 'Experience Fit',
  transportation_efficiency: 'Transport Efficiency',
  budget_efficiency: 'Budget Efficiency',
  uniqueness: 'Uniqueness',
  pacing: 'Pacing',
};

const DIMENSION_WEIGHTS: Record<string, string> = {
  experience_fit: '35%',
  transportation_efficiency: '13%',
  budget_efficiency: '20%',
  uniqueness: '10%',
  pacing: '22%',
};

type DimensionKey = 'experience_fit' | 'transportation_efficiency' | 'budget_efficiency' | 'uniqueness' | 'pacing';
const DIMENSIONS: DimensionKey[] = [
  'experience_fit',
  'pacing',
  'budget_efficiency',
  'transportation_efficiency',
  'uniqueness',
];

function formatUsd(value: unknown) {
  const amount = Number(value);
  return `$${(Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : 0).toLocaleString()}`;
}

function formatFlightDateTime(value: string | null | undefined) {
  return value ? value.replace('T', ' ') : 'Unavailable';
}

function formatCheckedAt(value: string | null | undefined) {
  if (!value) return 'Not checked';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not checked' : parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function SourcePill({ label, provider, freshness }: { label: string; provider?: string; freshness?: string }) {
  const isLive = label === 'LIVE';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono-custom text-[10px] uppercase tracking-wide ${
        isLive
          ? 'border-[#b2d3bc] bg-[#e7f0e9] text-[#3d6b50]'
          : 'border-[#d7d0c2] bg-[#f5f3ec] text-[#65706d]'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isLive ? 'bg-[#6b9c7b]' : 'bg-[#bb7a52]'}`} />
      {label}{provider ? ` · ${provider}` : ''}{freshness ? ` · ${freshness}` : ''}
    </span>
  );
}

function ScoreBadge({ label }: { label: string }) {
  const c = SCORE_COLORS[label] ?? SCORE_COLORS.Fair;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${c.bg} ${c.border} ${c.text}`}>
      {label}
    </span>
  );
}

function ScoreBar({ score, label }: { score: number; label: string }) {
  const c = SCORE_COLORS[label] ?? SCORE_COLORS.Fair;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e2ddd2]">
      <div
        className={`h-full rounded-full transition-all duration-500 ${c.bar}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

function ScoreDelta({ before, after }: { before: number; after: number }) {
  const delta = after - before;
  if (Math.abs(delta) < 1) return null;
  return (
    <span className={`ml-1.5 font-mono-custom text-[10px] ${delta > 0 ? 'text-[#6b9c7b]' : 'text-[#b05050]'}`}>
      {delta > 0 ? '+' : ''}{Math.round(delta)}
    </span>
  );
}

function TripHealthScoreCard({ score }: { score: TripHealthScore }) {
  const [expandedDim, setExpandedDim] = useState<DimensionKey | null>(null);
  const overallColor = OVERALL_COLORS[score.overall_label] ?? 'text-[#e8bc5a]';
  const rankedDimensions = [...DIMENSIONS].sort(
    (a, b) => score[b].score - score[a].score
  );

  const strongestDimension = rankedDimensions[0];
  const biggestOpportunity = rankedDimensions[rankedDimensions.length - 1];

  const strongest = score[strongestDimension];
  const opportunity = score[biggestOpportunity];

  return (
    <div className="rounded-2xl border border-[#d7d0c2] bg-[#fbfaf6]" data-testid="health-score-card">
      {/* Header */}
      <div className="flex items-start gap-5 border-b border-[#e2ddd2] p-5 sm:p-6">
        <div className="flex-1">
          <p className="font-mono-custom text-[10px] uppercase tracking-[.18em] text-[#bb7a52]">
            Experience Score
          </p>
          <p className="mt-1.5 text-sm leading-6 text-[#65706d]">
            Computed from your preferences, destination attributes, pacing, transportation, and budget.
          </p>
        </div>
        <div className="text-right">
          <p className={`font-display text-5xl leading-none ${overallColor}`} data-testid="health-score-overall">
            {score.overall}
          </p>
          <p className="mt-1 text-xs text-[#65706d]">out of 100</p>
          <div className="mt-2 flex justify-end">
            <ScoreBadge label={score.overall_label} />
          </div>
        </div>
      </div>

      {/* Decision summary */}
      <div className="grid gap-3 border-b border-[#e2ddd2] bg-[#f5f3ec] p-5 sm:grid-cols-2 sm:p-6">
        <div className="rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-4">
          <p className="font-mono-custom text-[10px] uppercase tracking-[.16em] text-[#6b9c7b]">
            Strongest fit
          </p>

          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-[#203b47]">
              {DIMENSION_LABELS[strongestDimension]}
            </p>

            <span className="font-mono-custom text-lg text-[#203b47]">
              {strongest.score}
            </span>
          </div>

          <p className="mt-2 text-xs leading-5 text-[#65706d]">
            {strongest.explanation}
          </p>
        </div>

        <div className="rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-4">
          <p className="font-mono-custom text-[10px] uppercase tracking-[.16em] text-[#bb7a52]">
            Biggest opportunity
          </p>

          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-[#203b47]">
              {DIMENSION_LABELS[biggestOpportunity]}
            </p>

            <span className="font-mono-custom text-lg text-[#203b47]">
              {opportunity.score}
            </span>
          </div>

          <p className="mt-2 text-xs leading-5 text-[#65706d]">
            {opportunity.explanation}
          </p>
        </div>
      </div>

      {/* Sub-scores */}
      <div className="divide-y divide-[#e2ddd2]">
        {DIMENSIONS.map((key) => {
          const sub = score[key];
          const isExpanded = expandedDim === key;
          return (
            <div key={key} data-testid={`score-dim-${key}`}>
              <button
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left hover:bg-[#f5f3ed]"
                onClick={() => setExpandedDim(isExpanded ? null : key)}
              >
                <div className="w-32 shrink-0">
                  <p className="text-xs font-semibold text-[#203b47]">{DIMENSION_LABELS[key]}</p>
                  <p className="mt-0.5 font-mono-custom text-[10px] text-[#a0a8a4]">
                    weight {DIMENSION_WEIGHTS[key]}
                  </p>
                </div>
                <div className="flex-1">
                  <ScoreBar score={sub.score} label={sub.label} />
                </div>
                <div className="grid w-40 shrink-0 grid-cols-[2rem_1fr_1rem] items-center gap-2">
                  <span className="text-right font-mono-custom text-sm text-[#203b47]">
                    {sub.score}
                  </span>

                  <div className="flex justify-center">
                    <ScoreBadge label={sub.label} />
                  </div>

                  <ChevronDown
                    size={14}
                    className={`shrink-0 text-[#a0a8a4] transition ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </button>
              {isExpanded && (
                <div className="border-t border-[#e8e5dc] bg-[#f5f3ec] px-5 py-3">
                  <p className="text-xs leading-5 text-[#65706d]">{sub.explanation}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}



// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Trip() {
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'auto',
      });
    });

    return () => cancelAnimationFrame(frame);
  }, []);
  const [, setLocation] = useLocation();
  const [, routeParams] = useRoute('/trip/:id');
  const savedTripId = routeParams?.id ?? null;

  const [tab, setTab] = useState<'overview' | 'days' | 'practical'>('overview');
  const [filter, setFilter] = useState('All days');
  const [checked, setChecked] = useState<string[]>([]);
  const [openDay, setOpenDay] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);
  const [modificationHistory, setModificationHistory] = useState<ModificationHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [saveAfterAuth, setSaveAfterAuth] = useState(false);
  const queryClient = useQueryClient();

    const {
    tripId,
    setTripId,
    itinerary,
    setItinerary,
    planData,
    setPlanData,
  } = useTripContext();
  const { user, logout } = useAuth();

  const tripToLoadId = savedTripId ?? tripId;
  const savedTripQuery = useGetTrip(tripToLoadId ?? '', {
  query: {
    queryKey: ['/api/trips', tripToLoadId],
    enabled: Boolean(tripToLoadId),
  },
});
  const saved = Boolean(savedTripQuery.data?.is_saved);
  const travelerCount = Math.max(1, Number(planData?.travelerCount) || 1);
  const { toast } = useToast();
  const modifyItinerary = useModifyItinerary();
  const refreshLiveData = useRefreshLiveData();
  const saveTrip = useSaveTrip();

    useEffect(() => {
    if (!savedTripId || itinerary || !savedTripQuery.data) return;

    const trip = savedTripQuery.data;

    setTripId(trip.id);
    setPlanData({
      destination: trip.destination,
      startingLocation: trip.starting_location,
      startDate: trip.start_date,
      endDate: trip.end_date,
      travelerCount: String(trip.traveler_count),
      budget: String(trip.budget),
      budgetPreference: trip.budget_preference,
      travelerProfile: trip.traveler_profile,
    });

    if (trip.latest_itinerary) {
      setItinerary(trip.latest_itinerary);
    }
  }, [
    savedTripId,
    savedTripQuery.data,
    itinerary,
    setTripId,
    setPlanData,
    setItinerary,
  ]);

  useEffect(() => {
    if (savedTripId) return;
    if (!tripId || !itinerary) {
      setLocation('/plan');
    }
  }, [savedTripId, tripId, itinerary, setLocation]);

  useEffect(() => {
    if (!saveAfterAuth || !user || !tripId || saved || saveTrip.isPending) {
      return;
    }

    setSaveAfterAuth(false);

    saveTrip.mutate(
      { id: tripId },
      {
        onSuccess: (trip) => {
          queryClient.setQueryData(['/api/trips', trip.id], trip);
          void queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
          toast({
            title: 'Trip saved',
            description: 'You can now find this trip in My Trips.',
          });
        },
        onError: (error) => {
          console.error('Failed to save trip after authentication:', error);
          toast({
            title: 'Could not save trip',
            description: 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  }, [saveAfterAuth, user, tripId, saved, saveTrip, toast, queryClient]);

  if (savedTripId && savedTripQuery.isLoading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#f3f0e8] text-[#203b47]">
        <p className="font-mono-custom text-xs uppercase tracking-[.16em] text-[#65706d]">
          Loading your trip…
        </p>
      </div>
    );
  }

  if (savedTripId && savedTripQuery.isError) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[#f3f0e8] px-5 text-center text-[#203b47]">
        <p className="font-mono-custom text-[10px] uppercase tracking-[.16em] text-[#bb7a52]">
          Saved trip
        </p>
        <h1 className="mt-3 font-display text-3xl">
          We couldn't load this trip
        </h1>
        <button
          type="button"
          onClick={() => setLocation('/my-trips')}
          className="mt-6 rounded-full bg-[#203b47] px-5 py-2.5 text-xs font-semibold text-[#f5f0e6]"
        >
          Back to My Trips
        </button>
      </div>
    );
  }

  if (!tripId || !itinerary) {
    return null;
  }

  const visibleDays =
    filter === 'All days'
      ? itinerary.daily_itinerary
      : itinerary.daily_itinerary.filter((d) => d.location.includes(filter));

  const toggleCheck = (id: string) => {
    setChecked(checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id]);
    toast({ title: checked.includes(id) ? 'Removed from list' : 'Added to your ready list' });
  };

  const handleChatSubmit = () => {
    if (!chatInput.trim() || modifyItinerary.isPending) return;
    const requestText = chatInput;
    setChatInput('');

    modifyItinerary.mutate(
      { id: tripId, data: { user_request: requestText } },
      {
        onSuccess: (data) => {
          const changedDay = firstChangedDay(itinerary.daily_itinerary, data.itinerary.daily_itinerary);
          setItinerary(data.itinerary);
          if (planData && data.itinerary.daily_itinerary.length) {
            setPlanData({ ...planData, startDate: data.itinerary.daily_itinerary[0].date,
              endDate: data.itinerary.daily_itinerary.at(-1)!.date });
          }
          if (changedDay >= 0) {
            setFilter('All days');
            setOpenDay(changedDay);
            setTab('days');
          }
          setModificationHistory((prev) => [
            {
              request: requestText,
              reasoning: data.reasoning,
              changes: data.changes_made,
              score_before: data.score_before ?? null,
              score_after: data.score_after ?? null,
              timestamp: new Date(),
            },
            ...prev,
          ]);
          const scoreDelta =
            data.score_after && data.score_before
              ? Math.round(data.score_after.overall - data.score_before.overall)
              : null;
          toast({
            title: data.changes_made.length === 0 ? 'No itinerary changes' : scoreDelta !== null
              ? `Trip updated · Score ${scoreDelta >= 0 ? '+' : ''}${scoreDelta}`
              : 'Trip updated',
            description: data.reasoning.slice(0, 120) + (data.reasoning.length > 120 ? '…' : ''),
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

  const handleSaveTrip = () => {
    if (!tripId || saved || saveTrip.isPending) return;

    if (!user) {
      setSaveAfterAuth(true);
      setAuthOpen(true);
      return;
    }

    saveTrip.mutate(
      { id: tripId },
      {
        onSuccess: (trip) => {
          queryClient.setQueryData(['/api/trips', trip.id], trip);
          void queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
          toast({
            title: 'Trip saved',
            description: 'You can now find this trip in My Trips.',
          });
        },
        onError: (error) => {
          console.error('Failed to save trip:', error);
          toast({
            title: 'Could not save trip',
            description: 'Please try again.',
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleRefreshLiveData = () => {
    if (!tripId || refreshLiveData.isPending) return;
    refreshLiveData.mutate(
      { id: tripId },
      {
        onSuccess: (data) => {
          setItinerary(data);
          toast({ title: 'Live travel data refreshed', description: 'Flight prices and available weather forecasts are up to date.' });
        },
        onError: () => {
          toast({ title: 'Refresh failed', description: 'We kept your existing itinerary data. Please try again.', variant: 'destructive' });
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

  const totalNights = itinerary.route.reduce((sum, stop) => sum + stop.nights, 0);
  const baseCount = itinerary.route.length;
  const locationNames = itinerary.route.map((r) => r.location).join(' → ');

  return (
    <div className="page-grain min-h-[100dvh] bg-[#f3f0e8] text-[#203b47]">
      <header className="border-b border-[#d7d0c2] bg-[#f3f0e8]/90">
        <div className="mx-auto flex max-w-[1220px] items-center justify-between px-5 py-5 sm:px-8">
          <Logo />
          <div className="hidden items-center gap-3 sm:flex">
            <span className={`h-2 w-2 rounded-full ${saved ? 'bg-[#6b9c7b]' : 'bg-[#bb7a52]'}`} />
            <span className="text-xs text-[#65706d]">
              {saved ? 'Saved to your account' : 'Trip is ready to save'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!saved && (
              <button
                type="button"
                onClick={handleSaveTrip}
                disabled={saveTrip.isPending}
                className="rounded-full border border-[#c9c1b2] px-4 py-2 text-xs font-semibold transition hover:border-[#203b47]"
              >
                {saveTrip.isPending ? 'Saving…' : 'Save trip'}
              </button>
            )}

            {user && (
              <>
                <button
                  type="button"
                  onClick={() => setLocation('/my-trips')}
                  className="hidden rounded-full px-3 py-2 text-xs font-semibold transition hover:bg-[#e8e3d8] sm:block"
                >
                  My Trips
                </button>

                <button
                  type="button"
                  onClick={() => logout()}
                  className="hidden rounded-full px-3 py-2 text-xs text-[#65706d] transition hover:text-[#203b47] sm:block"
                >
                  Log out
                </button>
              </>
            )}

            {!user && (
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="hidden rounded-full px-3 py-2 text-xs font-semibold transition hover:bg-[#e8e3d8] sm:block"
              >
                Log in
              </button>
            )}

            <button
              type="button"
              onClick={() => setLocation('/plan')}
              className="rounded-full border border-[#c9c1b2] px-4 py-2 text-xs font-semibold transition hover:border-[#203b47]"
              data-testid="link-new-trip"
            >
              New trip
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1220px] px-5 pb-32 sm:px-8">
        {/* Hero */}
        <div className="border-b border-[#d7d0c2] py-12 sm:py-20">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div>
              <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">
                Your route, considered
              </p>
              <h1 className="mt-4 font-display text-5xl leading-[.93] tracking-[-.06em] sm:text-8xl">
                Your {planData?.destination || "trip"} itinerary
              </h1>
              <p className="mt-6 max-w-3xl text-base leading-relaxed text-[#65706d] sm:text-lg">
                {itinerary.trip_strategy}
              </p>
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wider">
                  Daily planning style · {planningStyle(planData?.travelerProfile.optimization_mode).label}
                </p>
                <p className="mt-1 max-w-2xl text-sm text-[#65706d]">
                  {planningStyle(planData?.travelerProfile.optimization_mode).description}
                </p>
              </div>
              <p className="mt-7 flex items-center gap-2 text-sm text-[#65706d]">
                <MapPin size={15} /> {locationNames}
              </p>
            </div>
            <div className="flex flex-col items-end gap-4">
              {/* Compact overall score in hero */}
              {itinerary.health_score && (
                <div className="flex items-center gap-3 rounded-xl border border-[#d7d0c2] bg-[#f5f3ec] px-4 py-2.5">
                  <div>
                    <p className="font-mono-custom text-[10px] uppercase tracking-widest text-[#bb7a52]">
                      Experience Score
                    </p>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span
                        className={`font-display text-2xl ${OVERALL_COLORS[itinerary.health_score.overall_label] ?? 'text-[#e8bc5a]'}`}
                      >
                        {itinerary.health_score.overall}
                      </span>
                      <span className="text-xs text-[#65706d]">/ 100</span>
                      <ScoreBadge label={itinerary.health_score.overall_label} />
                    </div>
                  </div>
                </div>
              )}
              <div className="max-w-xs text-right text-sm leading-6 text-[#65706d]">
                <p>
                  {itinerary.total_days} days · {itinerary.total_nights} nights · {baseCount} {baseCount === 1 ? 'base' : 'bases'}
                </p>
                <p className="mt-1">{itinerary.reasoning}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="sticky top-0 z-20 -mx-5 flex gap-1 overflow-x-auto border-b border-[#d7d0c2] bg-[#f3f0e8]/95 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8">
          {(['overview', 'days', 'practical'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold capitalize ${
                tab === t ? 'bg-[#203b47] text-[#f5f0e6]' : 'text-[#65706d] hover:bg-[#e7e5d9]'
              }`}
              data-testid={`button-trip-${t}`}
            >
              {t === 'days' ? 'Day by day' : t === 'practical' ? 'Practical notes' : 'Overview'}
            </button>
          ))}
        </div>

        {/* Route visualization belongs to Overview. */}
        {tab === 'overview' && (
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
                        <span className={`flex h-12 w-12 items-center justify-center rounded-full ${colors[i % colors.length]} font-mono-custom text-xs`}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div>
                          <p className="font-bold">{stop.location}</p>
                          <p className="text-xs text-[#65706d]">{stop.nights} nights</p>
                          <details className="mt-2 max-w-[260px] text-xs text-[#65706d]">
                            <summary className="cursor-pointer font-semibold text-[#34594b]">Why Kalyra chose this</summary>
                            <p className="mt-2 leading-relaxed">{stop.why_selected || 'Detailed selection reasoning is unavailable for this saved stop.'}</p>
                            {stop.why_selected && stop.experience_score !== undefined && (
                              <p className="mt-2">Overall destination fit: {stop.experience_score}/100</p>
                            )}
                          </details>
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
            <TripMap itinerary={itinerary} />
            {itinerary.route.some((r) => r.transport_to_next) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#e7e5d9] px-4 py-3 text-xs text-[#65706d]">
                <TrainFront size={16} />
                {itinerary.route.map(
                  (stop, i) =>
                    stop.transport_to_next && (
                      <div key={i} className="flex items-center gap-2">
                        <span>{stop.location} → {itinerary.route[i + 1]?.location}</span>
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

        {/* ── OVERVIEW TAB ──────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <>
            {/* Destinations + budget */}
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
                        <p className="mt-3 text-xs leading-5 opacity-70">{d.reasoning.slice(0, 80)}…</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-2xl bg-[#203b47] p-6 text-[#f5f0e6] sm:p-7">
                <Wallet size={19} className="text-[#e8bc5a]" />
                <p className="mt-10 text-xs text-[#aebeb5]">Estimated trip cost</p>
                <p className="mt-2 font-display text-4xl">
                  {formatUsd(itinerary.budget_summary.total_estimated)}
                </p>
                <p className="mt-2 text-xs text-[#c0cec7]">
                  {formatUsd(itinerary.budget_summary.total_estimated / travelerCount)} per person
                  {' · '}
                  {travelerCount} traveler{travelerCount === 1 ? '' : 's'}
                </p>
                <div className="mt-7 border-t border-white/15 pt-4 text-xs text-[#c0cec7]">
                  {itinerary.budget_breakdown.slice(0, 3).map((item) => (
                    <div key={item.category} className="flex justify-between py-1">
                      <span>{item.category}</span>
                      <span>{formatUsd(item.estimated_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {itinerary.live_data && (
              <LiveTravelData
                data={itinerary.live_data}
                onRefresh={handleRefreshLiveData}
                refreshing={refreshLiveData.isPending}
                travelerCount={travelerCount}
              />
            )}

            {/* ── TRIP HEALTH SCORE ─────────────────────────────────────── */}
            {itinerary.health_score && (
              <section className="border-t border-[#d7d0c2] py-12 sm:py-16">
                <div className="mb-8 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                  <div>
                    <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">
                      Optimization
                    </p>
                    <h2 className="mt-2 font-display text-4xl tracking-[-.04em]">
                      How well this trip fits you
                    </h2>
                  </div>
                  <p className="max-w-xs text-sm leading-6 text-[#65706d]">
                  See what strengthens the trip, where the tradeoffs are, and what influenced each score.
                  </p>
                </div>
                <TripHealthScoreCard score={itinerary.health_score} />
              </section>
            )}

            {/* Checklist */}
            <Checklist checked={checked} toggleCheck={toggleCheck} itinerary={itinerary} />
          </>
        )}

        {/* ── DAYS TAB ─────────────────────────────────────────────────── */}
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
                        {(['morning', 'afternoon', 'evening'] as const).map((period, index, periods) => {
                          const previousPeriod = periods[index - 1];
                          const walkingLeg = day.walking_legs?.find((leg) =>
                            leg.mode === 'walk' && leg.from === previousPeriod && leg.to === period
                          );
                          return (
                          <Fragment key={period}>
                            {walkingLeg && (
                              <div data-testid={`walking-leg-${day.day}-${walkingLeg.from}-${walkingLeg.to}`} className="border-l-2 border-dashed border-[#bb7a52]/40 py-2 pl-3 text-xs text-[#34594b]">
                                <span aria-hidden="true">↓ 🚶 </span>{walkingLabel(walkingLeg.duration_seconds, walkingLeg.distance_meters)}
                                <span className="mt-1 block text-[11px] text-[#65706d]">Geoapify route estimate · to {period}</span>
                              </div>
                            )}
                          <div>
                            <p className="text-xs font-semibold capitalize text-[#bb7a52]">{period}</p>
                            <p className="mt-1 text-sm font-semibold">{day[period].activity}</p>
                            <p className="mt-1 text-sm text-[#65706d]">{day[period].description}</p>
                          </div>
                          </Fragment>
                          );
                        })}
                        <div>
                          <p className="text-xs font-semibold text-[#bb7a52]">Food recommendations</p>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-[#65706d]">
                            {day.food_recommendations.map((recommendation) => <li key={recommendation}>{recommendation}</li>)}
                          </ul>
                        </div>
                        {day.transportation && (
                          <div>
                            <p className="text-xs font-semibold text-[#bb7a52]">Transport</p>
                            <p className="mt-1 text-sm text-[#65706d]">
                              {day.transportation.mode} · {day.transportation.details}
                              {day.transportation.duration ? ` (${day.transportation.duration})` : ""}
                            </p>
                          </div>
                        )}
                        {day.weather && (
                          <div className="rounded-xl border border-[#c7d8cc] bg-[#eef4ef] p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="flex items-center gap-2 text-xs font-semibold text-[#3d6b50]">
                                <CloudSun size={14} /> {weatherPresentation(day.weather).title}
                              </p>
                              <SourcePill
                                label={day.weather.source_metadata.label}
                                provider={day.weather.source_metadata.provider}
                              />
                            </div>
                            <p className="mt-2 text-sm font-semibold text-[#203b47]">
                              {Math.round(day.weather.min_temperature_c)}–{Math.round(day.weather.max_temperature_c)}°C · {day.weather.description}
                            </p>
                            {weatherPresentation(day.weather).qualifier && (
                              <p className="mt-1 text-xs text-[#65706d]">{weatherPresentation(day.weather).qualifier}</p>
                            )}
                            {weatherPresentation(day.weather).precipitation && (
                              <p className="mt-1 text-xs text-[#65706d]">
                                {weatherPresentation(day.weather).precipitation}
                              </p>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 border-t border-[#d7d0c2] pt-3 text-xs text-[#65706d]">
                          <DollarSign size={14} />
                          <span>Estimated daily cost: {formatUsd(day.estimated_daily_cost_usd)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── PRACTICAL TAB ─────────────────────────────────────────────── */}
        {tab === 'practical' && (
          <section className="py-12">
            <div className="mb-12">
              <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Practical notes</p>
              <h2 className="mt-2 font-display text-4xl tracking-[-.04em]">Keep the good parts easy</h2>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-5">
                  <p className="text-xs font-semibold text-[#203b47]">Arrival + departure</p>
                  <p className="mt-2 text-xs leading-5 text-[#65706d]">
                    Day 1 begins in {itinerary.daily_itinerary[0]?.location ?? itinerary.route[0]?.location}; the final day leaves room to depart from {itinerary.daily_itinerary[itinerary.daily_itinerary.length - 1]?.location ?? itinerary.route[itinerary.route.length - 1]?.location}.
                  </p>
                </div>
                <div className="rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-5">
                  <p className="text-xs font-semibold text-[#203b47]">Transfers</p>
                  <p className="mt-2 text-xs leading-5 text-[#65706d]">
                    {itinerary.route.filter((stop) => stop.transport_to_next).length} inter-city transfer{itinerary.route.filter((stop) => stop.transport_to_next).length === 1 ? '' : 's'} are built into the route. Transfer days are intentionally lighter.
                  </p>
                </div>
                <div className="rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-5">
                  <p className="text-xs font-semibold text-[#203b47]">Reserve first</p>
                  <p className="mt-2 text-xs leading-5 text-[#65706d]">
                    Confirm accommodation in each base, then protect the specific experiences and transport segments that matter most to you.
                  </p>
                </div>
              </div>
               <p className="mt-4 text-xs text-[#76827d]">
                 Flight prices and forecasts are labeled by source. Accommodation, activities, and local transport remain Kalyra estimates.
               </p>
            </div>
            <div className="mb-8">
              <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Budget breakdown</p>
              <h2 className="mt-2 font-display text-4xl tracking-[-.04em]">Where your money goes</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {itinerary.budget_breakdown.map((item) => (
                <div key={item.category} className="rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-5">
                  <p className="text-xs text-[#bb7a52]">{item.category}</p>
                  <p className="mt-2 font-display text-3xl">{formatUsd(item.estimated_amount)}</p>
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

      {/* ── REFINE CHAT PANEL ─────────────────────────────────────────────── */}
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
                {itinerary.health_score && (
                  <span className="hidden text-xs text-[#65706d] sm:block">
                    — score updates instantly when you make changes
                  </span>
                )}
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
              <div className="flex gap-2 overflow-x-auto pb-1">
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
                  placeholder="Ask your travel advisor to adjust the trip…"
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
                  {modifyItinerary.isPending ? 'Updating…' : 'Send'}
                </button>
              </div>

              {/* Modification history */}
              {modificationHistory.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="flex items-center gap-2 text-xs text-[#65706d] hover:text-[#203b47]"
                    data-testid="button-toggle-history"
                  >
                    <ChevronRight size={14} className={`transition ${showHistory ? 'rotate-90' : ''}`} />
                    Refinement history ({modificationHistory.length})
                  </button>
                  {showHistory && (
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-xl border border-[#d7d0c2] bg-[#fbfaf6] p-3">
                      {modificationHistory.map((item, i) => (
                        <div key={i} className="border-b border-[#e2ddd2] pb-3 last:border-0">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-xs font-semibold">{item.request}</p>
                            {item.score_before && item.score_after && (
                              <div className="flex shrink-0 items-center gap-1">
                                <span className="font-mono-custom text-[11px] text-[#65706d]">
                                  {item.score_before.overall}
                                </span>
                                <span className="text-[10px] text-[#a0a8a4]">→</span>
                                <span className={`font-mono-custom text-[11px] font-semibold ${
                                  item.score_after.overall >= item.score_before.overall
                                    ? 'text-[#6b9c7b]'
                                    : 'text-[#b05050]'
                                }`}>
                                  {item.score_after.overall}
                                </span>
                                <ScoreDelta
                                  before={item.score_before.overall}
                                  after={item.score_after.overall}
                                />
                              </div>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-[#65706d]">{item.reasoning}</p>
                          {item.changes.length > 0 && (
                            <ul className="mt-2 space-y-0.5">
                              {item.changes.map((change, ci) => (
                                <li key={ci} className="flex items-start gap-2 text-xs text-[#65706d]">
                                  <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-[#6b9c7b]" />
                                  <span>{change.description}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {/* Sub-score deltas */}
                          {item.score_before && item.score_after && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {DIMENSIONS.map((dim) => {
                                const before = item.score_before![dim].score;
                                const after = item.score_after![dim].score;
                                const delta = after - before;
                                if (Math.abs(delta) < 2) return null;
                                return (
                                  <span
                                    key={dim}
                                    className={`rounded-full px-2 py-0.5 text-[10px] ${
                                      delta > 0
                                        ? 'bg-[#e7f0e9] text-[#3d6b50]'
                                        : 'bg-[#f5e0e0] text-[#7a2828]'
                                    }`}
                                  >
                                    {DIMENSION_LABELS[dim]} {delta > 0 ? '+' : ''}{Math.round(delta)}
                                  </span>
                                );
                              })}
                            </div>
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

      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checklist sub-component
// ---------------------------------------------------------------------------

function LiveTravelData({
  data,
  onRefresh,
  refreshing,
  travelerCount,
}: {
  data: any;
  onRefresh: () => void;
  refreshing: boolean;
  travelerCount: number;
}) {
  const flight = data.flight_search;
  const selected = flight?.selected_offer;
  const isNearbyDateEstimate =
    flight?.status === 'unavailable' && selected != null;
  const weatherCount = data.weather?.length ?? 0;
  const alternatives = visibleFlightAlternatives(flight);

  return (
    <section className="border-t border-[#d7d0c2] py-12 sm:py-16" data-testid="live-travel-data">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">Live travel data</p>
          <h2 className="mt-2 font-display text-4xl tracking-[-.04em]">Decisions with a little more signal.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#65706d]">
            Provider-backed values are kept separate from Kalyra recommendations and estimates.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-[#c9c1b2] px-4 py-2.5 text-xs font-semibold transition hover:border-[#203b47] disabled:cursor-wait disabled:opacity-50"
          data-testid="button-refresh-live-data"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh live data'}
        </button>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#d7d0c2] bg-[#fbfaf6] p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <Plane size={17} className="text-[#bb7a52]" />
              <p className="text-sm font-semibold">Flight recommendation</p>
            </div>
            <SourcePill
              label={flight?.source_metadata?.label ?? 'FALLBACK'}
              provider={flight?.source_metadata?.provider}
              freshness={flight?.source_metadata?.freshness}
            />
          </div>
          {selected && !isNearbyDateEstimate ? (
            <>
              <div className="mt-7 flex items-end justify-between gap-3">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide">Recommended</p>
                  <p className="font-display text-4xl">{formatUsd(selected.total_price_usd)} total</p>
                  <p className="mt-1 text-xs text-[#65706d]">
                    {formatUsd(selected.total_price_usd / travelerCount)} per person
                    {' · '}
                    {travelerCount} traveler{travelerCount === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 text-xs text-[#65706d]">
                    {flight.origin} → {flight.destination} · {selected.carriers.join(' + ') || 'Selected carriers'}
                  </p>
                </div>
                <p className="text-right text-xs text-[#65706d]">
                  {flightMetrics(selected)}
                </p>
              </div>
              <p className="mt-4 text-[10px] uppercase tracking-wide text-[#65706d]">Why Kalyra chose this</p>
              <p className="mt-1 text-xs leading-5 text-[#65706d]">
                {flight.recommendation_reason ?? 'The selected live offer for this itinerary.'}
              </p>
              {data.planning_note && (
                <p className="mt-3 rounded-lg bg-[#f5f3ec] px-3 py-2 text-xs leading-5 text-[#65706d]">
                  {data.planning_note}
                </p>
              )}
              <p className="mt-3 text-[10px] uppercase tracking-wide text-[#a0a8a4]">
                Last checked {formatCheckedAt(flight.source_metadata?.retrieved_at)}
              </p>
              {alternatives.length > 0 && (
                <div className="mt-4 border-t border-[#e2ddd2] pt-4">
                  <p className="text-[10px] uppercase tracking-wide text-[#65706d]">Other ways to optimize</p>
                  <div className="mt-2 space-y-2">
                    {alternatives.map((alternative) => (
                      <div key={`${alternative.origin}-${alternative.destination}-${alternative.offer.provider_offer_id}`}
                        className="rounded-lg bg-[#f5f3ec] px-3 py-3 text-xs">
                        <div className="flex flex-wrap justify-between gap-2 font-semibold">
                          <p>{(alternative.distinctions ?? [alternative.kind]).map((kind) => kind === 'cheapest' ? 'Cheapest' : 'Fastest').join(' · ')} · {alternative.origin} → {alternative.destination}</p>
                          <p>{formatUsd(alternative.offer.total_price_usd)} total</p>
                        </div>
                        <p className="mt-1 text-[#65706d]">{flightMetrics(alternative.offer)}</p>
                        <p className="mt-2 font-semibold">{flightDeltas(alternative.offer, selected)}</p>
                        <p className="mt-1 text-[#65706d]">{alternative.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="mt-7">
              {isNearbyDateEstimate ? (
                <>
                  <p className="font-display text-4xl">
                    {formatUsd(selected.total_price_usd)} estimated total
                  </p>
                  <p className="mt-1 text-xs text-[#65706d]">
                    {formatUsd(selected.total_price_usd / travelerCount)} per person
                    {' · '}
                    {travelerCount} traveler{travelerCount === 1 ? '' : 's'}
                  </p>
                  <p className="mt-4 text-xs leading-5 text-[#65706d]">
                    {flight?.message}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-3xl">Flight pricing unavailable</p>
                  <p className="mt-4 text-xs leading-5 text-[#65706d]">
                    {flight?.message ??
                      'Kalyra could not find usable fares for your exact or nearby travel dates.'}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#d7d0c2] bg-[#fbfaf6] p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <CloudSun size={17} className="text-[#bb7a52]" />
              <p className="text-sm font-semibold">Daily weather</p>
            </div>

          </div>
          {weatherCount > 0 ? (
            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.weather.slice(0, 6).map((summary: any) => (
                <div key={`${summary.location}-${summary.date}`} className="rounded-xl bg-[#eef4ef] p-3">
                  <p className="truncate text-[10px] font-semibold text-[#3d6b50]">{summary.location}</p>
                  <p className="mt-2 text-xs text-[#65706d]">{summary.date}</p>
                  <p className="mt-1 text-sm font-semibold">{Math.round(summary.min_temperature_c)}–{Math.round(summary.max_temperature_c)}°C</p>
                  <p className="mt-1 text-[10px] font-semibold">{weatherPresentation(summary).title}</p>
                  <SourcePill label={summary.source_metadata.label} provider={summary.source_metadata.provider} />
                  <p className="mt-1 text-[10px] text-[#65706d]">{summary.description}</p>
                  <p className="mt-1 text-[10px] text-[#65706d]">{weatherPresentation(summary).qualifier}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-7 text-sm leading-6 text-[#65706d]">
              Weather information is unavailable. Check local conditions closer to departure.
            </p>
          )}
        </div>
      </div>
    </section>
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
    { id: 'accommodation', icon: Home, label: 'Book all accommodation', detail: `${itinerary.route.length} places to confirm` },
    { id: 'transport', icon: TrainFront, label: 'Reserve train tickets', detail: 'Book 2–4 weeks ahead for best prices' },
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
              <div className={`flex h-5 w-5 items-center justify-center rounded border ${isChecked ? 'border-[#6b9c7b] bg-[#6b9c7b]' : 'border-[#b5bcb6]'}`}>
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
