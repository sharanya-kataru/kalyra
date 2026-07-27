import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, ChevronDown, Clock3, RouteIcon, Sparkles } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useTripContext } from '@/context/TripContext';
import { useAnalyzeTrip, useGenerateItinerary } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';

export default function Analysis() {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(0);
  const { tripId, analysis, setAnalysis, setItinerary } = useTripContext();
  const { toast } = useToast();

  const analyzeTrip = useAnalyzeTrip();
  const generateItinerary = useGenerateItinerary();

  useEffect(() => {
    if (!tripId) {
      setLocation('/plan');
      return;
    }

    if (!analysis && !analyzeTrip.isPending) {
      analyzeTrip.mutate(
        { id: tripId },
        {
          onSuccess: (data) => {
            setAnalysis(data);
          },
          onError: (error) => {
            console.error('Failed to analyze trip:', error);
            toast({
              title: 'Analysis failed',
              description: 'Unable to analyze your trip. Please try again.',
              variant: 'destructive',
            });
          },
        }
      );
    }
  }, [tripId]);

  const handleGenerate = () => {
    if (!tripId) return;

    generateItinerary.mutate(
      { id: tripId },
      {
        onSuccess: (data) => {
          setItinerary(data);
          setLocation('/trip');
        },
        onError: (error) => {
          console.error('Failed to generate itinerary:', error);
          toast({
            title: 'Generation failed',
            description: 'Unable to generate your itinerary. Please try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  if (!tripId) {
    return null;
  }

  const isLoading = analyzeTrip.isPending || !analysis;

  return (
    <div className="page-grain min-h-[100dvh] bg-[#f3f0e8] text-[#203b47]">
      <div className="mx-auto max-w-[1180px] px-5 pb-20 sm:px-8">
        <div className="flex items-center justify-between py-6 sm:py-8">
          <Logo />
          <button
            onClick={() => setLocation('/plan')}
            className="flex items-center gap-2 text-xs font-semibold text-[#65706d]"
            data-testid="link-edit-brief"
          >
            <ArrowLeft size={15} /> Edit brief
          </button>
        </div>
        <div className="border-b border-[#d7d0c2] pb-16 pt-12 sm:pt-24">
          {isLoading ? (
            <div className="max-w-3xl">
              <div className="h-4 w-48 animate-pulse rounded bg-[#d7d0c2]" />
              <div className="mt-5 h-24 w-full max-w-xl animate-pulse rounded bg-[#d7d0c2]" />
              <div className="mt-8 h-16 w-full max-w-lg animate-pulse rounded bg-[#d7d0c2]" />
              <p className="mt-6 text-sm text-[#65706d]">Analyzing your preferences and crafting your route...</p>
            </div>
          ) : (
            <>
              <div className="max-w-3xl">
                <p className="rise font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">
                  Your direction is taking shape
                </p>
                <h1 className="rise rise-delay-1 mt-5 font-display text-5xl leading-[.94] tracking-[-.06em] sm:text-8xl">
                  {analysis?.trip_strategy || 'Your personalized route'}
                </h1>
                <p className="rise rise-delay-2 mt-8 max-w-xl text-[16px] leading-7 text-[#65706d]">
                  {analysis?.reasoning || 'Crafting a route that matches your travel style...'}
                </p>
              </div>
              <div className="mt-14 grid max-w-4xl gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#203b47] p-5 text-[#f5f0e6]">
                  <Sparkles className="text-[#e8bc5a]" size={18} />
                  <p className="mt-8 text-xs text-[#aebeb5]">The strategy</p>
                  <p className="mt-1 font-display text-2xl">
                    {analysis?.trip_strategy?.split('.')[0] || 'Considered travel'}
                  </p>
                </div>
                <div className="rounded-xl bg-[#d4b78e] p-5">
                  <Clock3 size={18} />
                  <p className="mt-8 text-xs text-[#5d6863]">The destinations</p>
                  <p className="mt-1 font-display text-2xl">{analysis?.destinations?.length || 0} places</p>
                </div>
                <div className="rounded-xl bg-[#c3d1c6] p-5">
                  <RouteIcon size={18} />
                  <p className="mt-8 text-xs text-[#5d6863]">Match score</p>
                  <p className="mt-1 font-mono-custom text-2xl">
                    {analysis?.destinations?.[0]?.score || 90}%
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
        {!isLoading && analysis?.destinations && (
          <section className="py-16">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">
                  The shortlist
                </p>
                <h2 className="mt-3 font-display text-4xl tracking-[-.04em] sm:text-5xl">
                  Places that fit your brief
                </h2>
              </div>
              <p className="max-w-xs text-sm leading-6 text-[#65706d]">
                Not ranked by popularity. Ranked by the kind of days you said you want.
              </p>
            </div>
            <div className="mt-9 space-y-3">
              {analysis.destinations.map((d, i) => {
                const colors = ['bg-[#a9c6b4]', 'bg-[#c2b39a]', 'bg-[#d5a58f]'];
                const initials = d.name
                  .split(' ')
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <div
                    key={d.name}
                    className={`overflow-hidden rounded-2xl border transition ${
                      expanded === i ? 'border-[#9aada3] bg-[#fbfaf6]' : 'border-[#d7d0c2] bg-transparent'
                    }`}
                  >
                    <button
                      onClick={() => setExpanded(expanded === i ? -1 : i)}
                      className="flex w-full items-center gap-4 p-4 text-left sm:p-5"
                      data-testid={`button-expand-destination-${i}`}
                    >
                      <div
                        className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${
                          colors[i % colors.length]
                        } font-display text-xl text-[#203b47]`}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-[#65706d]">Destination {i + 1}</p>
                        <h3 className="mt-0.5 text-lg font-bold">{d.name}</h3>
                      </div>
                      <div className="hidden text-right sm:block">
                        <p className="font-mono-custom text-2xl text-[#bb7a52]">{d.score}%</p>
                        <p className="text-[10px] uppercase tracking-wider text-[#65706d]">experience match</p>
                      </div>
                      <ChevronDown size={18} className={`transition ${expanded === i ? 'rotate-180' : ''}`} />
                    </button>
                    {expanded === i && (
                      <div className="grid gap-5 border-t border-[#e2ddd2] px-5 pb-5 pt-4 sm:grid-cols-[1fr_auto] sm:pl-[86px]">
                        <div>
                          <p className="max-w-2xl text-sm leading-6 text-[#65706d]">{d.reasoning}</p>
                          {d.drawbacks && (
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-[#bb7a52]">Worth noting:</p>
                              <p className="mt-1 text-xs leading-5 text-[#65706d]">{d.drawbacks}</p>
                            </div>
                          )}
                        </div>
                        <div className="sm:hidden">
                          <span className="font-mono-custom text-lg text-[#bb7a52]">{d.score}%</span>{' '}
                          <span className="text-xs text-[#65706d]">experience match</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
        {!isLoading && (
          <div className="flex flex-col items-start justify-between gap-5 rounded-2xl bg-[#d9e2d8] p-6 sm:flex-row sm:items-center sm:p-8">
            <div>
              <p className="font-display text-2xl">Ready to see the whole shape?</p>
              <p className="mt-1 text-sm text-[#65706d]">
                A considered route, day by day, with the practical bits in their place.
              </p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generateItinerary.isPending}
              className="flex items-center gap-3 rounded-full bg-[#203b47] px-6 py-3.5 text-sm font-semibold text-[#f5f0e6] transition hover:bg-[#315565] disabled:opacity-70"
              data-testid="button-generate-trip"
            >
              {generateItinerary.isPending ? 'Drawing your route…' : 'Generate my trip'}{' '}
              {!generateItinerary.isPending && <ArrowRight size={16} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
