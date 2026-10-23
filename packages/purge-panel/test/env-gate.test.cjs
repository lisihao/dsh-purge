"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const React = require("react");
const { create, act } = require("react-test-renderer");

const defaultClient = path.resolve(__dirname, "../../..", "client.js");
const clientPath = process.env.PANEL_CLIENT || defaultClient;
const clientSource = fs.readFileSync(clientPath, "utf8");

const requests = [];
const seats = [];
const definitions = [];
const lifecycle = [];
const headStyles = [];
const listeners = new Map();
const intervals = new Map();
const dict = {};
let intervalId = 0;
let selected = "normal";
const sessionModes = { normal: "standard", red: "redteam" };

const submissions = { normal: [], red: [] };
function makeShell(sessionId) {
  const shell = {
    submit(mode) {
      submissions[sessionId].push(mode);
      return mode;
    },
    actions: {},
  };
  shell.actions.submit = function originalActionsSubmit() {
    return shell.submit("queue");
  };
  return shell;
}

const shells = {
  normal: makeShell("normal"),
  red: makeShell("red"),
};
const originalSubmit = {
  normal: shells.normal.submit,
  red: shells.red.submit,
};
const originalActionsSubmit = {
  normal: shells.normal.actions.submit,
  red: shells.red.actions.submit,
};

const store = new Map([["dsh-purge-drill-auth", "1"]]);
const storage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  },
};

const redteamLabel = { nodeType: 1, textContent: "红队模式" };
const document = {
  head: {
    append(node) {
      headStyles.push(node);
    },
  },
  createElement(tag) {
    assert.equal(tag, "style");
    return {
      textContent: "",
      setAttribute() {},
      remove() {
        const index = headStyles.indexOf(this);
        if (index >= 0) headStyles.splice(index, 1);
      },
    };
  },
  addEventListener(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  },
  removeEventListener(type, fn) {
    listeners.get(type)?.delete(fn);
    if (listeners.get(type)?.size === 0) listeners.delete(type);
  },
  /* Keep an unrelated red-team label visible to prove current-session precedence. */
  querySelector(selector) {
    return selector.includes("data-agent-preset='redteam'")
      ? redteamLabel
      : null;
  },
  querySelectorAll() {
    return [];
  },
};

function dispatch(type, target, extra = {}) {
  const event = {
    type,
    target,
    defaultPrevented: false,
    propagationStopped: false,
    immediatePropagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    stopImmediatePropagation() {
      this.immediatePropagationStopped = true;
    },
    ...extra,
  };
  for (const fn of [...(listeners.get(type) || [])]) fn(event);
  return event;
}

const composerCard = { nodeType: 1 };
const sendButton = {
  nodeType: 1,
  type: "button",
  textContent: "发送",
  className: "send-button",
  getAttribute(name) {
    return name === "aria-label" ? "发送" : null;
  },
  querySelector(selector) {
    return selector === "svg" ? {} : null;
  },
  closest(selector) {
    if (selector.includes("button")) return this;
    if (selector.includes("[data-composer-card]")) return composerCard;
    return null;
  },
};

const sessions = {
  list: {
    getSnapshot() {
      return {
        current: selected,
        byId: {
          normal: { projectionValues: { agentPreset: sessionModes.normal } },
          red: { projectionValues: { agentPreset: sessionModes.red } },
        },
      };
    },
    subscribe() {
      return () => {};
    },
  },
  scope(id) {
    return { id };
  },
  sessionOf(scope) {
    const id = scope?.id || selected;
    return {
      getSnapshot() {
        return { agentPreset: sessionModes[id], queue: [] };
      },
      updateQueue: async () => {},
    };
  },
};
const uiWorkspace = {
  selection: {
    getSnapshot: () => ({ sessionId: selected }),
    subscribe: () => () => {},
  },
};
const conversation = {
  input: {
    shell: (sessionId) => shells[sessionId] || null,
  },
};
const host = {
  sessions,
  uiWorkspace,
  conversation,
  effect(fn, name) {
    const dispose = fn();
    lifecycle.push({ dispose, name });
    return dispose;
  },
};

function response(data, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? "OK" : "Error",
    text: async () => JSON.stringify(data),
    json: async () => data,
  };
}

const fetchImpl = async (url, init = {}) => {
  const parsed = new URL(url, "http://fixture");
  const method = String(init.method || "GET").toUpperCase();
  let body = null;
  if (init.body) body = JSON.parse(init.body);
  requests.push({ path: parsed.pathname, method, body });
  if (parsed.pathname === "/dsh-purge/drill-grant")
    return response({ ok: true, granted: true });
  if (parsed.pathname === "/redteam/api") {
    if (body?.op === "platformEnvAdaptStatus")
      return response({
        ready: false,
        skipped: false,
        message: "fixture: no local environment",
      });
    if (body?.op === "platformEnvAdaptSkip")
      return response({ ready: true, skipped: true });
  }
  return response({ ok: true });
};

