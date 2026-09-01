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

const MONTHS: Record<string, string> = {
  january: '01', jan: '01', february: '02', feb: '02', march: '03', mar: '03',
  april: '04', apr: '04', may: '05', june: '06', jun: '06', july: '07', jul: '07',
  august: '08', aug: '08', september: '09', sep: '09', sept: '09', october: '10',
  oct: '10', november: '11', nov: '11', december: '12', dec: '12',
};

function toIsoDate(yearValue: string | number, monthValue: string | number, dayValue: string | number): string | null {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function expandYear(year: string): number {
  return year.length === 2 ? 2000 + Number(year) : Number(year);
}

function parseDateValue(input: string, fallbackYear?: number, fallbackMonth?: string): string | null {
  const value = input.trim().replace(/,/g, '').replace(/\s+/g, ' ');
  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (numeric) return toIsoDate(expandYear(numeric[3]), numeric[1], numeric[2]);

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return toIsoDate(iso[1], iso[2], iso[3]);

  const monthFirst = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{2}|\d{4}))?$/i);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    const year = monthFirst[3] ? expandYear(monthFirst[3]) : fallbackYear;
    return month && year ? toIsoDate(year, month, monthFirst[2]) : null;
  }

  const dayFirst = value.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{2}|\d{4}))?$/i);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    const year = dayFirst[3] ? expandYear(dayFirst[3]) : fallbackYear;
    return month && year ? toIsoDate(year, month, dayFirst[1]) : null;
  }

  if (fallbackYear && fallbackMonth) {
    const dayOnly = value.match(/^(\d{1,2})(?:st|nd|rd|th)?$/i);
    if (dayOnly) return toIsoDate(fallbackYear, fallbackMonth, dayOnly[1]);
  }

  return null;
}

function parseDateRange(input: string): [string, string] | null {
  const normalized = input.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;

  const compactMonthRange = normalized.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|—|to|until|through)\s*(\d{1,2})(?:st|nd|rd|th)?(?:,\s*|\s+)(\d{2}|\d{4})$/i
  );
  if (compactMonthRange) {
    const month = MONTHS[compactMonthRange[1].toLowerCase()];
    if (month) {
      const year = expandYear(compactMonthRange[4]);
      const start = toIsoDate(year, month, compactMonthRange[2]);
      const end = toIsoDate(year, month, compactMonthRange[3]);
      if (start && end) return [start, end];
    }
  }

  const rangeSeparator = /\s+(?:to|until|through)\s+|\s*[-–—]\s*/i;
  const parts = normalized.split(rangeSeparator).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) return null;

  const year = normalized.match(/\b(20\d{2}|\d{2})\b/)?.[1];
  const fallbackYear = year ? expandYear(year) : undefined;
  const firstMonth = parts[0].match(/^([A-Za-z]+)\s+\d{1,2}/i)?.[1]?.toLowerCase();
  const fallbackMonth = firstMonth ? MONTHS[firstMonth] : undefined;
  const start = parseDateValue(parts[0], fallbackYear, fallbackMonth);
  const end = parseDateValue(parts[1], fallbackYear, fallbackMonth);
  if (!start || !end) return null;

  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  return endTime > startTime ? [start, end] : null;
}

export default function Plan() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const { setPlanData, setTripId } = useTripContext();
  const { toast } = useToast();
  
  const [destination, setDestination] = useState('');
  const [startingLocation, setStartingLocation] = useState('');
  const [dates, setDates] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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
  const canNext = current.key === 'dates'
    ? Boolean((startDate && endDate) || dates.trim())
    : Boolean(value);

  const handleNext = () => {
    if (!canNext) return;
    
    if (finish) {
      const parsedDates = startDate && endDate ? [startDate, endDate] as [string, string] : parseDateRange(dates);
      if (!parsedDates) {
        toast({
          title: 'We couldn’t understand those dates',
          description: 'Try selecting them from the calendar or entering a date like September 18, 2026.',
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
              {current.key === 'dates' ? (
                <div className="mt-10 space-y-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2 text-xs font-semibold text-[#65706d]">
                      <span className="block uppercase tracking-[.14em]">Start date</span>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full rounded-xl border border-[#c9c1b2] bg-[#f8f6ef] px-4 py-3 text-base outline-none transition focus:border-[#203b47]"
                        data-testid="input-plan-start-date"
                      />
                    </label>
                    <label className="space-y-2 text-xs font-semibold text-[#65706d]">
                      <span className="block uppercase tracking-[.14em]">End date</span>
                      <input
                        type="date"
                        value={endDate}
                        min={startDate || undefined}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full rounded-xl border border-[#c9c1b2] bg-[#f8f6ef] px-4 py-3 text-base outline-none transition focus:border-[#203b47]"
                        data-testid="input-plan-end-date"
                      />
                    </label>
                  </div>
                  <div className="border-t border-[#d7d0c2] pt-5">
                    <label className="space-y-2 text-xs font-semibold text-[#65706d]">
                      <span className="block uppercase tracking-[.14em]">Or type a date range</span>
                      <input
                        autoFocus
                        value={dates}
                        onChange={(e) => setDates(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && canNext && handleNext()}
                        className="w-full border-b-2 border-[#a9b5ad] bg-transparent py-4 text-2xl font-normal outline-none transition placeholder:text-[#a9b5ad] focus:border-[#203b47]"
                        placeholder="e.g. Sep 18, 2026 – Sep 29, 2026"
                        data-testid="input-plan-dates"
                      />
                    </label>
                    <p className="mt-3 text-xs text-[#76827d]">
                      We’ll normalize your dates automatically. You can use formats like 9/18/26 to 9/29/26.
                    </p>
                  </div>
                </div>
              ) : current.type === 'text' && (
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
                        : 'e.g. Amsterdam'
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
