import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useStore } from '../../store/useStore';
import type { BusVehicle } from '../../types';

type LngLat = [number, number];

interface RoutePosition {
  coords: LngLat;
  bearing: number;
}

// Light map style — Stadia Alidade Smooth (no API key required)
const LIGHT_MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    light: {
      type: 'raster',
      tiles: ['https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© Stadia Maps © OpenMapTiles © OpenStreetMap',
      maxzoom: 20,
    },
  },
  layers: [
    {
      id: 'light-tiles',
      type: 'raster',
      source: 'light',
      paint: { 'raster-opacity': 0.8 },
    },
  ],
};

/** Bangalore service area — reject (0,0) or other invalid coords */
function isValidCoord(lat: number, lng: number): boolean {
  return lat >= 12.8 && lat <= 13.2 && lng >= 77.4 && lng <= 77.8;
}

export function BusMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const busMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const stopMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const demandBubblesRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  /** Track which routeIds have already been fetched from OSRM */
  const fetchedRoutesRef = useRef<Set<string>>(new Set());

  const { buses, stops, routes, demandSnapshots, rerouteOrders, selectedBusId, selectBus } = useStore();

  // ── Initialize map once ────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: LIGHT_MAP_STYLE,
      center: [77.6095, 12.955],
      zoom: 13.2,
      minZoom: 10,
      maxZoom: 18,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      busMarkersRef.current.clear();
      stopMarkersRef.current.clear();
    };
  }, []);

  const [routeGeometries, setRouteGeometries] = useState<Record<string, LngLat[]>>({});
  const [routeSnappedWaypoints, setRouteSnappedWaypoints] = useState<Record<string, [number, number][]>>({});

  // ── Fetch route geometries from OSRM (fetch each route once only) ──
  useEffect(() => {
    if (Object.keys(routes).length === 0 || Object.keys(stops).length === 0) return;

    const fetchGeometries = async () => {
      for (const route of Object.values(routes)) {
        // Skip if already fetched or currently fetching
        if (fetchedRoutesRef.current.has(route.id)) continue;
        const routeStops = route.stops.map((id) => stops[id]).filter(Boolean);
        if (routeStops.length < 2) continue;

        fetchedRoutesRef.current.add(route.id); // mark as in-flight immediately
        const coordString = routeStops.map(s => `${s.lng},${s.lat}`).join(';');
        try {
          const res = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (data.routes?.length > 0) {
            setRouteGeometries(prev => ({ ...prev, [route.id]: data.routes[0].geometry.coordinates as LngLat[] }));
            // Extract snapped waypoints (where stops were snapped to actual streets)
            if (data.waypoints?.length > 0) {
              const snappedCoords = data.waypoints.map((wp: any) => [wp.location[0], wp.location[1]] as [number, number]);
              setRouteSnappedWaypoints(prev => ({ ...prev, [route.id]: snappedCoords }));
            }
          } else {
            fetchedRoutesRef.current.delete(route.id); // allow retry
          }
        } catch (e) {
          console.error('OSRM fetch failed for', route.id, e);
          fetchedRoutesRef.current.delete(route.id); // allow retry
        }
        // Sleep 600ms to avoid OSRM rate limits (max 1-2 req/sec for public API)
        await new Promise(r => setTimeout(r, 600));
      }
    };
    fetchGeometries();
  }, [routes, stops]);

  // ── Draw route lines ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || Object.keys(routes).length === 0 || Object.keys(stops).length === 0) return;

    const drawRoutes = () => {
      for (const route of Object.values(routes)) {
        const routeStops = route.stops.map((id) => stops[id]).filter(Boolean);
        if (routeStops.length < 2) continue;

        const coordinates = routeGeometries[route.id];
        if (!coordinates) continue; // Wait for OSRM geometry, no straight-line fallbacks
        const sourceId = `route-src-${route.id}`;
        const layerId = `route-line-${route.id}`;

        const source = map.getSource(sourceId) as maplibregl.GeoJSONSource;
        if (source) {
          source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
        } else {
          map.addSource(sourceId, {
            type: 'geojson',
            data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } },
          });
        }

        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: 'line',
            source: sourceId,
            paint: { 'line-color': route.color, 'line-width': 4, 'line-opacity': 0.9 },
            layout: { 'line-join': 'round', 'line-cap': 'round' },
          });
        }
      }
    };

    if (map.isStyleLoaded()) drawRoutes();
    else { map.once('load', drawRoutes); map.once('style.load', drawRoutes); }
  }, [routes, stops, routeGeometries]);

  // ── Draw / update stop markers + demand bubbles ────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || Object.keys(stops).length === 0) return;

    // Build a map of stop ID to snapped coordinate for quick lookup
    const snappedStopCoords = new Map<string, [number, number]>();
    for (const route of Object.values(routes)) {
      const snappedCoords = routeSnappedWaypoints[route.id];
      if (snappedCoords && route.stops.length === snappedCoords.length) {
        route.stops.forEach((stopId, idx) => {
          snappedStopCoords.set(stopId, snappedCoords[idx]);
        });
      }
    }

    for (const stop of Object.values(stops)) {
      const isOverloaded = stop.routesServing.some(
        (routeId) => demandSnapshots[`${stop.id}:${routeId}`]?.overloadFlag
      );
      const totalDemand = stop.routesServing.reduce(
        (sum, rid) => sum + (demandSnapshots[`${stop.id}:${rid}`]?.totalDemand || 0), 0
      );

      // Use snapped coordinate if available, otherwise fall back to original stop coords
      const markerCoords = snappedStopCoords.get(stop.id) || [stop.lng, stop.lat];

      // ── Demand bubble overlay ───────────────────────────────
      const existingBubbleMarker = demandBubblesRef.current.get(stop.id);
      if (totalDemand > 8) {
        if (existingBubbleMarker) {
          // Update existing bubble position and styling
          const bubbleEl = existingBubbleMarker.getElement();
          updateDemandBubble(bubbleEl, totalDemand, isOverloaded);
          existingBubbleMarker.setLngLat(markerCoords);
          bubbleEl.style.display = 'flex';
        } else {
          // Create new demand bubble marker (sits behind the stop dot)
          const bubbleEl = document.createElement('div');
          updateDemandBubble(bubbleEl, totalDemand, isOverloaded);
          const bubbleMarker = new maplibregl.Marker({ element: bubbleEl, anchor: 'center' })
            .setLngLat(markerCoords)
            .addTo(map);
          demandBubblesRef.current.set(stop.id, bubbleMarker);
        }
      } else if (existingBubbleMarker) {
        existingBubbleMarker.getElement().style.display = 'none';
      }

      if (stopMarkersRef.current.has(stop.id)) {
        const marker = stopMarkersRef.current.get(stop.id)!;
        const el = marker.getElement();
        applyStopMarkerStyle(el, isOverloaded, stop.isTerminus);
        marker.setLngLat(markerCoords);
        marker.getPopup()?.setHTML(buildStopPopup(stop, totalDemand, isOverloaded, demandSnapshots));
        continue;
      }

      // Create new stop marker
      const el = document.createElement('div');
      applyStopMarkerStyle(el, isOverloaded, stop.isTerminus);

      const popup = new maplibregl.Popup({
        offset: 18, closeButton: false, closeOnClick: false, maxWidth: '240px',
      }).setHTML(buildStopPopup(stop, totalDemand, isOverloaded, demandSnapshots));

      el.addEventListener('mouseenter', () => popup.addTo(map));
      el.addEventListener('mouseleave', () => popup.remove());

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(markerCoords)
        .addTo(map);

      stopMarkersRef.current.set(stop.id, marker);
    }
  }, [stops, demandSnapshots, routeSnappedWaypoints, routes]);

  // ── Draw / update bus markers ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const activeBusIds = new Set(Object.keys(buses));
    for (const [busId, marker] of busMarkersRef.current) {
      if (!activeBusIds.has(busId)) {
        marker.remove();
        busMarkersRef.current.delete(busId);
      }
    }

    for (const bus of Object.values(buses)) {
      const currentRoute = routes[bus.currentRouteId ?? ''];
      const homeRoute = routes[bus.homeRouteId ?? bus.currentRouteId ?? ''];
      const isRerouted = bus.homeRouteId != null && bus.homeRouteId !== bus.currentRouteId;
      const isSelected = bus.id === selectedBusId;
      const displayRouteId = currentRoute?.id ?? homeRoute?.id;
      const displayPosition = resolveBusDisplayPosition(bus, displayRouteId ? routeGeometries[displayRouteId] : undefined);
      if (!displayPosition) continue;

      // Bus color = home route color (not status)
      const busColor = homeRoute?.color ?? '#6366f1';

      // Find matching reroute order for context
      const rerouteOrder = bus.activeRerouteId
        ? Object.values(rerouteOrders).find(o => o.id === bus.activeRerouteId)
        : null;

      if (busMarkersRef.current.has(bus.id)) {
        const marker = busMarkersRef.current.get(bus.id)!;
        marker.setLngLat(displayPosition.coords);
        applyBusMarkerStyle(marker.getElement(), busColor, isSelected, isRerouted, bus.occupancyPct, displayPosition.bearing, currentRoute?.color);
        // Update popup HTML
        const popup = marker.getPopup();
        if (popup) {
          popup.setHTML(buildBusPopup(bus, homeRoute, currentRoute, isRerouted, rerouteOrder));
        }
      } else {
        const el = document.createElement('div');
        applyBusMarkerStyle(el, busColor, isSelected, isRerouted, bus.occupancyPct, displayPosition.bearing, currentRoute?.color);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          selectBus(bus.id === selectedBusId ? null : bus.id);
        });

        const popup = new maplibregl.Popup({
          offset: 26, closeButton: false, closeOnClick: false, maxWidth: '260px',
        }).setHTML(buildBusPopup(bus, homeRoute, currentRoute, isRerouted, rerouteOrder));

        el.addEventListener('mouseenter', () => popup.addTo(map));
        el.addEventListener('mouseleave', () => popup.remove());

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(displayPosition.coords)
          .addTo(map);

        busMarkersRef.current.set(bus.id, marker);
      }
    }
  }, [buses, selectedBusId, routes, rerouteOrders, routeGeometries, selectBus]);

  // ── Pan to selected bus ─────────────────────────────────────
  const prevSelectedBusRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedBusId) {
      prevSelectedBusRef.current = selectedBusId;
      return;
    }

    // Only pan if the user actually clicked a NEW bus, 
    // to prevent aggressively snapping back on every 2s live update tick.
    if (prevSelectedBusRef.current !== selectedBusId) {
      const bus = buses[selectedBusId];
      if (bus) {
        const route = routes[bus.currentRouteId ?? ''];
        const homeRoute = routes[bus.homeRouteId ?? ''];
        const displayRouteId = route?.id ?? homeRoute?.id;
        const displayPosition = resolveBusDisplayPosition(bus, displayRouteId ? routeGeometries[displayRouteId] : undefined);
        if (displayPosition) {
          map.flyTo({ center: displayPosition.coords, zoom: 14, speed: 1.2 });
        }
      }
      prevSelectedBusRef.current = selectedBusId;
    }
  }, [selectedBusId, buses, routes, routeGeometries]);

  return <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />;
}

