/**
 * React hooks that bridge the imperative Application/manager/session APIs into
 * the declarative component tree: any data change triggers a re-render.
 */
import { useEffect, useState } from "react";
import type { Application } from "../app/application.js";
import type { SearchSession } from "../app/search-service.js";

/** Re-render the tree on an interval (live download speeds, spinner). */
export function useRerenderInterval(ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => (n + 1) % 1_000_000_000), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}

/** Re-render whenever a search session emits new results / settles. */
export function useSearchSession(session: SearchSession | null): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!session) return;
    return session.onChange(() => setTick((n) => n + 1));
  }, [session]);
}

/** Re-render whenever the download manager reports any change. */
export function useManagerEvents(app: Application): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = (): void => setTick((n) => n + 1);
    app.manager.on("update", bump);
    app.manager.on("added", bump);
    app.manager.on("removed", bump);
    app.manager.on("completed", bump);
    app.manager.on("failed", bump);
    app.manager.on("statusChanged", bump);
    app.manager.on("recovered", bump);
    return () => {
      app.manager.off("update", bump);
      app.manager.off("added", bump);
      app.manager.off("removed", bump);
      app.manager.off("completed", bump);
      app.manager.off("failed", bump);
      app.manager.off("statusChanged", bump);
      app.manager.off("recovered", bump);
    };
  }, [app]);
}

/** Latest crash-recovery report, re-read whenever the manager emits `recovered`. */
export function useRecovery(app: Application): ReturnType<Application["manager"]["lastRecovery"]> {
  const [recovery, setRecovery] = useState<ReturnType<Application["manager"]["lastRecovery"]>>(
    () => app.manager.lastRecovery(),
  );
  useEffect(() => {
    setRecovery(app.manager.lastRecovery());
    const onRecovered = (): void => setRecovery(app.manager.lastRecovery());
    app.manager.on("recovered", onRecovered);
    return (): void => {
      app.manager.off("recovered", onRecovered);
    };
  }, [app]);
  return recovery;
}
