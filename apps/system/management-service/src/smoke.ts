import assert from "node:assert/strict";
import { SystemManagementClient } from "@moire/system-management";

const client = await SystemManagementClient.connect();
try {
  const snapshot = await client.snapshot();
  assert(snapshot.totalMemoryBytes > 0, "total memory should be reported");
  assert(snapshot.availableMemoryBytes > 0, "available memory should be reported");
  assert(snapshot.processes.length > 0, "session processes should be reported");
  const service = snapshot.processes.find(
    (item) => item.appId === "org.moire.SystemManagement",
  );
  assert(service, "management service should identify itself");
  assert.equal(service.protected, true, "management service should be protected");
  assert.equal(
    await client.terminate(service.pid),
    false,
    "protected management service must reject termination",
  );
  console.log("[system-management/smoke] ok");
} finally {
  client.close();
}
