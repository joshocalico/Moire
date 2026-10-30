/**
 * libpam (Linux-PAM) over koffi: the audited native boundary for moire-dm.
 *
 * Only moire-dm's root session worker imports this (via `@moire/sys/pam`); it is deliberately
 * not re-exported from the package index. Everything native stays in this file: the conversation
 * trampoline, PAM-owned memory, and the environment list. Callers see status codes as values,
 * prompts as plain objects and answers as byte arrays.
 *
 * Threading: PAM calls the conversation synchronously from inside pam_authenticate() and friends,
 * on the thread that called them. Every entry point here is a synchronous koffi call on the JS
 * main thread, so the registered callback also runs there, re-entrantly, while the outer call is
 * still on the stack. Never call these through koffi's `.async()`: the callback would then be
 * marshalled back to an event loop that the conversation is itself waiting on. A conversation
 * that needs input from elsewhere must block (moire-dm's worker does a blocking read on a pipe),
 * which is why PAM runs in a dedicated worker process and never in the daemon's event loop.
 *
 * Secrets: answers are copied straight from the caller's Uint8Array into malloc()ed C memory that
 * PAM owns (and Linux-PAM overwrites before freeing), then the Uint8Array is zero-filled before
 * the callback returns. No JS string is made from an answer here.
 */
import koffi from "koffi";
import { bindNativeFunction, type NativeFunction } from "./ffi";

export const PAM_SUCCESS = 0;
export const PAM_SYSTEM_ERR = 4;
export const PAM_BUF_ERR = 5;
export const PAM_PERM_DENIED = 6;
export const PAM_AUTH_ERR = 7;
export const PAM_USER_UNKNOWN = 10;
export const PAM_MAXTRIES = 11;
export const PAM_NEW_AUTHTOK_REQD = 12;
export const PAM_ACCT_EXPIRED = 13;
export const PAM_CONV_ERR = 19;
export const PAM_ABORT = 26;

export const PAM_SILENT = 0x8000;
export const PAM_DISALLOW_NULL_AUTHTOK = 0x0001;
export const PAM_ESTABLISH_CRED = 0x0002;
export const PAM_DELETE_CRED = 0x0004;
export const PAM_CHANGE_EXPIRED_AUTHTOK = 0x0020;

const PAM_USER = 2;
const PAM_TTY = 3;

const PAM_PROMPT_ECHO_OFF = 1;
const PAM_PROMPT_ECHO_ON = 2;
const PAM_ERROR_MSG = 3;
const PAM_TEXT_INFO = 4;

/** Linux-PAM's PAM_MAX_NUM_MSG; a module asking for more is refused, not trusted. */
const MAX_MESSAGES = 32;
/** PAM_MAX_MSG_SIZE: longer prompt text is cut, never forwarded whole to the greeter. */
const MAX_PROMPT_CHARS = 512;
/** Matches PAM_MAX_RESP_SIZE. Longer answers are refused rather than truncated. */
export const PAM_MAX_ANSWER_BYTES = 512;
/** sizeof(struct pam_response) on LP64: char *resp; int resp_retcode; plus padding. */
const RESPONSE_SIZE = 16;
const POINTER_SIZE = 8;

export type PamStatus = number;
export type PamPromptStyle = "secret" | "visible" | "error" | "info";
export type PamPrompt = Readonly<{ style: PamPromptStyle; text: string }>;
/**
 * One answer per prompt, in order: bytes for "secret"/"visible", null for "error"/"info".
 * Returning null (or throwing) aborts the conversation with PAM_CONV_ERR. The binding wipes
 * every returned array once copied, so callers must hand over buffers they no longer need.
 */
export type PamConversation = (
  prompts: readonly PamPrompt[],
) => readonly (Uint8Array | null)[] | null;

