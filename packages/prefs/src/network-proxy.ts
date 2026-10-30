/**
 * The manual proxy. NetworkManager's per-connection proxy only knows "none" and "auto" (a PAC
 * file), so a hand-entered proxy is a Moire preference instead: the compositor puts it in the
 * environment of every app it starts (`http_proxy`, `https_proxy`, `no_proxy` and their upper
 * case forms), which command-line tools, Node, Python and most browsers' "system proxy" read.
 * Apps already running keep the environment they started with.
 */
export type ManualProxySettings = {
  enabled: boolean;
  /** `host:port` for http:// requests. */
  http: string;
  /** `host:port` for https:// requests; empty uses the HTTP proxy. */
  https: string;
  /** Hosts and domains that go direct, comma-separated. */
  ignore: string;
};

export const DEFAULT_MANUAL_PROXY: ManualProxySettings = {
  enabled: false,
  http: "",
  https: "",
  ignore: "localhost, 127.0.0.0/8, ::1",
};

/** `host:port` or `[v6]:port`, optionally with an http:// prefix. */
export function isProxyAddress(value: string): boolean {
  return /^(?:https?:\/\/)?(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):\d{1,5}\/?$/.test(
    value.trim(),
  );
}

function address(value: unknown): string {
  return typeof value === "string" && isProxyAddress(value) ? value.trim() : "";
}

export function normalizeManualProxy(value: unknown): ManualProxySettings {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const http = address(raw.http);
  const ignore =
    typeof raw.ignore === "string" && raw.ignore.length <= 2048 && !/[\r\n]/.test(raw.ignore)
      ? raw.ignore.trim()
      : DEFAULT_MANUAL_PROXY.ignore;
  return { enabled: raw.enabled === true && !!http, http, https: address(raw.https), ignore };
}

/** The variables an app started now gets; empty when the manual proxy is off. */
export function proxyEnvironment(proxy: ManualProxySettings): Record<string, string> {
  if (!proxy.enabled || !proxy.http) return {};
  const url = (value: string) => (/^https?:\/\//.test(value) ? value : `http://${value}`);
  const http = url(proxy.http),
    https = url(proxy.https || proxy.http);
  const ignore = proxy.ignore
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
  return {
    http_proxy: http,
    HTTP_PROXY: http,
    https_proxy: https,
    HTTPS_PROXY: https,
    ...(ignore ? { no_proxy: ignore, NO_PROXY: ignore } : {}),
  };
}
