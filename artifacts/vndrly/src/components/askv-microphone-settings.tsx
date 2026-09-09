import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { getAskVMicrophoneState, observeAskVMicrophones, selectAskVMicrophone, subscribeAskVMicrophone } from '@/lib/askv-microphone';

export const ASKV_MICROPHONE_SETUP_KEY = 'askv:microphone-setup-complete';

export function AskVMicrophoneSettings({ onComplete }: { onComplete?: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const microphone = useSyncExternalStore(subscribeAskVMicrophone, getAskVMicrophoneState);
  const [verified, setVerified] = useState(false);
  useEffect(observeAskVMicrophones, []);
  useEffect(() => {
    if (microphone.active && microphone.level !== null && microphone.level > 0) setVerified(true);
  }, [microphone.active, microphone.level]);
  const savedNotListed = microphone.selectedDeviceId && !microphone.devices.some(device => device.deviceId === microphone.selectedDeviceId);
  const activeLabel = microphone.activeLabel || t('askvMicrophone.systemDefault');
  return <div className="shrink-0 border-b border-white/20 px-4 py-2 space-y-1.5 text-xs" data-testid="askv-microphone-settings">
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="font-medium shrink-0">{t('askvMicrophone.label')}</label>
      <select id={id} className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-foreground"
        value={microphone.selectedDeviceId} aria-describedby={`${id}-hint`}
        onChange={event => selectAskVMicrophone(event.target.value)}>
        <option value="">{t('askvMicrophone.systemDefault')}</option>
        {savedNotListed && <option value={microphone.selectedDeviceId}>{t('askvMicrophone.savedNotListed')}</option>}
        {microphone.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>
          {device.label || t('askvMicrophone.unnamed', { number: index + 1 })}
        </option>)}
      </select>
    </div>
    <p id={`${id}-hint`} className="text-white/70">{t('askvMicrophone.nextSession')}</p>
    {microphone.active && <p>{t('askvMicrophone.current', { name: activeLabel })}</p>}
    {microphone.fallback && <p role="status" className="text-amber-200">{t('askvMicrophone.fallback')}</p>}
    <div className="flex items-center gap-2">
      <meter aria-label={t('askvMicrophone.level')} min={0} max={1} value={microphone.active ? microphone.level ?? 0 : 0}
        className="h-3 min-w-0 flex-1" />
      <span className="text-white/70">{microphone.active
        ? microphone.level === null ? t('askvMicrophone.meterUnavailable') : t('askvMicrophone.level')
        : t('askvMicrophone.inactive')}</span>
    </div>
    {!microphone.devices.some(device => device.label) && <p className="text-white/70">{t('askvMicrophone.labelsAfterPermission')}</p>}
    <div className="flex justify-end">
      <button
        type="button"
        disabled={!verified}
        onClick={() => {
          window.localStorage.setItem(ASKV_MICROPHONE_SETUP_KEY, 'true');
          onComplete?.();
        }}
        className="rounded-full border border-[color:var(--brand-primary)] px-3 py-1 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        data-testid="askv-microphone-complete"
      >
        {t('askvMicrophone.complete')}
      </button>
    </div>
  </div>;
}
