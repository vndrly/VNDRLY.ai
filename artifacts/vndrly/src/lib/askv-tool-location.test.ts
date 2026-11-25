import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAskVToolLocation } from './askv-tool-location';
describe('device location for voice tools', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: vi.fn(resolve => resolve({ coords: { latitude: 31, longitude: -102 } })),
    } });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
      query: vi.fn(async () => ({ state: 'granted' })),
    } });
  });
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
  it('does not wait for GPS to look up a checkout visitor', async () => {
    expect(await addAskVToolLocation('prepare_visitor_check_out', { query: 'Chad White', siteLocationId: 2, latitude: 0, longitude: 0 }))
      .toEqual({ query: 'Chad White', siteLocationId: 2 });
    expect(navigator.permissions.query).not.toHaveBeenCalled();
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
  it('gets current device coordinates only for an explicit current-location route query', async () => {
    expect(await addAskVToolLocation('estimate_driving_route', { siteId: 42, currentLatitude: 0, currentLongitude: 0 })).toMatchObject({ siteId: 42, currentLatitude: 31, currentLongitude: -102 });
    vi.mocked(navigator.geolocation.getCurrentPosition).mockClear();
    expect(await addAskVToolLocation('estimate_driving_route', { siteId: 42, origin: 'shop' })).toEqual({ siteId: 42, origin: 'shop' });
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
  it('continues without device coordinates when a Gate check-in already has the site', async () => {
    vi.mocked(navigator.permissions.query).mockResolvedValue({ state: 'prompt' } as PermissionStatus);
    const result = await addAskVToolLocation('confirm_visitor_check_in', { siteLocationId: 2, latitude: 0, longitude: 0 });
    expect(result).toEqual({ siteLocationId: 2 });
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
