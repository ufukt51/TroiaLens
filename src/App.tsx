import { EmbeddedApp } from './apps/EmbeddedApp.tsx'
import { StandaloneApp } from './apps/StandaloneApp.tsx'
import { inHost } from './lib/host.ts'

/** Inside the Notepad++ panel (WebView2) the UI is driven by the plugin; in a browser it is the full web app. */
export default function App() {
  return inHost() ? <EmbeddedApp /> : <StandaloneApp />
}
