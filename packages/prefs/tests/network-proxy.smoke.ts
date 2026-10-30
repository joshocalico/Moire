/** The manual proxy pref: normalization and the environment apps are started with. */
import assert from "node:assert/strict";
import {
  DEFAULT_MANUAL_PROXY,
  DEFAULT_SETTINGS,
  isProxyAddress,
  normalizeManualProxy,
  proxyEnvironment,
} from "@moire/prefs";

assert.deepEqual(DEFAULT_SETTINGS.proxy, DEFAULT_MANUAL_PROXY);
assert.deepEqual(normalizeManualProxy(undefined), DEFAULT_MANUAL_PROXY);
assert.deepEqual(proxyEnvironment(DEFAULT_MANUAL_PROXY), {}, "off sets nothing");
for (const good of ["proxy.example.com:3128", "http://10.0.0.1:8080", "[fd00::1]:3128"])
  assert(isProxyAddress(good), good);
for (const bad of ["proxy.example.com", "a b:1", "ftp://x:1", ":3128", "x:123456"])
  assert(!isProxyAddress(bad), bad);
assert.equal(
  normalizeManualProxy({ enabled: true, http: "not an address" }).enabled,
  false,
  "no usable HTTP proxy, no manual proxy",
);
const manual = normalizeManualProxy({
  enabled: true,
  http: " proxy.example.com:3128 ",
  https: "",
  ignore: "localhost, .corp.example ,",
});
assert.deepEqual(proxyEnvironment(manual), {
  http_proxy: "http://proxy.example.com:3128",
  HTTP_PROXY: "http://proxy.example.com:3128",
  https_proxy: "http://proxy.example.com:3128",
  HTTPS_PROXY: "http://proxy.example.com:3128",
  no_proxy: "localhost,.corp.example",
  NO_PROXY: "localhost,.corp.example",
});
assert.equal(
  proxyEnvironment({ ...manual, https: "secure.example.com:443" }).https_proxy,
  "http://secure.example.com:443",
);
assert.equal(normalizeManualProxy({ ignore: "a\nb" }).ignore, DEFAULT_MANUAL_PROXY.ignore);
console.log("[network-proxy] manual proxy prefs and environment passed");