export type PamHandle = {
  /** PAM_TTY, e.g. "tty1". pam_systemd derives the VT from it. */
  setTty(tty: string): PamStatus;
  /** "NAME=value" into the PAM environment; pam_systemd reads XDG_SESSION_* from here. */
  putEnv(entry: string): PamStatus;
  /** The account PAM settled on (a module may map the name the greeter typed). */
  user(): string | null;
  authenticate(flags: number): PamStatus;
  accountManagement(flags: number): PamStatus;
  changeAuthToken(flags: number): PamStatus;
  setCredentials(flags: number): PamStatus;
  openSession(flags: number): PamStatus;
  closeSession(flags: number): PamStatus;
  /** The PAM environment as "NAME=value" entries, freed natively after decoding. */
  environment(): readonly string[] | null;
  /** pam_end(); idempotent. Releases the conversation trampoline. */
  end(status: PamStatus): PamStatus;
};

export type PamStart =
  | Readonly<{ ok: true; handle: PamHandle }>
  | Readonly<{ ok: false; status: PamStatus }>;

export type Pam = {
  /**
   * pam_start_confdir(). `confdir` is null in production (the system's /etc/pam.d); the Linux
   * smoke points it at a private directory so it needs no system PAM configuration.
   */
  start(
    service: string,
    user: string,
    conversation: PamConversation,
    confdir: string | null,
  ): PamStart;
};

type Bindings = {
  startConfdir: NativeFunction<
    [service: string, user: string, conv: unknown, confdir: string | null, handle: unknown[]],
    number
  >;
  end: NativeFunction<[handle: unknown, status: number], number>;
  authenticate: NativeFunction<[handle: unknown, flags: number], number>;
  acctMgmt: NativeFunction<[handle: unknown, flags: number], number>;
  chauthtok: NativeFunction<[handle: unknown, flags: number], number>;
  setcred: NativeFunction<[handle: unknown, flags: number], number>;
  openSession: NativeFunction<[handle: unknown, flags: number], number>;
  closeSession: NativeFunction<[handle: unknown, flags: number], number>;
  setItemString: NativeFunction<[handle: unknown, item: number, value: string], number>;
  getItem: NativeFunction<[handle: unknown, item: number, value: unknown[]], number>;
  putenv: NativeFunction<[handle: unknown, entry: string], number>;
  getenvlist: NativeFunction<[handle: unknown], unknown>;
  calloc: NativeFunction<[count: number, size: number], unknown>;
  malloc: NativeFunction<[size: number], unknown>;
  free: NativeFunction<[pointer: unknown], void>;
  memcpy: NativeFunction<[destination: unknown, source: Uint8Array, length: number], unknown>;
};

const ConversationProto = koffi.proto(
  "int moire_pam_conv(int num_msg, void *msg, void *resp, void *appdata_ptr)",
);
// Registered by name for the pam_start_confdir declaration below.
koffi.struct("moire_pam_conv_struct", {
  conv: koffi.pointer(ConversationProto),
  appdata_ptr: "void *",
});
const PamMessageStruct = koffi.struct("moire_pam_message", {
  msg_style: "int",
  msg: "void *",
});

let bindings: Bindings | null = null;

