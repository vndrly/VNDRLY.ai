import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ captureAuthScope: () => 'browser-scope', isAuthScopeCurrent: () => true }));
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 2, getItemAsync: async () => { throw Error('Native secure storage is unavailable in browser'); }, setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
vi.mock('@/components/TogglePillButton', () => ({ default: ({ children, disabled, onPress }: any) => <button disabled={disabled} onClick={onPress}>{children}</button> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
import TicketLaborFinalization from './TicketLaborFinalization';
afterEach(cleanup);
it('opens a fresh browser work request without calling unavailable native secure storage', async () => {
 render(<TicketLaborFinalization ticketId={100096} updatedAt="2026-10-10T12:00:00Z" canFinalize user={{id:1090,role:'field_employee',vendorId:1108,activeMembershipId:1} as any} onRefresh={() => {}} />);
 await waitFor(() => expect((screen.getByText('Finalize recorded labor') as HTMLButtonElement).disabled).toBe(false));
 expect(screen.queryByText('Could not read the saved request.')).toBeNull();
});
