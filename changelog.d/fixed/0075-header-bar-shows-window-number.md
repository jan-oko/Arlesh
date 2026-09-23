- **A window's own title bar shows its number again.** On Wayland, the title bar Arlesh draws inside
  each window, the one with the minimise, maximise and close buttons, kept reading plain `Arlesh`
  even while the window manager's bars showed `Arlesh [2] — Bugfixes`. It now reads the same as
  everywhere else and changes with the window's title: when the active tab changes, and when a
  second window opens or the last but one closes.