function load(): Bindings {
  if (bindings) return bindings;
  const pam = koffi.load("libpam.so.0");
  const libc = koffi.load("libc.so.6");
  bindings = {
    startConfdir: bindNativeFunction(
      pam,
      "int pam_start_confdir(const char *service, const char *user, const moire_pam_conv_struct *conv, const char *confdir, _Out_ void **pamh)",
    ),
    end: bindNativeFunction(pam, "int pam_end(void *pamh, int status)"),
    authenticate: bindNativeFunction(pam, "int pam_authenticate(void *pamh, int flags)"),
    acctMgmt: bindNativeFunction(pam, "int pam_acct_mgmt(void *pamh, int flags)"),
    chauthtok: bindNativeFunction(pam, "int pam_chauthtok(void *pamh, int flags)"),
    setcred: bindNativeFunction(pam, "int pam_setcred(void *pamh, int flags)"),
    openSession: bindNativeFunction(pam, "int pam_open_session(void *pamh, int flags)"),
    closeSession: bindNativeFunction(pam, "int pam_close_session(void *pamh, int flags)"),
    setItemString: bindNativeFunction(
      pam,
      "int pam_set_item(void *pamh, int item_type, const char *item)",
    ),
    getItem: bindNativeFunction(
      pam,
      "int pam_get_item(void *pamh, int item_type, _Out_ void **item)",
    ),
    putenv: bindNativeFunction(pam, "int pam_putenv(void *pamh, const char *name_value)"),
    getenvlist: bindNativeFunction(pam, "void *pam_getenvlist(void *pamh)"),
    calloc: bindNativeFunction(libc, "void *calloc(size_t nmemb, size_t size)"),
    malloc: bindNativeFunction(libc, "void *malloc(size_t size)"),
    free: bindNativeFunction(libc, "void free(void *ptr)"),
    memcpy: bindNativeFunction(libc, "void *memcpy(void *dest, const void *src, size_t n)"),
  };
  return bindings;
}

function promptStyle(style: number): PamPromptStyle | null {
  if (style === PAM_PROMPT_ECHO_OFF) return "secret";
  if (style === PAM_PROMPT_ECHO_ON) return "visible";
  if (style === PAM_ERROR_MSG) return "error";
  if (style === PAM_TEXT_INFO) return "info";
  return null;
}

