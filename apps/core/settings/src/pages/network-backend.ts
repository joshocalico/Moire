/**
 * Reading a VPN configuration the person picked: the file, and for OpenVPN the certificate and
 * key files it names next to it, inlined so the management service gets one self-contained text.
 * Failures come back as messages for the import sheet.
 */
import fs from "node:fs";
import path from "node:path";
import { VPN_CONFIG_LIMIT } from "@moire/system-management/network-status";
import {
  inlineOpenVpnFiles,
  parseOpenVpnConfig,
  parseWireGuardConfig,
  vpnKindFromFile,
  vpnNameFromFile,
} from "@moire/system-management/vpn-config";

export type VpnFile =
  | {
      kind: "wireguard" | "openvpn";
      name: string;
      config: string;
      /** OpenVPN's auth-user-pass: the sheet asks for them. */
      needsCredentials: boolean;
      /** Directives Moire leaves out, to mention in the sheet. */
      ignored: readonly string[];
    }
  | { kind: "error"; message: string };

function readText(file: string): string {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`${path.basename(file)} isn't a file`);
  if (stat.size > VPN_CONFIG_LIMIT) throw new Error(`${path.basename(file)} is too large`);
  return fs.readFileSync(file, "utf8");
}

export function readVpnFile(file: string): VpnFile {
  try {
    const text = readText(file);
    const kind =
      vpnKindFromFile(file) ??
      (/^\s*\[Interface\]/im.test(text)
        ? "wireguard"
        : /^\s*client\s*$/m.test(text)
          ? "openvpn"
          : null);
    if (!kind) return { kind: "error", message: "Choose a WireGuard .conf or OpenVPN .ovpn file" };
    if (kind === "wireguard") {
      const parsed = parseWireGuardConfig(text);
      return {
        kind,
        name: vpnNameFromFile(file),
        config: text,
        needsCredentials: false,
        ignored: parsed.ignored,
      };
    }
    const directory = path.dirname(file);
    const config = inlineOpenVpnFiles(text, (name) =>
      readText(path.isAbsolute(name) ? name : path.join(directory, name)),
    );
    if (config.length > VPN_CONFIG_LIMIT)
      return { kind: "error", message: "The profile and its certificates are too large" };
    const parsed = parseOpenVpnConfig(config);
    return {
      kind,
      name: vpnNameFromFile(file),
      config,
      needsCredentials: parsed.authUserPass,
      ignored: parsed.ignored,
    };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
