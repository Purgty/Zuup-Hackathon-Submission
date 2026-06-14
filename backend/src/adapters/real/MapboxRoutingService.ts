import type { IRoutingService } from '../../interfaces/IRoutingService';

/**
 * MapboxRoutingService — STUB for production Mapbox integration.
 *
 * TO ACTIVATE:
 * 1. Set ROUTING_ADAPTER=mapbox in your .env file
 * 2. Set MAPBOX_TOKEN=pk.eyJ1... in your .env file
 * 3. Run: npm install @mapbox/mapbox-sdk
 * 4. Uncomment the implementation below
 *
 * Free tier: 100,000 requests/month on Mapbox Matrix API
 */
export class MapboxRoutingService implements IRoutingService {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
    if (!token) {
      throw new Error('MapboxRoutingService requires a MAPBOX_TOKEN environment variable.');
    }
  }

  async getETA(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number
  ): Promise<number> {
    // TODO: Activate when MAPBOX_TOKEN is available
    //
    // const url = `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    //   `${startLng},${startLat};${endLng},${endLat}` +
    //   `?access_token=${this.token}&overview=false`;
    //
    // const response = await fetch(url);
    // const data = await response.json();
    // const durationSeconds = data.routes[0].duration;
    // return Math.round(durationSeconds / 60);

    throw new Error('MapboxRoutingService: Set MAPBOX_TOKEN and uncomment implementation.');
  }

  async getRouteShape(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number
  ): Promise<[number, number][]> {
    // TODO: Activate when MAPBOX_TOKEN is available
    //
    // const url = `https://api.mapbox.com/directions/v5/mapbox/driving/` +
    //   `${startLng},${startLat};${endLng},${endLat}` +
    //   `?access_token=${this.token}&geometries=geojson&overview=full`;
    //
    // const response = await fetch(url);
    // const data = await response.json();
    // return data.routes[0].geometry.coordinates.map(([lng, lat]: number[]) => [lat, lng]);

    throw new Error('MapboxRoutingService: Set MAPBOX_TOKEN and uncomment implementation.');
  }
}
