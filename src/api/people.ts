import { invoke } from "./gesture";

/** A Person in the knowledge base — someone a Task can be delegated to. */
export interface Person {
  id: number;
  name: string;
  /** JSON array of alias strings. */
  aliases: string;
  linked_note: string | null;
}

export async function listPeople(): Promise<Person[]> {
  return invoke<Person[]>("list_people");
}
