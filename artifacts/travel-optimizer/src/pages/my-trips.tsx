import { ArrowUpRight, CalendarDays, ChevronRight, Compass, Users } from 'lucide-react';
import { useLocation } from 'wouter';
import { useListTrips } from '@workspace/api-client-react';
import { Logo } from '@/components/Logo';

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatBudget(value: unknown, currency: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency} —`;

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function MyTrips() {
  const [, setLocation] = useLocation();
  const tripsQuery = useListTrips();
  const trips = tripsQuery.data ?? [];

  return (
    <div className="page-grain min-h-[100dvh] bg-[#f3f0e8] text-[#203b47]">
      <header className="border-b border-[#d7d0c2] bg-[#f3f0e8]/90">
        <div className="mx-auto flex max-w-[1220px] items-center justify-between px-5 py-5 sm:px-8">
          <Logo />
          <button
            type="button"
            onClick={() => setLocation('/plan')}
            className="rounded-full bg-[#203b47] px-5 py-2.5 text-xs font-semibold text-[#f5f0e6] transition hover:bg-[#315565]"
          >
            Plan a new trip <ArrowUpRight className="ml-1 inline-block" size={14} />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1220px] px-5 pb-24 pt-12 sm:px-8 sm:pt-16">
        <div className="mb-10">
          <p className="font-mono-custom text-[10px] uppercase tracking-[.18em] text-[#bb7a52]">
            Your account
          </p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl">
            My Trips
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[#65706d]">
            Your saved journeys, ready whenever you are.
          </p>
        </div>

        {tripsQuery.isLoading && (
          <div className="rounded-2xl border border-[#d7d0c2] bg-[#fbfaf6] p-8 text-sm text-[#65706d]">
            Loading your trips…
          </div>
        )}

        {tripsQuery.isError && (
          <div className="rounded-2xl border border-[#d9a4a4] bg-[#f5e0e0] p-8">
            <p className="text-sm font-semibold text-[#7a2828]">
              We couldn't load your trips.
            </p>
            <p className="mt-1 text-xs text-[#7a2828]/80">
              Please refresh the page and try again.
            </p>
          </div>
        )}

        {!tripsQuery.isLoading && !tripsQuery.isError && trips.length === 0 && (
          <div className="rounded-2xl border border-[#d7d0c2] bg-[#fbfaf6] p-10 text-center">
            <Compass className="mx-auto text-[#bb7a52]" size={30} />
            <h2 className="mt-4 font-display text-2xl">No saved trips yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#65706d]">
              Create a trip and save it to your account. You'll be able to come
              back to it anytime.
            </p>
            <button
              type="button"
              onClick={() => setLocation('/plan')}
              className="mt-6 rounded-full bg-[#203b47] px-5 py-2.5 text-xs font-semibold text-[#f5f0e6]"
            >
              Start planning
            </button>
          </div>
        )}

        {trips.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {trips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                onClick={() => setLocation(`/trip/${trip.id}`)}
                className="group rounded-2xl border border-[#d7d0c2] bg-[#fbfaf6] p-6 text-left transition hover:-translate-y-0.5 hover:border-[#bb7a52] hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-mono-custom text-[10px] uppercase tracking-[.16em] text-[#bb7a52]">
                      Saved trip
                    </p>
                    <h2 className="mt-2 font-display text-2xl">
                      {trip.destination}
                    </h2>
                  </div>

                  <ChevronRight
                    size={20}
                    className="mt-1 shrink-0 text-[#65706d] transition group-hover:translate-x-1"
                  />
                </div>

                <div className="mt-6 grid gap-3 text-xs text-[#65706d] sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <CalendarDays size={14} />
                    <span>
                      {formatDate(trip.start_date)} – {formatDate(trip.end_date)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Users size={14} />
                    <span>
                      {trip.traveler_count}{' '}
                      {trip.traveler_count === 1 ? 'traveler' : 'travelers'}
                    </span>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-[#e2ddd2] pt-4">
                  <span className="font-mono-custom text-sm text-[#203b47]">
                    {formatBudget(trip.budget, trip.currency ?? 'USD')}
                  </span>

                  <span className="text-[10px] uppercase tracking-wide text-[#65706d]">
                    {trip.latest_itinerary ? 'Itinerary ready' : 'Trip saved'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
