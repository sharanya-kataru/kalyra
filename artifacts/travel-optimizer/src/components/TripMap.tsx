import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Itinerary } from '@workspace/api-client-react';

export function TripMap({ itinerary }: { itinerary: Itinerary }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [tileError, setTileError] = useState(false);
  const stops = useMemo(() => itinerary.route.map((stop, index) => {
    const coordinates = itinerary.live_data?.locations?.find((item) => item.location === stop.location);
    if (!coordinates || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lon) ||
        Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lon) > 180) return null;
    return { ...stop, ...coordinates, index };
  }), [itinerary.route, itinerary.live_data?.locations]);
  const available = stops.filter((stop) => stop !== null);

  useEffect(() => {
    if (!container.current || !stops.some(Boolean)) return;
    setTileError(false);
    const map = L.map(container.current, { scrollWheelZoom: false });
    mapRef.current = map;
    const points: L.LatLngTuple[] = [];
    let previous: L.LatLngTuple | null = null;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on('tileerror', () => setTileError(true)).addTo(map);
    for (const stop of stops) {
      // Do not draw across an unresolved route stop.
      if (!stop) { previous = null; continue; }
      const point: L.LatLngTuple = [stop.lat, stop.lon];
      points.push(point);
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${stop.index + 1}. ${stop.location}`;
      const context = document.createElement('p');
      const days = itinerary.daily_itinerary.filter((day) => day.location === stop.location).map((day) => day.day);
      context.textContent = `${stop.nights} nights${days.length ? ` · Days ${days.join(', ')}` : ''}`;
      popup.append(title, context);
      L.marker(point, {
        title: stop.location,
        icon: L.divIcon({
          className: '',
          html: `<span style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#34594b;color:white;border:2px solid white;box-shadow:0 2px 5px #0005;font-weight:bold">${stop.index + 1}</span>`,
          iconSize: [30, 30], iconAnchor: [15, 15],
        }),
      }).bindPopup(popup).addTo(map);
      if (previous) L.polyline([previous, point], { color: '#bb7a52', weight: 3, dashArray: '6 8' }).addTo(map);
      previous = point;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [35, 35], maxZoom: 12 });
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [stops, itinerary.daily_itinerary]);

  if (!available.length) return (
    <p className="mt-6 rounded-xl bg-[#e7e5d9] p-4 text-sm text-[#65706d]">
      Map unavailable. Refresh live data to check destination locations.
    </p>
  );
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-[#d9d8cd] bg-[#f5f3ea]">
      <div className="flex items-center justify-between gap-3 p-4">
        <h3 className="font-semibold">Your trip on the map</h3>
        <button type="button" className="rounded-lg border border-[#b9b7aa] px-3 py-2 text-xs" onClick={() =>
          mapRef.current?.fitBounds(L.latLngBounds(available.map((stop) => [stop.lat, stop.lon] as L.LatLngTuple)), { padding: [35, 35], maxZoom: 12 })
        }>Fit trip</button>
      </div>
      <div ref={container} className="relative z-0 h-[320px] w-full sm:h-[400px]" role="region" aria-label="Interactive itinerary destination map" />
      <p className="p-4 text-xs text-[#65706d]" role="status">
        {tileError ? 'Background map unavailable. Destination markers are still shown. ' : ''}
        {available.length < stops.length ? 'Some destinations could not be located. ' : ''}
        Select a marker for trip details. Dashed lines connect stops visually; they are not travel directions.
      </p>
    </div>
  );
}
