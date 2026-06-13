import { createHash } from 'crypto';
import { redisClient } from '../redis';
import { GeocodingGateway, type Coordinates } from '../gateways/GeocodingGateway';
import { assertCircuitClosed } from '../middleware/circuitBreaker';
import { logger } from '../util/logger';

const CACHE_TTL_SECONDS = 2_592_000; // 30 days

class _GeocodeService {
  /**
   * Geocodes an address into coordinates.
   * Implements caching and circuit breaker patterns to optimize performance and reliability.
   *
   * @param address The address to geocode.
   * @returns The coordinates of the address.
   */
  async geocode(address: string): Promise<Coordinates> {
    const hash = createHash('sha256').update(address).digest('hex');
    const cacheKey = `geocode:${hash}`;

    const cached = await redisClient.get(cacheKey);
    if (cached) {
      logger.debug({ address }, 'geocode cache hit');
      return JSON.parse(cached) as Coordinates;
    }

    await assertCircuitClosed('geocoding');

    logger.info({ address }, 'geocode cache miss — calling gateway');
    const coords = await GeocodingGateway.geocode(address);

    await redisClient.set(cacheKey, JSON.stringify(coords), 'EX', CACHE_TTL_SECONDS);

    return coords;
  }
}

export const GeocodeService = new _GeocodeService();
