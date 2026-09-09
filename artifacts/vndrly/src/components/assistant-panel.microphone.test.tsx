import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  muted: false,
  startConversation: vi.fn(async () => {}), closePanel: vi.fn(),
  assistant: { messages: [], streaming: false, activeTool: null, error: null, send: vi.fn(), clear: vi.fn(),
    startNew: vi.fn(), loadLatest: vi.fn(), resetRestoreGuard: vi.fn(), adoptSignupHistory: vi.fn(), submitFeedback: vi.fn() },
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { userId: 11, role: 'vendor', displayName: 'John' } }) }));
vi.mock('@/hooks/use-brand', () => ({ useBrand: () => ({ primary: '#3260CD', name: 'VNDRLY' }) }));
vi.mock('@/hooks/use-assistant', () => ({ useAssistant: () => state.assistant, readPendingSignupChat: () => null, clearPendingSignupChat: vi.fn() }));
vi.mock('@/hooks/use-askv-voice-session', () => ({ useAskVVoiceSession: () => ({
  muted: state.muted, state: 'error', error: null, acrossVndrly: false, wakeReady: false,
  startConversation: state.startConversation, closePanel: state.closePanel, stop: vi.fn(), setMuted: vi.fn(),
}) }));
import { AssistantPanel, OnboardingMiniStepper } from './assistant-panel';
import { getAskVMicrophoneState, selectAskVMicrophone } from '@/lib/askv-microphone';

class Recorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm'; onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}
let track: { stop: ReturnType<typeof vi.fn>; label: string };
beforeEach(() => {
  localStorage.clear(); state.muted = false; selectAskVMicrophone('headset');
  track = { stop: vi.fn(), label: 'Wired headset' };
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })), enumerateDevices: vi.fn(async () => []),
  } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('uses the selected input for fallback recording and releases it when AskV is muted', async () => {
  const queryClient = new QueryClient();
  const panel = () => <QueryClientProvider client={queryClient}><AssistantPanel open onOpenChange={() => {}} /></QueryClientProvider>;
  const view = render(panel());
  fireEvent.click(screen.getByTestId('assistant-voice'));
  await waitFor(() => expect(getAskVMicrophoneState().active).toBe(true));
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: {
    deviceId: { exact: 'headset' }, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  }, video: false });
  state.muted = true; view.rerender(panel());
  await waitFor(() => expect(getAskVMicrophoneState().active).toBe(false));
  expect(track.stop).toHaveBeenCalled();
  expect(screen.queryByTestId('assistant-voice')).toBeNull();
});

it('extends the full AskV panel downward without changing its top-right anchor', () => {
  const queryClient = new QueryClient();
  render(<QueryClientProvider client={queryClient}><AssistantPanel open onOpenChange={() => {}} /></QueryClientProvider>);

  const panel = screen.getByTestId('assistant-panel');
  expect(panel.className).toContain('sm:right-6');
  expect(panel.className).toContain('sm:top-6');
  expect(panel.className).toContain('h-[min(86vh,768px)]');
});

it('hides the AskV onboarding stepper after every current vendor step is complete', () => {
  render(<OnboardingMiniStepper progress={{
    orgType: 'vendor',
    currentStep: 'first-employee',
    completedSteps: ['company-basics', 'platform-eula', 'branding', 'tax-ids', 'work-types', 'first-employee'],
    skippedSteps: [],
  }} />);

  expect(screen.queryByTestId('assistant-mini-stepper')).toBeNull();
});

it('groups microphone and across-VNDRLY controls under one recognizable settings button', () => {
  localStorage.setItem('askv:microphone-setup-complete', 'true');
  const queryClient = new QueryClient();
  render(<QueryClientProvider client={queryClient}><AssistantPanel open onOpenChange={() => {}} /></QueryClientProvider>);

  expect(screen.queryByRole('button', { name: 'Microphone setup' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Enable AskV across VNDRLY/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ask V settings' }));
  expect(screen.getByTestId('askv-microphone-settings')).not.toBeNull();
  expect(screen.getByRole('button', { name: /Enable AskV across VNDRLY/ })).not.toBeNull();
});
