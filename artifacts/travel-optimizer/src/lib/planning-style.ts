export const planningStyles = {
  balanced: {
    label: "Balanced",
    description: "Balance your interests, geography, weather, and pace.",
  },
  interest_first: {
    label: "Interest First",
    description: "Give more weight to places that match what you love.",
  },
  stay_local: {
    label: "Stay Local",
    description: "Favor places that keep each day's plans geographically closer together.",
  },
};

export type PlanningMode = keyof typeof planningStyles;

export const planningStyle = (mode?: PlanningMode) =>
  planningStyles[mode ?? "balanced"] ?? planningStyles.balanced;