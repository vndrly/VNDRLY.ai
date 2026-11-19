import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'wouter';
import PageBackButton from './page-back-button';
import { installInAppNavigationTracking } from '@/lib/in-app-navigation';
import { CertificationPicker } from './certification-picker';

afterEach(cleanup);

it('uses the provided status logos while retaining the program links', () => {
  render(<CertificationPicker names={['PEC', 'H2S Clear', 'IADC RigPass']} placeholder="Add" testId="logos" onChange={vi.fn()}
    programStatuses={{VUC003:'assigned',VUC004:'completed'}} />);
  fireEvent.click(screen.getByTestId('logos'));
  expect(screen.getByAltText('Unassigned').getAttribute('src')).toContain('/unassigned.png');
  expect(screen.getByAltText('Assigned, incomplete').getAttribute('src')).toContain('/assigned.png');
  expect(screen.getByAltText('Completed').getAttribute('src')).toContain('/completed.png');
  expect(screen.getAllByRole('link')).toHaveLength(3);
});

it('shows direct VNDRLY/U links without loading a company library', () => {
  const onChange = vi.fn();
  render(<CertificationPicker names={['PEC', 'API 510 Pressure Vessel Inspector', 'AMPP Cathodic Protection Specialist (CP4)']}
    placeholder="Add certification" testId="picker" onChange={onChange} />);
  fireEvent.click(screen.getByTestId('picker'));
  expect(screen.getByRole('link', { name: 'VNDRLY/U Cert: VNDRLY/U Energy Safety Core' })
    .getAttribute('href')).toBe('/work-hub/bundle/VUC001');
  expect(screen.getByRole('link', { name: 'VNDRLY/U Cert: VNDRLY/U Asset Integrity — Pressure Vessel Inspection' })
    .getAttribute('href')).toBe('/work-hub/bundle/VUC035');
  expect(screen.getAllByRole('link')).toHaveLength(3);
  for (const link of screen.getAllByRole('link')) {
    expect(link.getAttribute('target')).not.toBe('_blank');
  }
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'API 510 Pressure Vessel Inspector' }));
  expect(onChange).toHaveBeenCalledWith('API 510 Pressure Vessel Inspector');
});

it('keeps the matching link with its filtered choice', () => {
  render(<CertificationPicker names={['PEC', 'IADC RigPass']} placeholder="Add certification" testId="picker" onChange={vi.fn()} />);
  fireEvent.click(screen.getByTestId('picker'));
  fireEvent.change(screen.getByLabelText('Search certifications'), { target: { value: 'RigPass' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link').getAttribute('href')).toBe('/work-hub/bundle/VUC004');
});

it('returns from a certification program to the actual Profile URL', async () => {
  window.history.replaceState({}, '', '/gate/profile?panel=credentials#my-credentials');
  installInAppNavigationTracking();
  function Flow() {
    const [location] = useLocation();
    return location.startsWith('/gate/profile')
      ? <CertificationPicker names={['PEC']} placeholder="Add certification" testId="picker" onChange={vi.fn()} />
      : <PageBackButton fallbackHref="/work-hub" />;
  }
  render(<Flow />);
  fireEvent.click(screen.getByTestId('picker'));
  fireEvent.click(screen.getByRole('link', { name: 'VNDRLY/U Cert: VNDRLY/U Energy Safety Core' }));
  await waitFor(() => expect(window.location.pathname).toBe('/work-hub/bundle/VUC001'));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  await waitFor(() => expect(window.location.pathname + window.location.search + window.location.hash)
    .toBe('/gate/profile?panel=credentials#my-credentials'));
});
