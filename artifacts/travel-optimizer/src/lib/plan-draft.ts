interface TravelerProfile {
  optimization_mode?: "balanced" | "interest_first" | "stay_local";
  interests: string[];
  travel_style: string;
  preferences: string[];
}

export interface PlanData {
  destination: string;
  startingLocation: string;
  startDate: string;
  endDate: string;
  travelerCount: string;
  budget: string;
  budgetPreference: string;
  travelerProfile: TravelerProfile;
}

/** Restore the in-session questionnaire draft when returning from Analysis. */
export function hydratePlanDraft(draft: PlanData | null): PlanData {
  return {
    destination: draft?.destination ?? "", startingLocation: draft?.startingLocation ?? "",
    startDate: draft?.startDate ?? "", endDate: draft?.endDate ?? "",
    travelerCount: draft?.travelerCount ?? "", budget: draft?.budget ?? "",
    budgetPreference: draft?.budgetPreference ?? "",
    travelerProfile: { interests: [...(draft?.travelerProfile.interests ?? [])],
      preferences: [...(draft?.travelerProfile.preferences ?? [])],
      travel_style: draft?.travelerProfile.travel_style ?? "",
      optimization_mode: draft?.travelerProfile.optimization_mode ?? "balanced" },
  };
}
