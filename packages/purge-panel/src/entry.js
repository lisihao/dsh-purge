// UI derived from YuJunZhiXue/dsh-purge 1.1.71 (MIT). See LICENSE.
import { h, react } from "./shared/react.js";
import { PURGE_CSS } from "./styles/index.js";
import { useDock, startGrantSync } from "./state/dock.js";
import { AuthGate } from "./components/auth.js";
import { NS, setTranslate, zh, en } from "./shared/locale.js";
import { SettingsRoot } from "./components/settings-shell.js";
import { PurgePage, PurgeGlyph } from "./components/page.js";
import { bindSessionContext } from "./state/session-context.js";
import { installLegacyVisibility } from "./state/legacy-visibility.js";
import { installRewindUi } from "./components/rewind.js";
import { WelcomeNotice } from "./components/welcome.js";
import { EnvAdaptSendGate } from "./components/env-gate.js";

export const name = __COMMUNITY__ ? "dsh-purge-community" : "dsh-purge-panel";

export const inject = ["slots", "locale"];

export function PurgeIcon({ size = 20 } = {}) {
  return h(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      "aria-hidden": true,
    },
    h("path", { d: "M4 7h16M4 17h16" }),
    h("circle", { cx: 9, cy: 7, r: 3, fill: "none" }),
    h("circle", { cx: 15, cy: 17, r: 3, fill: "none" }),
  );
}

function PurgeGlyphIcon({ size = 16 } = {}) {
  return h(PurgeGlyph, { size });
}

export function PanelOverlays() {
  const st = useDock();
  return h(
    react.Fragment,
    null,
    h("style", null, PURGE_CSS),
    // Only the first-run and explicit authorization dialogs remain global.
    h(WelcomeNotice, {
      repo: __COMMUNITY__ ? "https://github.com/lisihao/dsh-purge" : undefined,
    }),
    st.authOpen ? h(AuthGate, { pending: st.pending }) : null,
  );
}

export function apply(ctx) {
  ctx.effect(() => installLegacyVisibility(), "panel legacy visibility");
  ctx.inject(["sessions", "uiWorkspace"], (host) => {
    host.effect(() => bindSessionContext(host), "panel session context");
  });
  ctx.effect(startGrantSync, "panel grant sync");
  // Restored from 1.1.71 apply(): conversation.input.right rewind button.
  ctx.inject(["sessions", "uiWorkspace", "conversation"], (host) =>
    installRewindUi(host),
  );
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "panel locale");
  const t = ctx.locale.bind(NS);
  setTranslate(t);
  ctx.slots.inject("shell.overlay", () =>
    ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-purge-panel-overlays",
        order: 60,
      },
      PanelOverlays,
    ),
  );
  // Keep environment guidance in the current composer, outside shell.overlay.
  ctx.slots.inject("conversation.composer.dock", () =>
    ctx.slots.register(
      {
        name: "conversation.composer.dock",
        id: "dsh-purge-env-gate",
        order: 10,
      },
      EnvAdaptSendGate,
    ),
  );
  // This personal fork keeps the existing dsh-purge-rightbar adapter as its entry.
  // The keyed main page below remains available to that adapter.
  if (!__COMMUNITY__) {
    ctx.slots.inject("sidebar.panellist", () =>
      ctx.slots.register(
        {
          name: "sidebar.panellist",
          id: "dsh-purge",
          order: 30,
          label: "Purge",
          inject: () => ({ t }),
        },
        PurgeGlyphIcon,
      ),
    );
  }
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      {
        name: "main",
        key: "dsh-purge",
        inject: () => ({ t }),
      },
      PurgePage,
    ),
  );
  ctx.slots.inject("plugins.bundle.config", () =>
    ctx.slots.register(
      {
        name: "plugins.bundle.config",
        key: __COMMUNITY__ ? "dsh-purge-community" : "dsh-purge-panel",
        inject: () => ({ t }),
      },
      SettingsRoot,
    ),
  );
}
