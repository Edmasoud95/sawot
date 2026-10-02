import { useEffect, useSyncExternalStore } from 'react';
import { BUTTON_CLS } from './fields';
import { disableNotifications, enableNotifications, initializeNotifications, notificationSnapshot, subscribeNotifications } from '../../lib/pushNotifications';

export default function NotificationSettings() {
  const state = useSyncExternalStore(subscribeNotifications, notificationSnapshot);
  useEffect(() => { void initializeNotifications(); }, []);
  return <div className="flex flex-col gap-2.5">
    <div className="text-sm font-medium text-zinc-200">Response notifications</div>
    <p className="text-sm leading-snug text-zinc-500">Notify this device when a response is ready. The chat title may appear on your lock screen; message content stays private.</p>
    <p role="status" className="text-sm text-zinc-400">{state.message || (state.status === 'enabled' ? 'Enabled on this device' : state.status === 'busy' ? 'Updating…' : 'Disabled on this device')}</p>
    <div className="flex gap-2">
      <button type="button" className={BUTTON_CLS} disabled={['busy', 'unsupported', 'blocked'].includes(state.status)} onClick={() => { void (state.status === 'enabled' ? disableNotifications() : enableNotifications()); }}>
        {state.status === 'enabled' ? 'Disable notifications' : state.status === 'error' ? 'Retry enabling' : 'Enable notifications'}
      </button>
      {state.status === 'error' && <button type="button" className={BUTTON_CLS} onClick={() => { void disableNotifications(); }}>Disable notifications</button>}
    </div>
  </div>;
}
