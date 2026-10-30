/** The tag catalog, loaded once per workspace; `revision` moves whenever its tags change. */
import { useEffect, useMemo, useRef, useState } from "react";
import { operationError } from "@moire/file-operations";
import { FileCatalog } from "./catalog";

export function useCatalog(onError: (message: string) => void) {
  const catalog = useMemo(() => new FileCatalog(), []);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  // The error reporter belongs to the operations queue, which itself needs the catalog.
  const report = useRef(onError);
  report.current = onError;
  useEffect(() => {
    let alive = true;
    void catalog.load().then(
      () => alive && setReady(true),
      (error) => alive && report.current(operationError(error)),
    );
    return () => {
      alive = false;
    };
  }, [catalog]);
  return { catalog, ready, revision, changed: () => setRevision((value) => value + 1) };
}
