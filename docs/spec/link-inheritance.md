# Link Inheritance

*One area of the [Arlesh design specification](../../SPEC.md).*

Links inherit downward from parent to child, per the table below. (Tags, knowledge-base links and Delegation are specced to inherit too — see *Not built yet*.)

Inheritance behavior per link type:

| Link type              | Behavior when child has explicit value |
|------------------------|----------------------------------------|
| Time Scope (relevance) | A null child Time Scope inherits the nearest scoped ancestor's window. An explicit child Time Scope must be wholly contained within the parent's (interval containment); it narrows relevance but the parent window still contains it. |
| Plan (scheduling)      | Task-only. Must be wholly contained within the task's Time Scope and within the parent's Plan. |
| Agentic (Tasks)        | Override — child's explicit value (agentic *or* not agentic) replaces the inherited one; inherits through unflagged kinds |
| Asynchronous (Tasks)   | **None** — the flag stops at the Task it is set on. "Starts a wait" describes one concrete action, and a subtask of an asynchronous Task is usually the work done *after* the wait, so inheriting it would flag exactly the wrong rows |

Inherited links are computed on read (ancestor traversal). To be revisited if performance becomes an issue.

## Not built yet

Specced and kept, but not in the app today:

| Link type              | Behavior when child has explicit value |
|------------------------|----------------------------------------|
| Tags                   | Additive — child has both parent's and its own tags |
| KB links (Person/Event/Thread) | Additive |
| Delegation             | Override — child's explicit delegation replaces the inherited one |

With these, when filtering, a child item would match a filter if it or any ancestor holds the matching link. Today a tag filter tests the node's own tags only, nothing writes a knowledge-base link, and Delegation is a stored column with no inheritance.

---