function resolveBusDisplayPosition(bus: BusVehicle, routeCoordinates?: LngLat[]): RoutePosition | null {
  if (routeCoordinates && routeCoordinates.length >= 2 && Number.isFinite(bus.positionFraction)) {
    return getRoutePositionAtFraction(routeCoordinates, bus.positionFraction);
  }

  if (isValidCoord(bus.lat, bus.lng)) {
    return {
      coords: [bus.lng, bus.lat],
      bearing: Number.isFinite(bus.bearing) ? bus.bearing : 0,
    };
  }

  return null;
}

function getRoutePositionAtFraction(coordinates: LngLat[], fraction: number): RoutePosition | null {
  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) return { coords: coordinates[0], bearing: 0 };

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const length = haversineMeters(coordinates[i - 1], coordinates[i]);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength <= 0) return { coords: coordinates[0], bearing: 0 };

  const clampedFraction = Math.max(0, Math.min(1, fraction));
  let targetDistance = clampedFraction * totalLength;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segmentLength = segmentLengths[i];
    if (targetDistance <= segmentLength || i === segmentLengths.length - 1) {
      const start = coordinates[i];
      const end = coordinates[i + 1];
      const t = segmentLength > 0 ? targetDistance / segmentLength : 0;

      return {
        coords: [
          start[0] + (end[0] - start[0]) * t,
          start[1] + (end[1] - start[1]) * t,
        ],
        bearing: bearingBetween(start, end),
      };
    }

    targetDistance -= segmentLength;
  }

  const last = coordinates[coordinates.length - 1];
  const previous = coordinates[coordinates.length - 2];
  return { coords: last, bearing: bearingBetween(previous, last) };
}