const timerApi = {
  setInterval(fn, ms) {
    const id = ++intervalId;
    intervals.set(id, { fn, ms });
    return id;
  },
  clearInterval(id) {
    intervals.delete(id);
  },
};
const runIntervals = (ms) => {
  for (const { fn, ms: intervalMs } of [...intervals.values()])
    if (intervalMs === ms) fn();
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let plugin;
const win = {
  location: { origin: "http://fixture", href: "http://fixture" },
  localStorage: storage,
  sessionStorage: storage,
  setTimeout,
  clearTimeout,
  setInterval: timerApi.setInterval,
  clearInterval: timerApi.clearInterval,
  addEventListener() {},
  removeEventListener() {},
  open() {},
  __ModuleLoader__: {
    load({ factory }) {
      plugin = factory((name) => (name === "react" ? React : require(name)));
    },
  },
};
const sandbox = {
  window: win,
  document,
  localStorage: storage,
  sessionStorage: storage,
  console,
  AbortController,
  URL,
  fetch: fetchImpl,
  setTimeout,
  clearTimeout,
  setInterval: timerApi.setInterval,
  clearInterval: timerApi.clearInterval,
};

vm.runInNewContext(clientSource, sandbox, { filename: clientPath });

const t = (key, args = {}) =>
  String(dict[key] || key).replace(/\{(\w+)\}/g, (_, name) => args[name] ?? "");
const ctx = {
  locale: {
    register: (_, values) => {
      Object.assign(dict, values.zh);
      return () => {};
    },
    bind: () => t,
  },
  effect(fn, name) {
    const dispose = fn();
    lifecycle.push({ dispose, name });
    return dispose;
  },
  slots: {
    inject: (_, fn) => fn(),
    register(spec, body) {
      seats.push({ spec, body });
      return () => {};
    },
  },
  inject(deps, fn) {
    if (deps.includes("sessions")) fn(host);
  },
};
host.slots = ctx.slots;
host.locale = ctx.locale;

function gateNodes(tree) {
  return tree.root.findAll(
    (node) =>
      typeof node.props?.className === "string" &&
      node.props.className.split(/\s+/).includes("dshpp-env-gate"),
  );
}
function seat(name) {
  return seats.find((entry) => entry.spec.name === name);
}

(async () => {
  let composerTree;
  let overlayTree;
  try {
    assert(plugin, "built client must register a ModuleLoader plugin");
    if (!process.env.PANEL_CLIENT)
      assert.equal(plugin.name, "dsh-purge-community");

    ctx && plugin.apply(ctx);
    const overlay = seat("shell.overlay");
    const composer = seat("conversation.composer.dock");
    const rail = seat("sidebar.panellist");
    const main = seat("main");
    assert(overlay, "shell overlay slot remains registered");
    assert(composer, "environment gate uses the public composer dock slot");
    assert.equal(composer.spec.id, "dsh-purge-env-gate");
    assert.equal(composer.spec.order, 10);
    if (plugin.name === "dsh-purge-community") {
      assert.equal(
        rail,
        undefined,
        "community build keeps the separately installed rightbar adapter without adding a duplicate left rail",
      );
    } else {
      assert(rail, "panel sidebar rail remains registered");
      assert.equal(rail.spec.id, "dsh-purge");
    }
    assert(main, "main page remains registered");
    assert.equal(main.spec.key, "dsh-purge");
    assert.equal(
      definitions.length,
      0,
      "the panel does not register a competing right-sidebar tab",
    );

    const cssStart = clientSource.indexOf(".dshpp-env-gate {");
    assert(cssStart >= 0, "built client contains dedicated environment CSS");
    const cssRule = clientSource.slice(
      cssStart,
      clientSource.indexOf("}", cssStart),
    );
    assert.match(clientSource, /\.dshpp-env-ops\s*\{/);
    assert.match(clientSource, /\.dshpp-env-warn\s*\{/);
    assert.doesNotMatch(
      cssRule,
      /position\s*:\s*fixed|inset\s*:\s*0|backdrop-filter|pointer-events\s*:\s*auto/,
      "composer notice CSS must not create a fixed/backdrop hit layer",
    );

    await act(async () => {
      overlayTree = create(React.createElement(overlay.body));
      await flush();
    });
    assert.equal(
      gateNodes(overlayTree).length,
      0,
      "global shell overlay must not render the environment gate",
    );
    await act(async () => overlayTree.unmount());
    overlayTree = null;

    await act(async () => {
      composerTree = create(React.createElement(composer.body));
      await flush();
    });
    assert.equal(gateNodes(composerTree).length, 0);

    /* A standard session must send even when an unrelated red-team chip exists. */
    const normalBefore = submissions.normal.length;
    shells.normal.submit("send");
    assert.equal(submissions.normal.length, normalBefore + 1);
    assert.equal(gateNodes(composerTree).length, 0);

    selected = "red";
    sessionModes.red = "redteam";
    await act(async () => {
      runIntervals(400);
      await flush();
    });
    const redBefore = submissions.red.length;
    shells.red.submit("send");
    await act(async () => {
      await flush();
    });
    assert.equal(
      submissions.red.length,
      redBefore,
      "red-team send is blocked while environment is not ready",
    );
    let gate = gateNodes(composerTree)[0];
    assert(gate, "blocked red-team send opens the composer notice");
    assert.equal(gate.props.role, "status");
    assert.equal(gate.props["aria-modal"], undefined);
    assert.doesNotMatch(gate.props.className, /dshp-auth-mask/);
    assert(
      composerTree.root.findAllByProps({ className: "dshpp-env-ops" }).length,
      "notice actions use the dedicated composer class",
    );

    const skipWrites = () =>
      requests.filter(
        (request) =>
          request.path === "/redteam/api" &&
          request.method === "POST" &&
          request.body?.op === "platformEnvAdaptSkip",
      );
    const close = composerTree.root.findByProps({ "aria-label": "关闭提示" });
    await act(async () => {
      close.props.onClick();
      await flush();
    });
    assert.equal(gateNodes(composerTree).length, 0);
    assert.equal(
      skipWrites().length,
      0,
      "dismissal never writes the skip decision",
    );

    /* Dismissal is temporary: a later blocked red-team send opens the notice again. */
    shells.red.submit("send");
    await act(async () => {
      await flush();
    });
    assert.equal(submissions.red.length, redBefore);
    assert.equal(gateNodes(composerTree).length, 1);

    await act(async () => {
      dispatch(
        "keydown",
        { nodeType: 1, closest: () => null },
        { key: "Escape" },
      );
      await flush();
    });
    assert.equal(
      gateNodes(composerTree).length,
      0,
      "Escape dismisses the notice",
    );
    assert.equal(
      skipWrites().length,
      0,
      "Escape never writes the skip decision",
    );

    /* The document capture guard blocks a real send control in red-team mode. */
    const blockedPointer = dispatch("pointerdown", sendButton);
    assert(blockedPointer.defaultPrevented);
    assert(blockedPointer.propagationStopped);
    assert(blockedPointer.immediatePropagationStopped);
    assert.equal(submissions.red.length, redBefore);

    shells.red.submit("send");
    await act(async () => {
      await flush();
    });
    assert.equal(gateNodes(composerTree).length, 1);

    /* Changing the current session closes a stale notice and restores ordinary send. */
    selected = "normal";
    await act(async () => {
      runIntervals(400);
      await flush();
    });
    assert.equal(gateNodes(composerTree).length, 0);
    const normalAfterSwitch = submissions.normal.length;
    shells.normal.submit("send");
    assert.equal(submissions.normal.length, normalAfterSwitch + 1);

    /* A preset change in the same session also clears the notice. */
    selected = "red";
    sessionModes.red = "redteam";
    await act(async () => {
      runIntervals(400);
      await flush();
    });
    shells.red.submit("send");
    await act(async () => {
      await flush();
    });
    assert.equal(gateNodes(composerTree).length, 1);
    sessionModes.red = "standard";
    await act(async () => {
      runIntervals(400);
      await flush();
    });
    assert.equal(gateNodes(composerTree).length, 0);
    const redAfterPreset = submissions.red.length;
    shells.red.submit("send");
    assert.equal(submissions.red.length, redAfterPreset + 1);

    assert.equal(skipWrites().length, 0);
    assert(
      requests.every((request) =>
        ["/dsh-purge/drill-grant", "/redteam/api"].includes(request.path),
      ),
      "keyless regression uses only the local stub backend",
    );
    console.log(
      "PASS: built client composer gate, ordinary send, dismiss/Escape, session/preset reset, sidebar and cleanup contracts",
    );
  } finally {
    if (composerTree) await act(async () => composerTree.unmount());
    if (overlayTree) await act(async () => overlayTree.unmount());
    for (const item of lifecycle.reverse())
      if (typeof item.dispose === "function") item.dispose();
  }

  assert.equal(shells.normal.submit, originalSubmit.normal);
  assert.equal(shells.red.submit, originalSubmit.red);
  assert.equal(shells.normal.actions.submit, originalActionsSubmit.normal);
  assert.equal(shells.red.actions.submit, originalActionsSubmit.red);
  assert.equal(listeners.size, 0, "document listeners are removed on unmount");
  assert.equal(intervals.size, 0, "polling intervals are removed on cleanup");
  assert.equal(
    headStyles.length,
    0,
    "owned visibility style is removed on cleanup",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
