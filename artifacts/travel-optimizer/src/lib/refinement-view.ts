/** Focus the first changed daily card after replacing the active itinerary. */
export function firstChangedDay<T>(before: readonly T[], after: readonly T[]): number {
  return after.findIndex((day, index) => JSON.stringify(day) !== JSON.stringify(before[index]));
}
