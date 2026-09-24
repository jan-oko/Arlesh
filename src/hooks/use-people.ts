import { useEffect, useState } from "react";
import { listPeople } from "@/api/people";
import type { Person } from "@/api/people";

/** The knowledge base's People, loaded once for a picker; empty until they arrive or if they fail. */
export function usePeople(): Person[] {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let active = true;
    listPeople().then(
      (loaded) => { if (active) setPeople(loaded); },
      () => { if (active) setPeople([]); },
    );
    return () => { active = false; };
  }, []);
  return people;
}
