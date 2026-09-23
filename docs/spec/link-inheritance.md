# Link Inheritance

*One area of the [Arlesh design specification](../../SPEC.md).*

All link types inherit downward from parent to child. When filtering, a child item matches a filter if it or any ancestor holds the matching link.

Inheritance behavior per link type:

| Link type              | Behavior when child has explicit value |
|------------------------|----------------------------------------|
| Tags                   | Additive — child has both parent's and its own tags |
| KB links (Person/Event/Thread) | Additive |
| Time Scope (relevance) | A null child Time Scope inherits the nearest scoped ancestor's window. An explicit child Time Scope must be wholly contained within the parent's (interval containment); it narrows relevance but the parent window still contains it. |
| Plan (scheduling)      | Task-only. Must be wholly contained within the task's Time Scope and within the parent's Plan. |
| Delegation             | Override — child's explicit delegation replaces the inherited one, whichever kind either is: a Person overrides an inherited Agent and the Agent an inherited Person |
| Agentic (Tasks)        | Override — child's explicit value (agentic *or* not agentic) replaces the inherited one; inherits through unflagged kinds |
| Asynchronous (Tasks)   | **None** — the flag stops at the Task it is set on. "Starts a wait" describes one concrete action, and a subtask of an asynchronous Task is usually the work done *after* the wait, so inheriting it would flag exactly the wrong rows |

Inherited links are computed on read (ancestor traversal). To be revisited if performance becomes an issue.

---
