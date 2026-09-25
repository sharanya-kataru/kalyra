export type OptimizationMode = "balanced" | "interest_first" | "stay_local";

const profiles = {
  balanced: {
    interestMultiplier: 1,
    proximityMaximum: 30,
    description: "Daily activities balance your interests, geography, weather, and pace.",
  },
  interest_first: {
    interestMultiplier: 1.25,
    proximityMaximum: 30,
    description: "Daily activities give stronger weight to category evidence matching your interests.",
  },
  stay_local: {
    interestMultiplier: 1,
    proximityMaximum: 40,
    description: "Daily activities give stronger weight to geographic grouping where coordinates are available.",
  },
} as const;

export function resolveOptimizationProfile(mode: OptimizationMode = "balanced") {
  return profiles[mode] ?? profiles.balanced;
}