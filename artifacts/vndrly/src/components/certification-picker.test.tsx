import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CertificationPicker } from './certification-picker';

afterEach(cleanup);

it('shows direct VNDRLY/U links without loading a company library', () => {
  const onChange = vi.fn();
  render(<CertificationPicker names={['PEC', 'API 510 Pressure Vessel Inspector', 'AMPP Cathodic Protection Specialist (CP4)']}
    placeholder="Add certification" testId="picker" onChange={onChange} />);
  fireEvent.click(screen.getByTestId('picker'));
  expect(screen.getByRole('link', { name: 'VNDRLY/U Cert: VNDRLY/U | Energy Safety Core | Field Safety Orientation' })
    .getAttribute('href')).toBe('/work-hub/bundle/OG01');
  expect(screen.getByRole('link', { name: 'VNDRLY/U Cert: VNDRLY/U | Asset Integrity | Pressure Vessel Inspection' })
    .getAttribute('href')).toBe('/work-hub/bundle/OG20');
  expect(screen.getAllByRole('link')).toHaveLength(2);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'API 510 Pressure Vessel Inspector', exact: true }));
  expect(onChange).toHaveBeenCalledWith('API 510 Pressure Vessel Inspector');
});

it('keeps the matching link with its filtered choice', () => {
  render(<CertificationPicker names={['PEC', 'IADC RigPass']} placeholder="Add certification" testId="picker" onChange={vi.fn()} />);
  fireEvent.click(screen.getByTestId('picker'));
  fireEvent.change(screen.getByLabelText('Search certifications'), { target: { value: 'RigPass' } });
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link').getAttribute('href')).toBe('/work-hub/bundle/OG02');
});