function decodePromptText(pointer: unknown): string {
  if (pointer === null) return "";
  // Read to the terminator: a fixed-length read could run past a short string's allocation.
  const raw = (koffi.decode(pointer, "char", -1) as string).slice(0, MAX_PROMPT_CHARS);
  // oxlint-disable-next-line no-control-regex -- matching control characters is the point.
  return raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

/** Copy an answer into malloc()ed, NUL-terminated memory that PAM will own and free. */
function nativeAnswer(native: Bindings, answer: Uint8Array): unknown {
  const memory = native.malloc(answer.byteLength + 1);
  if (memory === null) return null;
  if (answer.byteLength > 0) native.memcpy(memory, answer, answer.byteLength);
  koffi.encode(memory, answer.byteLength, "uint8_t", 0);
  return memory;
}

function wipe(answers: readonly (Uint8Array | null)[] | null): void {
  if (!answers) return;
  for (const answer of answers) answer?.fill(0);
}

function conversationTrampoline(native: Bindings, conversation: PamConversation) {
  return (count: number, messages: unknown, response: unknown, _appdata: unknown): number => {
    let answers: readonly (Uint8Array | null)[] | null = null;
    try {
      if (!Number.isInteger(count) || count < 1 || count > MAX_MESSAGES) return PAM_CONV_ERR;
      // Linux-PAM passes `const struct pam_message **`: an array of pointers to messages.
      const pointers = koffi.decode(messages, koffi.array("void *", count)) as unknown[];
      const prompts: PamPrompt[] = [];
      for (const pointer of pointers) {
        const message = koffi.decode(pointer, PamMessageStruct) as {
          msg_style: number;
          msg: unknown;
        };
        const style = promptStyle(message.msg_style);
        if (!style) return PAM_CONV_ERR;
        prompts.push({ style, text: decodePromptText(message.msg) });
      }
      answers = conversation(prompts);
      if (!answers || answers.length !== prompts.length) return PAM_CONV_ERR;
      for (let index = 0; index < prompts.length; index++) {
        const answer = answers[index];
        const question = prompts[index]!.style === "secret" || prompts[index]!.style === "visible";
        if (question !== answer instanceof Uint8Array) return PAM_CONV_ERR;
        if (answer && answer.byteLength > PAM_MAX_ANSWER_BYTES) return PAM_CONV_ERR;
        if (answer?.includes(0)) return PAM_CONV_ERR;
      }
      const table = native.calloc(prompts.length, RESPONSE_SIZE);
      if (table === null) return PAM_BUF_ERR;
      for (let index = 0; index < prompts.length; index++) {
        const answer = answers[index];
        if (!answer) continue;
        const copy = nativeAnswer(native, answer);
        if (copy === null) {
          // PAM only frees the table on success; release what we built so far.
          for (let built = 0; built < index; built++) {
            const entry = koffi.decode(table, built * RESPONSE_SIZE, "void *");
            if (entry !== null) native.free(entry);
          }
          native.free(table);
          return PAM_BUF_ERR;
        }
        koffi.encode(table, index * RESPONSE_SIZE, "void *", copy);
      }
      koffi.encode(response, "void *", table);
      return PAM_SUCCESS;
    } catch {
      return PAM_CONV_ERR;
    } finally {
      wipe(answers);
    }
  };
}

function decodeEnvironment(native: Bindings, list: unknown): readonly string[] {
  const entries: string[] = [];
  for (let index = 0; ; index++) {
    const pointer = koffi.decode(list, index * POINTER_SIZE, "void *");
    if (pointer === null) break;
    entries.push(koffi.decode(pointer, "char", -1) as string);
    native.free(pointer);
  }
  native.free(list);
  return entries;
}

function handleFor(native: Bindings, raw: unknown, release: () => void): PamHandle {
  let ended = false;
  const guarded =
    (call: (handle: unknown, flags: number) => number) =>
    (flags: number): PamStatus =>
      ended ? PAM_SYSTEM_ERR : call(raw, flags);
  return {
    setTty: (tty) => (ended ? PAM_SYSTEM_ERR : native.setItemString(raw, PAM_TTY, tty)),
    putEnv: (entry) => (ended ? PAM_SYSTEM_ERR : native.putenv(raw, entry)),
    user() {
      if (ended) return null;
      const out: unknown[] = [null];
      if (native.getItem(raw, PAM_USER, out) !== PAM_SUCCESS || out[0] === null) return null;
      return koffi.decode(out[0], "char", -1) as string;
    },
    authenticate: guarded(native.authenticate),
    accountManagement: guarded(native.acctMgmt),
    changeAuthToken: guarded(native.chauthtok),
    setCredentials: guarded(native.setcred),
    openSession: guarded(native.openSession),
    closeSession: guarded(native.closeSession),
    environment() {
      if (ended) return null;
      const list = native.getenvlist(raw);
      return list === null ? null : decodeEnvironment(native, list);
    },
    end(status) {
      if (ended) return PAM_SUCCESS;
      ended = true;
      try {
        return native.end(raw, status);
      } finally {
        release();
      }
    },
  };
}

/** Load libpam lazily; importing this module touches no native library. */
export function openPam(): Pam {
  return {
    start(service, user, conversation, confdir) {
      const native = load();
      const callback = koffi.register(
        conversationTrampoline(native, conversation),
        koffi.pointer(ConversationProto),
      );
      const release = () => koffi.unregister(callback);
      const out: unknown[] = [null];
      let status: number;
      try {
        // Linux-PAM copies struct pam_conv in pam_start, so koffi's temporary copy is enough;
        // the trampoline itself stays registered until end().
        status = native.startConfdir(
          service,
          user,
          { conv: callback, appdata_ptr: null },
          confdir,
          out,
        );
      } catch (error) {
        release();
        throw error;
      }
      if (status !== PAM_SUCCESS || out[0] === null) {
        // pam_start may still allocate a handle on failure; pam_end releases it.
        if (out[0] !== null) native.end(out[0], status);
        release();
        return { ok: false, status: status === PAM_SUCCESS ? PAM_SYSTEM_ERR : status };
      }
      return { ok: true, handle: handleFor(native, out[0], release) };
    },
  };
}
