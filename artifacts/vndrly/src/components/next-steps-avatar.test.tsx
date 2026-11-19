import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextStepsAvatar, NextStepsAvatarPreference } from './next-steps-avatar';
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { userId: 7 } }) }));
vi.mock('@/hooks/use-brand', () => ({ useBrand: () => ({ primary: '#008899', isOrgBranded: true }) }));
beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
it('shows large choices in a collapsible row, saves selection and updates the active avatar', async () => {
  const view = render(<><NextStepsAvatarPreference /><NextStepsAvatar /></>);
  fireEvent.click(screen.getByRole('button', { name: 'VNDRLY Avatar' }));
  const option = await screen.findByRole('button', { name: 'Beacon' });
  expect(option.querySelector('svg image')?.getAttribute('href')).toBe('/next-steps-avatars.png');
  fireEvent.click(option);
  await waitFor(() => expect(screen.getByRole('button', { name: 'VNDRLY Avatar' }).getAttribute('aria-expanded')).toBe('false'));
  expect(screen.queryByRole('button', { name: 'Beacon' })).toBeNull();
  expect(localStorage.getItem('vndrly:next-steps-avatar:7')).toBe('Beacon');
  expect(view.container.querySelector('.next-steps-avatar svg')?.getAttribute('aria-label')).toBe('Beacon');
  view.unmount();
  render(<NextStepsAvatarPreference />);
  expect(screen.getByText('Beacon')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'VNDRLY Avatar' }));
  expect(screen.getByRole('button', { name: 'Beacon' }).getAttribute('aria-pressed')).toBe('true');
});