function haversineMeters(a: LngLat, b: LngLat): number {
  const earthRadiusM = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return earthRadiusM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingBetween(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

// ─────────────────────────────────────────────────────────────────
// Helper: demand bubble
// ─────────────────────────────────────────────────────────────────

function updateDemandBubble(el: HTMLElement, demand: number, isOverloaded: boolean): void {
  const size = Math.min(16 + demand * 2, 80); // 18px base, max 80px
  const color = isOverloaded ? 'rgba(239,68,68,0.25)' : 'rgba(251,146,60,0.2)';
  const borderColor = isOverloaded ? 'rgba(239,68,68,0.7)' : 'rgba(251,146,60,0.6)';

  el.style.display = 'flex';
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    background: color,
    border: `2px solid ${borderColor}`,
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: `${Math.max(9, Math.min(13, demand / 2))}px`,
    fontWeight: '700',
    color: isOverloaded ? '#ef4444' : '#fb923c',
    animation: isOverloaded ? 'demandPulse 1.2s ease-in-out infinite' : 'none',
    zIndex: '5',
    pointerEvents: 'none',
  });
  el.textContent = `${Math.round(demand)}`;
}

// ─────────────────────────────────────────────────────────────────
// Helper: stop marker styling
// ─────────────────────────────────────────────────────────────────

