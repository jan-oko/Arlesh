- **Python bindings.** A Python package, `arlesh`, can open your Arlesh database and run the app's own
  logic on it: read the whole board with everything Arlesh derives, create, edit, move and delete
  every kind of node, and call the rules directly (scope windows, lifecycles, Habit iterations). It
  opens read-only unless you give it a client name. A Python session writing while the app is open is
  refused unless it forces its way in, and the app's Ctrl+Z only ever undoes what you did in the app,
  never a script's changes.
