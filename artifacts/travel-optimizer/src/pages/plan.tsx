import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { useTripContext } from '@/context/TripContext';
import { useCreateTrip } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
const planSteps = [
  { key: 'destination', eyebrow: "Let's start with the shape of it", title: 'Where are you drawn to?', hint: "Name a country, region, or a loose idea. We'll help find the through-line.", type: 'text' },
  { key: 'startingLocation', eyebrow: 'The first step sets the rhythm', title: 'Where will you begin?', hint: "A city, an airport, or wherever you'll land.", type: 'text' },
  { key: 'dates', eyebrow: 'Timing changes everything', title: 'When are you going?', hint: 'Even a rough window helps us read the season.', type: 'text' },
  { key: 'travelerCount', eyebrow: 'A route should fit the company', title: "Who's coming along?", hint: 'This changes the pace, the stays, and the shape of your days.', type: 'choice', options: ['Just me', 'A partner', 'Friends', 'Family'] },
  { key: 'budget', eyebrow: 'Make room for what matters', title: 'What feels comfortable?', hint: 'A total trip budget in USD, excluding international flights.', type: 'choice', options: ['$900–1,400', '$1,400–1,800', '$1,800–2,400', '$2,400+'] },
  { key: 'budgetPreference', eyebrow: "There's no wrong answer", title: 'Where should we spend well?', hint: "We'll use this to make the right trade-offs.", type: 'choice', options: ['Keep it lean', 'Balance', 'A few beautiful splurges'] },
  { key: 'pace', eyebrow: 'The most important detail', title: 'How should it feel?', hint: 'Think about how you want to come home feeling.', type: 'choice', options: ['Unhurried', 'A little of everything', 'See it all'] },
];

