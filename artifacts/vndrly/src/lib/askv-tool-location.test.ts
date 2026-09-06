import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAskVToolLocation } from './askv-tool-location';
describe('device location for voice tools', () => {
  beforeEach(() => Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: vi.fn(resolve => resolve({ coords: { latitude: 31, longitude: -102 } })),
  } }));
  it('uses device coordinates instead of model guesses for canonical Gate fields', async () => {
    const result = await addAskVToolLocation('confirm_visitor_check_in', { latitude: 0, longitude: 0, siteLocationId: 2 });
    expect(result).toEqual({ latitude: 31, longitude: -102, siteLocationId: 2 });
  });
  it('keeps confirmation coordinates fixed while leaving changed domain arguments visible to the server', async () => {
    const result = await addAskVToolLocation('confirm_visitor_check_in', { confirmationPhrase: 'yes', siteLocationId: 3 }, { latitude: 32, longitude: -103, siteLocationId: 2 });
    expect(result).toEqual({ confirmationPhrase: 'yes', siteLocationId: 3, latitude: 32, longitude: -103 });
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
  it('does not ask for location on ordinary questions', async () => {
    await addAskVToolLocation('query_tickets', {}); expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
