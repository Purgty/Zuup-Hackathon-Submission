/**
 * IRoutingService — Port for routing and ETA calculation.
 *
 * INJECTION POINT: Swap MockRoutingService → MapboxRoutingService
 * by setting ROUTING_ADAPTER=mapbox in your .env file.
 */
export interface IRoutingService {
  /**
   * Returns estimated travel time in minutes between two coordinates.
   * In production: uses live traffic (Mapbox Directions / HERE Routing).
   * In mock: uses Haversine distance with a fixed average bus speed.
   */
  getETA(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number
  ): Promise<number>;

  /**
   * Returns a polyline path as [lat, lng] pairs for map rendering.
   * In production: returns real road-snapped geometry.
   * In mock: returns a straight line between two points.
   */
  getRouteShape(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number
  ): Promise<[number, number][]>;
}