export default function Plan() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const { setPlanData, setTripId } = useTripContext();
  const { toast } = useToast();
  
  const [destination, setDestination] = useState('');
  const [startingLocation, setStartingLocation] = useState('');
  const [dates, setDates] = useState('');
  const [travelerCount, setTravelerCount] = useState('');
  const [budget, setBudget] = useState('');
  const [budgetPreference, setBudgetPreference] = useState('');
  const [pace, setPace] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<string[]>([]);

  const createTrip = useCreateTrip();

  const current = planSteps[step];
  const getters: Record<string, string> = {
    destination,
    startingLocation,
    dates,
    travelerCount,
    budget,
    budgetPreference,
    pace,
  };
  const setters: Record<string, (val: string) => void> = {
    destination: setDestination,
    startingLocation: setStartingLocation,
    dates: setDates,
    travelerCount: setTravelerCount,
    budget: setBudget,
    budgetPreference: setBudgetPreference,
    pace: setPace,
  };

  const value = getters[current.key] || '';
  const setValue = setters[current.key];
  const choices = current.options ?? [];
  const finish = step === planSteps.length - 1;
  const canNext = Boolean(value);

  const parseDateRange = (input: string): [string, string] | null => {
    const normalized = input.trim().replace(/\s+/g, ' ');
    const compact = normalized.match(/^(\d{1,2})[–—](\d{1,2})\s+([A-Za-z]+)(?:\s+(20\d{2}))?$/);
    if (compact) {
      const months: Record<string, string> = {
        january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
        april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
        august: '08', aug: '08', september: '09', sep: '09', sept: '09', october: '10',
        oct: '10', november: '11', nov: '11', december: '12', dec: '12',
      };
      const month = months[compact[3].toLowerCase()];
      const year = compact[4] ?? String(new Date().getFullYear());
      if (month) {
        return [
          `${year}-${month}-${compact[1].padStart(2, '0')}`,
          `${year}-${month}-${compact[2].padStart(2, '0')}`,
        ];
      }
    }
    const parts = normalized.split(/\s+(?:to|until|through)\s+|[–—]/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) return null;

    const iso = (value: string): string | null => {
      const match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : null;
    };
    const startIso = iso(parts[0]);
    const endIso = iso(parts[1]);
    if (startIso && endIso) return [startIso, endIso];

    const year = normalized.match(/\b(20\d{2})\b/)?.[1] ?? String(new Date().getFullYear());
    const months: Record<string, string> = {
      january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
      april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
      august: '08', aug: '08', september: '09', sep: '09', sept: '09', october: '10',
      oct: '10', november: '11', nov: '11', december: '12', dec: '12',
    };
    const sharedMonth = normalized.match(/\b([A-Za-z]+)\s+\d{1,2}\b/)?.[1]?.toLowerCase();
    const first = parts[0].replace(/,/g, '').match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/i);
    const second = parts[1].replace(/,/g, '').match(/(\d{1,2})(?:st|nd|rd|th)?(?:\s+([A-Za-z]+))?/i);
    if (!first || !second) return null;
    const startMonth = months[first[2].toLowerCase()];
    const endMonth = months[(second[2] ?? sharedMonth ?? first[2]).toLowerCase()];
    if (!startMonth || !endMonth) return null;
    return [
      `${year}-${startMonth}-${first[1].padStart(2, '0')}`,
      `${year}-${endMonth}-${second[1].padStart(2, '0')}`,
    ];
  };

  const handleNext = () => {
    if (!canNext) return;
    
    if (finish) {
      const parsedDates = parseDateRange(dates);
      if (!parsedDates) {
        toast({
          title: 'Enter a date range',
          description: 'Use dates like 2026-09-01 to 2026-09-10.',
          variant: 'destructive',
        });
        return;
      }
      const [startDateStr, endDateStr] = parsedDates;
      
      // Parse budget range
      const budgetParts = budget.replace('$', '').split('–').map((part) => Number(part.replace(/[,+]/g, '')));
      const budgetMid = budgetParts.length === 2
        ? Math.round((budgetParts[0] + budgetParts[1]) / 2)
        : Number(budgetParts[0]) || 2000;

      // Parse traveler count
      const travelerCountMap: Record<string, number> = {
        'Just me': 1,
        'A partner': 2,
        'Friends': 4,
        'Family': 4,
      };
      const travelerCountNum = travelerCountMap[travelerCount] || 1;

      const planDataPayload = {
        destination,
        startingLocation,
        startDate: startDateStr,
        endDate: endDateStr,
        travelerCount,
        budget,
        budgetPreference,
        travelerProfile: {
          interests,
          travel_style: pace,
          preferences,
        },
      };

      setPlanData(planDataPayload);

      // Create trip via API
      createTrip.mutate(
        {
          data: {
            destination,
            starting_location: startingLocation,
            start_date: startDateStr,
            end_date: endDateStr,
            traveler_count: travelerCountNum,
            budget: budgetMid,
            budget_preference: budgetPreference,
            traveler_profile: {
              interests,
              travel_style: pace,
              preferences,
            },
          },
        },
        {
          onSuccess: (trip) => {
            setTripId(trip.id);
            setLocation('/analysis');
          },
          onError: (error) => {
            console.error('Failed to create trip:', error);
            toast({
              title: 'Failed to create trip',
              description: 'Please try again or adjust your inputs.',
              variant: 'destructive',
            });
          },
        }
      );
    } else {
      setStep(step + 1);
    }
  };

  return (
    <div className="page-grain min-h-[100dvh] bg-[#f3f0e8] text-[#203b47]">
      <div className="mx-auto flex min-h-[100dvh] max-w-[1440px] flex-col px-5 sm:px-10">
        <div className="flex items-center justify-between py-6 sm:py-8">
          <Logo />
          <span className="font-mono-custom text-[10px] uppercase tracking-[.18em] text-[#76827d]">
            Your travel brief
          </span>
        </div>
        <div className="relative flex flex-1 items-start justify-center pb-12 pt-10 sm:pt-20">
          <div className="w-full max-w-[710px]">
            <div className="mb-14 flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {planSteps.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition ${i <= step ? 'bg-[#203b47]' : 'bg-[#d8d2c5]'}`}
                  />
                ))}
              </div>
              <span className="ml-3 font-mono-custom text-[11px] text-[#76827d]">
                {String(step + 1).padStart(2, '0')} / {String(planSteps.length).padStart(2, '0')}
              </span>
            </div>
            <div key={current.key} className="rise">
              <p className="font-mono-custom text-[11px] uppercase tracking-[.18em] text-[#bb7a52]">
                {current.eyebrow}
              </p>
              <h1 className="mt-4 max-w-xl font-display text-5xl leading-[.98] tracking-[-.05em] sm:text-7xl">
                {current.title}
              </h1>
              <p className="mt-6 max-w-md text-[15px] leading-6 text-[#65706d]">{current.hint}</p>
              {current.type === 'text' && (
                <div className="mt-12">
                  <input
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && canNext && handleNext()}
                    className="w-full border-b-2 border-[#a9b5ad] bg-transparent py-4 text-2xl outline-none transition placeholder:text-[#a9b5ad] focus:border-[#203b47]"
                    placeholder={
                      current.key === 'destination'
                        ? 'e.g. The Alps, but not too much hiking'
                        : current.key === 'startingLocation'
                        ? 'e.g. Amsterdam'
                        : 'e.g. 2026-09-01 to 2026-09-10'
                    }
                    data-testid={`input-plan-${current.key}`}
                  />
                </div>
              )}
              {current.type === 'choice' && (
                <div className="mt-10 grid gap-3 sm:grid-cols-2">
                  {choices.map((choice) => (
                    <button
                      key={choice}
                      onClick={() => setValue(choice)}
                      className={`flex items-center justify-between rounded-xl border px-5 py-4 text-left text-[15px] transition hover:-translate-y-0.5 ${
                        value === choice
                          ? 'border-[#203b47] bg-[#dbe3d9] shadow-sm'
                          : 'border-[#d7d0c2] bg-[#f8f6ef] hover:border-[#a9b5ad]'
                      }`}
                      data-testid={`button-choice-${choice.replace(/\W/g, '-').toLowerCase()}`}
                    >
                      <span>{choice}</span>
                      {value === choice && <Check size={17} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {step === 0 && (
              <div className="mt-10 border-t border-[#d7d0c2] pt-5">
                <p className="mb-3 text-xs font-semibold text-[#65706d]">
                  A few places that work beautifully together
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Northern Italy + Slovenia', 'Portugal coast', 'Scotland by train'].map((x) => (
                    <button
                      key={x}
                      onClick={() => setDestination(x)}
                      className="rounded-full border border-[#c9c1b2] px-3 py-2 text-xs transition hover:border-[#203b47] hover:bg-[#e7e5d9]"
                      data-testid={`button-suggestion-${x}`}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {step === 6 && (
              <div className="mt-10 space-y-7 border-t border-[#d7d0c2] pt-7">
                <div>
                  <p className="mb-3 text-xs font-semibold">What pulls you in?</p>
                  <div className="flex flex-wrap gap-2">
                    {['Mountain landscapes', 'Local food', 'Art & design', 'Water & swimming', 'Small-town life', 'Architecture'].map(
                      (x) => (
                        <button
                          key={x}
                          onClick={() =>
                            setInterests(interests.includes(x) ? interests.filter((i) => i !== x) : [...interests, x])
                          }
                          className={`rounded-full border px-3.5 py-2 text-xs transition ${
                            interests.includes(x) ? 'border-[#203b47] bg-[#203b47] text-[#f5f0e6]' : 'border-[#c9c1b2]'
                          }`}
                          data-testid={`button-interest-${x}`}
                        >
                          {x}
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-3 text-xs font-semibold">And one last preference</p>
                  <div className="space-y-2">
                    {['Small towns over capitals', 'Train where possible', 'A free afternoon in every base'].map((x) => (
                      <button
                        key={x}
                        onClick={() =>
                          setPreferences(preferences.includes(x) ? preferences.filter((i) => i !== x) : [...preferences, x])
                        }
                        className="flex w-full items-center gap-3 rounded-lg py-1 text-left text-sm"
                        data-testid={`button-preference-${x}`}
                      >
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded border ${
                            preferences.includes(x) ? 'border-[#203b47] bg-[#203b47] text-white' : 'border-[#b5bcb6]'
                          }`}
                        >
                          {preferences.includes(x) && <Check size={13} />}
                        </span>
                        {x}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="mt-16 flex items-center justify-between border-t border-[#d7d0c2] pt-5">
              <button
                onClick={() => (step > 0 ? setStep(step - 1) : setLocation('/'))}
                className="flex items-center gap-2 text-sm font-semibold text-[#65706d] transition hover:text-[#203b47]"
                data-testid="button-plan-back"
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                onClick={handleNext}
                disabled={!canNext || createTrip.isPending}
                className="flex items-center gap-3 rounded-full bg-[#203b47] px-5 py-3 text-sm font-semibold text-[#f5f0e6] transition hover:bg-[#315565] disabled:cursor-not-allowed disabled:opacity-35"
                data-testid="button-plan-next"
              >
                {createTrip.isPending ? 'Creating your trip...' : finish ? 'See my direction' : 'Continue'}{' '}
                {!createTrip.isPending && <ArrowRight size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
