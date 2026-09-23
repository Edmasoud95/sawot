import { useState } from "react";
import { Skeleton } from "./fields";
import ConnectionRow from "./ConnectionRow";
import CredentialField from "./CredentialField";
import HomeAssistantFields from "./HomeAssistantFields";
import ProviderFields from "./ProviderFields";

function HelpLink({ href, children }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-block py-1 text-aurora-teal underline underline-offset-4">{children}<span className="sr-only"> (opens in a new tab)</span></a>;
}

export default function ConnectionsSection({ data, update, removeProvider, onProvidersChanged, initialConnection = null }) {
  const [openRow, setOpenRow] = useState(initialConnection);
  const toggle = (key: string) => setOpenRow(current => current === key ? null : key);
  if (!data) return <Skeleton />;
  const providers = data.providers ?? [];
  const credentials = data.credentials ?? {};
  return <div className="flex flex-col">
    <ConnectionRow id="providers" title="AI providers" summary={`${providers.length} provider${providers.length === 1 ? "" : "s"}`}
      open={openRow === "providers"} onToggle={() => toggle("providers")}
      help={<><p>Connect a local model server or an AI provider using its OpenAI-compatible base URL, including /v1 when required. Local servers may not need an API key; hosted services usually provide one in their account dashboard.</p><p>Choose the model in Assistant or the chat model picker after adding a provider.</p></>}>
      <ProviderFields providers={providers} removeProvider={removeProvider} onProvidersChanged={onProvidersChanged} />
    </ConnectionRow>
    <ConnectionRow id="home-assistant" title="Home Assistant" summary={data.haUrl && credentials.haToken ? "Configured" : "Setup needed"}
      open={openRow === "home-assistant"} onToggle={() => toggle("home-assistant")}
      help={<><p>Connect SAWOT to view and control your Home Assistant devices. Enter the server address that SAWOT can reach, e.g. http://homeassistant.local:8123.</p><p>In Home Assistant, open your profile → Security → Long-lived access tokens → Create token. Give it a name (e.g. “SAWOT”) and paste the token here.</p><HelpLink href="https://www.home-assistant.io/docs/authentication/">Home Assistant setup guide</HelpLink></>}>
      <HomeAssistantFields url={data.haUrl} hasToken={credentials.haToken} update={update} />
    </ConnectionRow>
    <ConnectionRow id="web-search" title="Web search" summary={credentials.braveApiKey ? "Configured" : "Not configured"}
      open={openRow === "web-search"} onToggle={() => toggle("web-search")}
      help={<><p>Brave Search lets SAWOT look up information on the web. Create an account in the Brave Search API dashboard, activate a plan, and create a key under API Keys. Paste it here, then enable Web search in the chat tools when wanted.</p><HelpLink href="https://api-dashboard.search.brave.com/documentation/guides/authentication">Brave Search setup guide</HelpLink></>}>
      <CredentialField label="Brave Search API key" setting="braveApiKey" configured={credentials.braveApiKey} update={update} />
    </ConnectionRow>
    <ConnectionRow id="model-downloads" title="Model downloads" summary={credentials.hfToken ? "Configured" : "Optional token"}
      open={openRow === "model-downloads"} onToggle={() => toggle("model-downloads")}
      help={<><p>Some speech models on Hugging Face require an access token. Create a token with read access to the model and accept any access terms on its model page. Public models generally do not need a token.</p><HelpLink href="https://huggingface.co/docs/hub/security-tokens">Hugging Face token guide</HelpLink></>}>
      <CredentialField label="Hugging Face token" setting="hfToken" configured={credentials.hfToken} update={update} />
    </ConnectionRow>
  </div>;
}
