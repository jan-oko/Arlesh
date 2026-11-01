import { invoke } from "./gesture";
import { isWireError } from "./errors";

/**
 * Pairing a device and the Devices page: the server's `/pair`, `/devices` and `/pairings` routes.
 * See docs/spec/client-mode.md, *Pairing a device*.
 */

/** What asking the server for a PIN answered. */
export interface PairStarted {
  /** The poll's secret. Kept by the device, shown to nobody. */
  id: string;
  /** Six digits, valid for ten minutes and usable once. */
  pin: string;
  /** The suggested name as the server reduced it to a client name. */
  name: string;
  expires_at: string;
}

/** What a poll answered: still waiting, or approved with this device's token (once). */
export interface PairPolled {
  status: "pending" | "approved";
  name: string | null;
  token: string | null;
}

/** A device holding a token. */
export interface Device {
  name: string;
  created_at: string;
  /** When it last used its token, or `null` if the server has not seen it since it began to keep that. */
  last_seen_at: string | null;
  /** Whether this is the device asking: it cannot be revoked. */
  current: boolean;
}

/** A device showing a PIN. */
export interface WaitingDevice {
  pin: string;
  /** The name it suggested, which the approver may change. */
  name: string;
  expires_at: string;
}

/** The name to suggest for this device: the host name, or the phone's model. */
export async function deviceName(): Promise<string> {
  return invoke<string>("device_name");
}

export async function pairStart(url: string, name: string): Promise<PairStarted> {
  return invoke<PairStarted>("pair_start", { url, name });
}

export async function pairPoll(url: string, id: string, pin: string): Promise<PairPolled> {
  return invoke<PairPolled>("pair_poll", { url, id, pin });
}

export async function listDevices(): Promise<Device[]> {
  return invoke<Device[]>("list_devices");
}

export async function waitingDevice(pin: string): Promise<WaitingDevice> {
  return invoke<WaitingDevice>("waiting_device", { pin });
}

/** Approves the device showing `pin`; answers the name it will hold (suffixed if taken). */
export async function approveDevice(pin: string, name: string): Promise<string> {
  const approved = await invoke<{ name: string }>("approve_device", { pin, name });
  return approved.name;
}

export async function revokeDevice(name: string): Promise<void> {
  await invoke<null>("revoke_device", { name });
}

/** The server's `details.reason` of a refusal, when it gave one. */
export function errorReason(error: unknown): string | null {
  if (!isWireError(error) || typeof error.details !== "object" || error.details === null) return null;
  const reason = Reflect.get(error.details, "reason");
  return typeof reason === "string" ? reason : null;
}
