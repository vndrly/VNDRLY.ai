import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Router } from 'wouter';
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
import { AssistantLauncher, AssistantPanel, OnboardingMiniStepper } from './assistant-panel';
import { getAskVMicrophoneState, selectAskVMicrophone } from '@/lib/askv-microphone';

class Recorder {
  static isTypeSupported() { return true; }
  state = 'inactive'; mimeType = 'audio/webm'; onstop: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
}
let track: { stop: ReturnType<typeof vi.fn>; label: string };
beforeEach(() => {
  localStorage.clear(); state.muted = false; state.assistant.streaming = false; selectAskVMicrophone('headset');
  track = { stop: vi.fn(), label: 'Wired headset' };
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })), enumerateDevices: vi.fn(async () => []),
  } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['/work-hub/askv', '/work-hub/askv/'])('keeps automatic results inline on %s while allowing an explicit open', (path) => {
  sessionStorage.clear();
  const client = new QueryClient();
  render(<Router hook={() => [path, () => {}]}><QueryClientProvider client={client}><AssistantLauncher /></QueryClientProvider></Router>);
  act(() => window.dispatchEvent(new CustomEvent('askv:show-results')));
  expect(screen.queryByTestId('assistant-panel')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open Ask V' }));
  expect(screen.getByTestId('assistant-panel')).not.toBeNull();
  sessionStorage.clear();
});

it('still opens result panels on other pages', () => {
  sessionStorage.clear();
  const client = new QueryClient();
  render(<Router hook={() => ['/work-hub/finance', () => {}]}><QueryClientProvider client={client}><AssistantLauncher /></QueryClientProvider></Router>);
  act(() => window.dispatchEvent(new CustomEvent('askv:show-results')));
  expect(screen.getByTestId('assistant-panel')).not.toBeNull();
  sessionStorage.clear();
});

it('keeps page actions outside the conversation and lets readers stay in earlier history', () => {
  const queryClient = new QueryClient();
  const panel = () => <QueryClientProvider client={queryClient}><AssistantPanel embedded open onOpenChange={() => {}} /></QueryClientProvider>;
  const view = render(panel());
  const list = screen.getByTestId('assistant-conversation-scroll');
  expect(list.contains(screen.getByTestId('assistant-page-toolbar'))).toBe(false);
  expect(screen.queryByTestId('assistant-header')).toBeNull();
  Object.defineProperties(list, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 300 } });
  list.scrollTop = 100;
  fireEvent.scroll(list);
  state.assistant.streaming = true;
  view.rerender(panel());
  expect(list.scrollTop).toBe(100);
  list.scrollTop = 700;
  fireEvent.scroll(list);
  Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 1200 });
  state.assistant.streaming = false;
  view.rerender(panel());
  expect(list.scrollTop).toBe(1200);
});

it('keeps empty submissions disabled while allowing the Send hover surface to receive pointer events', () => {
  const queryClient = new QueryClient();
  render(<QueryClientProvider client={queryClient}><AssistantPanel embedded open onOpenChange={() => {}} /></QueryClientProvider>);
  const send = screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  expect(send.className).not.toContain('pointer-events-none');
  expect(within(send).getByTestId('sphere-back-circle')).not.toBeNull();
  fireEvent.change(screen.getByTestId('assistant-input'), { target: { value: 'Hello' } });
  expect(send.disabled).toBe(false);
});

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
  const accent = screen.getByTestId('modal-accent-header');
  expect(accent.style.backgroundSize).toBe('100%');
  expect(accent.style.position).toBe('absolute');
  expect(accent.style.height).toBe('118px');
  expect(accent.style.maskImage).toContain('transparent 100%');
  expect(screen.getByTestId('assistant-header').className).toContain('min-h-[118px]');
});

it('hides the AskV onboarding stepper after every current vendor step is complete', () => {
  render(<OnboardingMiniStepper progress={{
    orgType: 'vendor',
    currentStep: 'first-employee',
    completedSteps: ['company-basics', 'platform-eula', 'legal-consent', 'branding', 'tax-ids', 'work-types', 'first-employee'],
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
  expect(screen.getAllByRole('button', { name: 'AskV is Unavailable' })).toHaveLength(1);
  expect(within(screen.getByTestId('assistant-brand-controls')).getByRole('button', { name: 'AskV is Unavailable' })).not.toBeNull();
});

it('keeps mandatory privacy consent current and offers no skip action', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/onboarding/me') ? { ok: true, json: async () => ({ progress: { orgType: 'partner', currentStep: 'legal-consent', completedSteps: ['company-basics', 'platform-eula', 'branding', 'first-site', 'tax-billing', 'preferences', 'invite-team'], skippedSteps: [] } }) } : { ok: false }));
  render(<QueryClientProvider client={new QueryClient()}><AssistantPanel open onOpenChange={() => {}} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByTestId('assistant-mini-stepper')).not.toBeNull());
  expect(screen.queryByRole('button', { name: 'Skip this step' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Help with: Privacy & Messaging' })).not.toBeNull();
});
