import { useEffect, useState } from "react";
import { listDomains } from "@/api/domains";

// One shared fetch: the whole node canvas resolves tag names from the same domain map.
let cache: Promise<Map<string, string>> | null = null;

function loadNames(): Promise<Map<string, string>> {
  if (cache === null) {
    cache = listDomains().then((domains) => new Map(domains.map((d) => [d.id, d.title])));
  }
  return cache;
}

/** Clears the cached domain-name map (call after a rename so tooltips refresh). */
export function invalidateTagNames(): void {
  cache = null;
}

/** A map of domain id → title, for resolving a node's `tagIds` to names in tooltips. */
export function useTagNames(): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let active = true;
    void loadNames().then((map) => {
      if (active) setNames(map);
    });
    return () => {
      active = false;
    };
  }, []);
  return names;
}