function applyStopMarkerStyle(el: HTMLElement, isOverloaded: boolean, isTerminus: boolean): void {
  const size = isTerminus ? 12 : isOverloaded ? 10 : 8;
  const bg = isOverloaded ? '#ef4444' : '#FFFFFF';
  const border = isOverloaded ? '#b91c1c' : '#2563EB';

  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    background: bg,
    border: `2px solid ${border}`,
    cursor: 'pointer',
    // ✅ Only transition safe visual properties — never 'all'
    transition: 'background 0.2s ease, border-color 0.2s ease',
    zIndex: '20',
    // ✅ Removed 'position: relative' — MapLibre's wrapper handles this
  });
}
// ─────────────────────────────────────────────────────────────────
// Helper: bus marker styling
// ─────────────────────────────────────────────────────────────────
function applyBusMarkerStyle(
  el: HTMLElement,
  homeColor: string,
  isSelected: boolean,
  isRerouted: boolean,
  occupancyPct: number,
  bearing: number,
  currentRouteColor?: string,
): void {
  const borderStyle = isRerouted ? 'dashed' : 'solid';
  const borderColor = isSelected
    ? '#0F172A'
    : isRerouted
      ? (currentRouteColor ?? '#f59e0b')
      : '#E2E8F0';
  const borderWidth = isRerouted || isSelected ? '2px' : '1px';
  const pointerColor = isSelected ? '#0F172A' : isRerouted ? (currentRouteColor ?? '#f59e0b') : homeColor;

  // ✅ el is MapLibre's anchor — only set dimensions, never position
  Object.assign(el.style, {
    width: '28px',
    height: '28px',
  });

  // ── Reuse existing inner container if already built ──────────
  let inner = el.querySelector<HTMLElement>('.bus-inner');
  if (inner) {
    // Fast path: update only dynamic styles, no DOM rebuilding
    Object.assign(inner.style, {
      background: homeColor,
      border: `${borderWidth} ${borderStyle} ${borderColor}`,
      boxShadow: isSelected ? `0 0 0 3px ${homeColor}55` : 'none',
    });

    const compass = inner.querySelector<HTMLElement>('.compass-wrapper');
    if (compass) {
      compass.style.transform = `rotate(${bearing}deg)`;
      const pointer = compass.querySelector<HTMLElement>('.compass-pointer');
      if (pointer) pointer.style.borderBottomColor = pointerColor;
    }

    // Update reroute badge visibility
    let badge = inner.querySelector<HTMLElement>('.reroute-badge');
    if (isRerouted) {
      if (!badge) {
        badge = buildRerouteBadge(currentRouteColor);
        inner.appendChild(badge);
      } else {
        badge.style.background = currentRouteColor ?? '#f59e0b';
      }
    } else if (badge) {
      badge.remove();
    }
    return;
  }

  // ── First render: build the full subtree ────────────────────
  inner = document.createElement('div');
  inner.className = 'bus-inner';
  Object.assign(inner.style, {
    position: 'relative',     // ✅ positioning context lives here, not on el
    width: '100%',
    height: '100%',
    borderRadius: '6px',
    background: homeColor,
    border: `${borderWidth} ${borderStyle} ${borderColor}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    cursor: 'pointer',
    zIndex: '30',
    userSelect: 'none',
    boxShadow: isSelected ? `0 0 0 3px ${homeColor}55` : 'none',
    transition: 'box-shadow 0.2s ease, border-color 0.2s ease', // ✅ no 'all'
  });

  const icon = document.createElement('span');
  icon.textContent = '🚌';
  inner.appendChild(icon);

  const compassWrapper = document.createElement('div');
  compassWrapper.className = 'compass-wrapper';
  Object.assign(compassWrapper.style, {
    position: 'absolute',
    top: '0', left: '0',
    width: '100%', height: '100%',
    transform: `rotate(${bearing}deg)`,
    pointerEvents: 'none',
  });

  const pointer = document.createElement('div');
  pointer.className = 'compass-pointer';
  Object.assign(pointer.style, {
    position: 'absolute',
    top: '-7px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '0', height: '0',
    borderLeft: '5px solid transparent',
    borderRight: '5px solid transparent',
    borderBottom: `6px solid ${pointerColor}`,
  });
  compassWrapper.appendChild(pointer);
  inner.appendChild(compassWrapper);

  if (isRerouted) {
    inner.appendChild(buildRerouteBadge(currentRouteColor));
  }

  el.appendChild(inner);
}

function buildRerouteBadge(currentRouteColor?: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'reroute-badge';
  badge.textContent = '↪';
  Object.assign(badge.style, {
    position: 'absolute',
    top: '-7px', right: '-7px',
    background: currentRouteColor ?? '#f59e0b',
    color: '#fff',
    borderRadius: '50%',
    width: '14px', height: '14px',
    fontSize: '9px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '700',
    border: '1px solid #fff',
  });
  return badge;
}
// ─────────────────────────────────────────────────────────────────
// Helper: bus popup HTML
// ─────────────────────────────────────────────────────────────────

function buildBusPopup(
  bus: any,
  homeRoute: any,
  currentRoute: any,
  isRerouted: boolean,
  rerouteOrder: any,
): string {
  const occupancyColor = bus.occupancyPct > 0.8 ? '#ef4444' : bus.occupancyPct > 0.55 ? '#f59e0b' : '#10b981';

  if (isRerouted && homeRoute && currentRoute) {
    return `
      <div class="popup-title">🚌 ${bus.registrationNo}
        <span style="background:${currentRoute.color};color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;margin-left:6px;">GUEST BUS</span>
      </div>
      <div class="popup-row"><span>🏠 Home Route</span><strong style="color:${homeRoute.color}">${homeRoute.shortCode} — ${homeRoute.name}</strong></div>
      <div class="popup-row"><span>↪ Currently On</span><strong style="color:${currentRoute.color}">${currentRoute.shortCode} — ${currentRoute.name}</strong></div>
      <div class="popup-row"><span>Occupancy</span><strong style="color:${occupancyColor}">${Math.round(bus.occupancyPct * 100)}%</strong></div>
      ${rerouteOrder ? `<div style="background:#fef3c7;border-radius:4px;padding:6px 8px;margin-top:6px;font-size:11px;color:#92400e;">
        <strong>📋 Why rerouted:</strong><br/>${rerouteOrder.reasonSummary}
      </div>` : ''}
      <div style="font-size:10px;color:#64748b;margin-top:6px;font-style:italic;">Will return to ${homeRoute.shortCode} after serving crowd demand.</div>
    `;
  }

  return `
    <div class="popup-title">🚌 ${bus.registrationNo}</div>
    <div class="popup-row"><span>Route</span><strong style="color:${homeRoute?.color ?? '#6366f1'}">${homeRoute?.shortCode ?? '?'} — ${homeRoute?.name ?? ''}</strong></div>
    <div class="popup-row"><span>Occupancy</span><strong style="color:${occupancyColor}">${Math.round(bus.occupancyPct * 100)}%</strong></div>
    <div class="popup-row"><span>Status</span><strong>${bus.status.replace(/_/g, ' ')}</strong></div>
  `;
}

// ─────────────────────────────────────────────────────────────────
// Helper: stop popup HTML
// ─────────────────────────────────────────────────────────────────

function buildStopPopup(
  stop: any,
  totalDemand: number,
  isOverloaded: boolean,
  demandSnapshots: any
): string {
  const snapshots = stop.routesServing.map((rid: string) => demandSnapshots[`${stop.id}:${rid}`]).filter(Boolean);
  const nextEta = snapshots.length > 0 ? Math.min(...snapshots.map((s: any) => s.nextBusEtaMin)) : null;

  return `
    <div class="popup-title">${stop.name}${isOverloaded ? ' 🔴' : ''}</div>
    <div class="popup-row"><span>Waiting</span><strong style="color:${isOverloaded ? '#ef4444' : '#f59e0b'}">${Math.round(totalDemand)} pax</strong></div>
    ${nextEta !== null ? `<div class="popup-row"><span>Next bus</span><strong>${nextEta} min</strong></div>` : ''}
    <div class="popup-row"><span>Routes</span><strong>${stop.routesServing.length}</strong></div>
    ${isOverloaded ? `<div style="color:#f87171;font-size:11px;margin-top:6px;font-weight:600;">⚠️ OVERLOADED — Reroute recommended</div>` : ''}
  `;
}
