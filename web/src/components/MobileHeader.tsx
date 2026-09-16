import type { ReactNode } from "react";
import ModeSwitch from "./ModeSwitch";
import SettingsPanel from "./SettingsPanel";

export default function MobileHeader({ menu, children }: { menu: ReactNode; children?: ReactNode }) {
  return <header className="chat-header mobile-header">
    {menu}
    {children}
    <div className="flex min-w-0 flex-1 justify-center"><ModeSwitch /></div>
    <SettingsPanel />
  </header>;
}
