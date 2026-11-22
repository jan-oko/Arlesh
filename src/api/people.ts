import { invoke } from "./gesture";

/** A knowledge-base Person — someone a Task can be delegated to. */
export interface Person {
  id: string;
  name: string;
}

/** Every Person, by name. */
export async function listPeople(): Promise<Person[]> {
  return invoke<Person[]>("list_people");
}
