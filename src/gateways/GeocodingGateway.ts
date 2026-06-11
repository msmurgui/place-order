export interface Coordinates {
  lat: number;
  lng: number;
}

// Deterministic hash so the same address always returns the same coordinates
// in tests and dev without network calls.
function hashAddress(address: string): number {
  let h = 0;
  for (const c of address) {
    h = (h * 31 + c.charCodeAt(0)) % 10_000;
  }
  return h / 10_000; // 0–1
}

class _GeocodingGateway {
  async geocode(address: string): Promise<Coordinates> {
    const lower = address.toLowerCase();

    if (lower.includes('seattle')) return { lat: 47.6062, lng: -122.3321 };
    if (lower.includes('los angeles')) return { lat: 34.0522, lng: -118.2437 };

    const h = hashAddress(address);
    return {
      lat: 33 + h * 15,   // continental US latitude band
      lng: -120 + h * 30, // continental US longitude band
    };
  }
}

export const GeocodingGateway = new _GeocodingGateway();
