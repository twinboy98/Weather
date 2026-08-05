"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const basePath = rawBasePath && rawBasePath !== "/"
      ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
      : "";

    void navigator.serviceWorker.register(`${basePath}/sw.js`, {
      scope: `${basePath}/`,
    }).catch(() => undefined);
  }, []);
  return null;
}
