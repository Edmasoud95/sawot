import { create } from 'zustand';
import { DeviceControls, type ControlState } from './lib/deviceControls';

export const useDeviceControlStore = create<{ devices: Record<string, ControlState> }>(() => ({ devices: {} }));
export const deviceControls = new DeviceControls((id, state) => {
  useDeviceControlStore.setState(s => ({ devices: { ...s.devices, [id]: state } }));
});
