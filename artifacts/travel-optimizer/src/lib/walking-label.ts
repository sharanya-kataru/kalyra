export function walkingLabel(seconds: number, meters: number): string {
  const distance = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  return `About ${Math.max(1, Math.round(seconds / 60))} min walk · ${distance}`;
}
