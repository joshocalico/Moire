/**
 * A scripted stand-in for libpam with the same contract as `@moire/sys/pam`: synchronous
 * conversation, answers as bytes that the "binding" wipes once consumed. It verifies nothing
 * real; accounts and passwords are synthetic test values.
 */
import {
  PAM_ACCT_EXPIRED,
  PAM_AUTH_ERR,
  PAM_CONV_ERR,
  PAM_NEW_AUTHTOK_REQD,
  PAM_SUCCESS,
  PAM_SYSTEM_ERR,
  PAM_USER_UNKNOWN,
  type Pam,
  type PamConversation,
  type PamHandle,
  type PamPrompt,
} from "@moire/sys/pam";

/** Synthetic; must never show up in any log, record or state the smokes inspect. */
export const FAKE_PASSWORD = "SYNTHETIC-moire-dm-password";

export type FakeAccount = Readonly<{
  password: string;
  /** Extra message shown before the password prompt. */
  notice?: string;
  account?: "ok" | "expired-password" | "expired-account";
  /** The name PAM settles on, if a module maps it. */
  mappedUser?: string;
  failOpenSession?: boolean;
}>;

export type FakePamRecord = {
  calls: string[];
  env: string[];
  /** Every answer array the conversation returned, checked for wiping afterwards. */
  answers: Uint8Array[];
  /** Plain copies the fake compared against, for assertions only. */
  received: string[];
};

export function createFakePam(
  accounts: Readonly<Record<string, FakeAccount>>,
  record: FakePamRecord = { calls: [], env: [], answers: [], received: [] },
): Pam & { record: FakePamRecord } {
  function ask(conversation: PamConversation, prompts: PamPrompt[]): string[] | null {
    const answers = conversation(prompts);
    if (!answers || answers.length !== prompts.length) return null;
    const out: string[] = [];
    for (const answer of answers) {
      if (answer) {
        record.answers.push(answer);
        out.push(Buffer.from(answer).toString("utf8"));
        // The real binding copies into C memory and wipes the caller's array; so does this.
        answer.fill(0);
      } else out.push("");
    }
    record.received.push(...out.filter(Boolean));
    return out;
  }

  return {
    record,
    start(service, user, conversation, confdir) {
      record.calls.push(`start:${service}:${user}:${confdir ?? "system"}`);
      const account = accounts[user];
      let ended = false;
      const handle: PamHandle = {
        setTty(tty) {
          record.calls.push(`tty:${tty}`);
          return PAM_SUCCESS;
        },
        putEnv(entry) {
          record.env.push(entry);
          return PAM_SUCCESS;
        },
        user: () => account?.mappedUser ?? user,
        authenticate() {
          record.calls.push("authenticate");
          const prompts: PamPrompt[] = [];
          if (account?.notice) prompts.push({ style: "info", text: account.notice });
          prompts.push({ style: "secret", text: "Password: " });
          const answers = ask(conversation, prompts);
          if (!answers) return PAM_CONV_ERR;
          // Unknown users still get a prompt and the same refusal code path, as pam_unix does.
          if (!account) return PAM_USER_UNKNOWN;
          return answers[answers.length - 1] === account.password ? PAM_SUCCESS : PAM_AUTH_ERR;
        },
        accountManagement() {
          record.calls.push("acct");
          if (!account) return PAM_USER_UNKNOWN;
          if (account.account === "expired-password") return PAM_NEW_AUTHTOK_REQD;
          if (account.account === "expired-account") return PAM_ACCT_EXPIRED;
          return PAM_SUCCESS;
        },
        changeAuthToken() {
          record.calls.push("chauthtok");
          const answers = ask(conversation, [
            { style: "secret", text: "New password: " },
            { style: "secret", text: "Retype new password: " },
          ]);
          if (!answers) return PAM_CONV_ERR;
          return answers[0] && answers[0] === answers[1] ? PAM_SUCCESS : PAM_AUTH_ERR;
        },
        setCredentials(flags) {
          record.calls.push(`setcred:${flags}`);
          return PAM_SUCCESS;
        },
        openSession() {
          record.calls.push("open");
          return account?.failOpenSession ? PAM_SYSTEM_ERR : PAM_SUCCESS;
        },
        closeSession() {
          record.calls.push("close");
          return PAM_SUCCESS;
        },
        environment: () => [
          ...record.env,
          "XDG_RUNTIME_DIR=/run/user/1000",
          "XDG_SESSION_ID=7",
          "LD_PRELOAD=/tmp/evil.so",
          "HOME=/tmp/pam-must-not-win",
        ],
        end(status) {
          if (!ended) record.calls.push(`end:${status}`);
          ended = true;
          return PAM_SUCCESS;
        },
      };
      return { ok: true, handle };
    },
  };
}
