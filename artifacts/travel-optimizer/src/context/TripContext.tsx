import type { PlanData } from "@/lib/plan-draft";
import { createContext, useContext, useState, ReactNode } from 'react';
import type { TripAnalysis, Itinerary } from '@workspace/api-client-react';

interface TripContextValue {
  planData: PlanData | null;
  setPlanData: (data: PlanData) => void;
  tripId: string | null;
  setTripId: (id: string | null) => void;
  analysis: TripAnalysis | null;
  setAnalysis: (analysis: TripAnalysis | null) => void;
  itinerary: Itinerary | null;
  setItinerary: (itinerary: Itinerary | null) => void;
}

const TripContext = createContext<TripContextValue | undefined>(undefined);

export function TripProvider({ children }: { children: ReactNode }) {
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<TripAnalysis | null>(null);
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);

  return (
    <TripContext.Provider
      value={{
        planData,
        setPlanData,
        tripId,
        setTripId,
        analysis,
        setAnalysis,
        itinerary,
        setItinerary,
      }}
    >
      {children}
    </TripContext.Provider>
  );
}

export function useTripContext() {
  const context = useContext(TripContext);
  if (!context) {
    throw new Error('useTripContext must be used within TripProvider');
  }
  return context;
}
