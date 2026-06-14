import type { IRoutingService } from '../../interfaces/IRoutingService';

/**
 * MockRoutingService — Local ETA estimation using Haversine distance.
 * No API key. No network calls. Works offline.
 *
 * Replace with MapboxRoutingService for real-world traffic-aware ETAs.
 * Average bus speed assumed: 18 km/h in urban traffic.
 */
export class MockRoutingService implements IRoutingService {
  private readonly avgSpeedKmh: number;

  constructor(avgSpeedKmh = 18) {
    this.avgSpeedKmh = avgSpeedKmh;
  }

  async getETA(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number
  ): Promise<number> {
    const distKm = this.haversineKm(startLat, startLng, endLat, endLng);
    const timeHours = distKm / this.avgSpeedKmh;
    const timeMin = timeHours * 60;
    // Add a small random jitter to simulate real-world variance (±15%)
    const jitter = 1 + (Math.random() * 0.3 - 0.15);
    return Math.max(1, Math.round(timeMin * jitter));
  }

  async getRouteShape(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number
  ): Promise<[number, number][]> {
    // Return a straight line (3 points for smooth rendering)
    const midLat = (startLat + endLat) / 2;
    const midLng = (startLng + endLng) / 2;
    return [
      [startLat, startLng],
      [midLat, midLng],
      [endLat, endLng],
    ];
  }

  /** Haversine formula — great-circle distance in km */
  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}
