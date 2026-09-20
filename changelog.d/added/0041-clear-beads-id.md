- **Unlink a node from its `bd` issue, from the editor.** The **Issue** row in the Task, Goal, Commitment and Project editors now carries an **×**. Press it and the node stops being linked to that issue — useful when the issue was closed, was the wrong one, or came along on a copy, all of which used to mean going back through an agent to undo.

  There is no confirmation. The issue itself is untouched — `bd` still holds it, and this only drops Arlesh's record of which issue the node belongs to — and `Ctrl+Z` puts the link straight back, so a dialog would only be in the way. The row stays where it is, greyed out and without its ×, until you close the editor, so the dialog does not reshuffle under your pointer; open it again and the row is gone.

  Writing or changing an id is still something only an agent can do over MCP, because only `bd` can say what an id *is*. Dropping one needs no such answer, which is why it is the one case the app can do on its own.
