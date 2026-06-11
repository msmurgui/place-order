const EARTH_RADIUS_KM = 6371;

interface Coordinate {
  lat: number;
  lng: number;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Returns the distance in kilometres between two coordinates by using the Haversine formula.*/
export function getDistanceBetweenCoordinates({
  from,
  to,
}: {
  from: Coordinate;
  to: Coordinate;
}): number {
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
