import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AskVMicrophoneSettings } from './askv-microphone-settings';
import { captureAskVMicrophone, meterAskVMicrophone, selectAskVMicrophone } from '@/lib/askv-microphone';

let meter: ReturnType<typeof meterAskVMicrophone> | undefined;
beforeEach(() => {
  localStorage.removeItem('askv:microphone-setup-complete');
  selectAskVMicrophone('');
  const mediaDevices = new EventTarget();
  Object.assign(mediaDevices, {
    enumerateDevices: vi.fn(async () => [
      { kind: 'audioinput', deviceId: 'headset', label: 'Wired headset' },
      { kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' },
    ]),
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ label: 'PC microphone' }] })),
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
});

it('enables Complete only after live microphone input is detected', async () => {
  const capture = await captureAskVMicrophone(new AbortController().signal);
  meter = meterAskVMicrophone(capture);
  const onComplete = vi.fn();
  render(<AskVMicrophoneSettings onComplete={onComplete} />);
  const complete = screen.getByRole('button', { name: 'Complete' });
  expect(complete.hasAttribute('disabled')).toBe(true);
  act(() => meter!.push(new Float32Array([0.1, -0.1])));
  expect(complete.hasAttribute('disabled')).toBe(false);
  fireEvent.click(complete);
  expect(localStorage.getItem('askv:microphone-setup-complete')).toBe('true');
  expect(onComplete).toHaveBeenCalledOnce();
});
afterEach(() => { meter?.stop(); meter = undefined; vi.restoreAllMocks(); });

it('lists inputs without opening the microphone and saves a selection', async () => {
  render(<AskVMicrophoneSettings />);
  const select = screen.getByRole('combobox', { name: 'Microphone' });
  await screen.findByRole('option', { name: 'Wired headset' });
  expect(screen.queryByRole('option', { name: 'Speaker' })).toBeNull();
  fireEvent.change(select, { target: { value: 'headset' } });
  expect(localStorage.getItem('askv:microphone-device')).toBe('headset');
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

it('explains next-session selection separately from the microphone currently in use', async () => {
  const capture = await captureAskVMicrophone(new AbortController().signal);
  meter = meterAskVMicrophone(capture);
  render(<AskVMicrophoneSettings />);
  await screen.findByRole('option', { name: 'Wired headset' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Microphone' }), { target: { value: 'headset' } });
  expect(screen.getByText('Currently using: PC microphone')).toBeTruthy();
  expect(screen.getByText(/Changes apply the next time AskV starts listening/)).toBeTruthy();
  act(() => meter!.push(new Float32Array([0.1, -0.1])));
  expect((screen.getByRole('meter', { name: 'Microphone input level' }) as HTMLMeterElement).value).toBeGreaterThan(0);
  act(() => meter!.stop());
  expect(screen.getByText('Microphone inactive')).toBeTruthy();
  expect((screen.getByRole('meter') as HTMLMeterElement).value).toBe(0);
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
});

it('clearly identifies the default fallback after the saved headset is unplugged', async () => {
  selectAskVMicrophone('missing-headset');
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException('Missing device', 'NotFoundError'));
  const capture = await captureAskVMicrophone(new AbortController().signal);
  meter = meterAskVMicrophone(capture);
  render(<AskVMicrophoneSettings />);
  expect(screen.getByRole('status').textContent).toContain('The selected microphone is unavailable. AskV is using the system default.');
  await waitFor(() => expect(screen.getByText('Currently using: PC microphone')).toBeTruthy());
});
